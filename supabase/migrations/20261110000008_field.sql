-- Phase 4: the server finishes what a technician starts.
-- The phone only writes field data (checklist, photos, serials, signature, status Done). When a job becomes Done or a
-- survey is submitted, deferred triggers do the trusted work: installation record and warranties (E7-1), next service
-- (E8-1), plan and extras invoices (E8-2, E6-6), balance due (E9-1), customer messages (E6-5) and office notifications.
-- Deferred = they run at the end of the transaction, so a whole offline batch (photos, serials and the Done status
-- arriving together, in any order) is complete before it is checked.

-- Plan the customer chose at handover; applied by the completion trigger
alter table public.jobs add column handover_plan_id uuid references public.plans on delete set null;

create or replace function app.on_job_done() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j jobs;
  ld leads;
  f firms;
  ins installations;
  pl plans;
  v_now timestamptz;
  v_inv uuid;
  v_amount numeric;
  v_desc text;
  n int;
  base text := coalesce(app.setting('public_url'), '');
  ch public.message_channel;
begin
  select * into j from jobs where id = new.id;
  if j.id is null or j.status <> 'Done' then
    return null;
  end if;
  v_now := coalesce(j.completed_at, now());
  select * into ld from leads where id = j.lead_id;
  select * into f from firms where id = j.firm_id;
  ch := case when ld.whatsapp_consent then 'WhatsApp' else 'SMS' end;

  -- E6-2, E6-4, E6-5: a technician can't complete a job with required work missing (the app checks first; this is the backstop)
  if app.has_role('technician') then
    if exists (select 1 from jsonb_array_elements(j.checklist) s where coalesce((s ->> 'required')::boolean, false) and not coalesce((s ->> 'done')::boolean, false)) then
      raise exception '% cannot be completed: required checklist steps are not done', j.number using errcode = '23514';
    end if;
    if j.type <> 'Site survey' then
      if not exists (select 1 from photos where job_id = j.id and kind = 'before') or not exists (select 1 from photos where job_id = j.id and kind = 'after') then
        raise exception '% cannot be completed: it needs at least one before and one after photo', j.number using errcode = '23514';
      end if;
      if length(trim(coalesce(j.signature_name, ''))) = 0 then
        raise exception '% cannot be completed: the customer has not signed off', j.number using errcode = '23514';
      end if;
    end if;
    if j.type = 'Installation' then
      select coalesce(sum((e ->> 'qty')::numeric), 0) into n from jsonb_array_elements(j.equipment) e where e ->> 'category' in ('inverter', 'battery', 'panel');
      if (select count(*) from job_serials where job_id = j.id) < n then
        raise exception '% cannot be completed: some serial numbers are not recorded', j.number using errcode = '23514';
      end if;
    end if;
  end if;

  update jobs set completed_at = v_now, check_out_at = coalesce(check_out_at, v_now),
    signed_at = coalesce(signed_at, case when signature_name is not null then v_now end)
  where id = j.id;

  -- E7-1: installation record with serials and warranty end dates; E8-1: first service visit
  if j.type = 'Installation' and j.installation_id is null then
    insert into installations (firm_id, lead_id, job_id, installed_at, site, service_interval_months, next_service_at)
    values (j.firm_id, j.lead_id, j.id, v_now, j.address, f.service_interval_months, v_now + make_interval(months => f.service_interval_months))
    returning * into ins;
    insert into installation_items (firm_id, installation_id, label, category, serial, warranty_years, warranty_ends_at)
    select j.firm_id, ins.id, label, category, serial, warranty_years, v_now + make_interval(years => warranty_years) from job_serials where job_id = j.id;
    insert into installation_technicians (installation_id, staff_id, firm_id)
    select ins.id, staff_id, j.firm_id from job_assignees where job_id = j.id;
    update jobs set installation_id = ins.id where id = j.id;
  elsif j.installation_id is not null then
    select * into ins from installations where id = j.installation_id;
    if j.type = 'Maintenance' then
      update installations set next_service_at = v_now + make_interval(months => service_interval_months),
        plan_visits_left = case when plan_visits_left > 0 then plan_visits_left - 1 else plan_visits_left end
      where id = ins.id;
    end if;
  end if;

  -- E8-2: maintenance plan chosen at handover
  if j.handover_plan_id is not null and ins.id is not null and ins.plan_id is null then
    select * into pl from plans where id = j.handover_plan_id and firm_id = j.firm_id;
    if pl.id is not null then
      n := greatest(1, round(12.0 / pl.visits_per_year));
      update installations set plan_id = pl.id, plan_started_at = v_now, plan_renews_at = v_now + interval '12 months',
        plan_visits_left = pl.visits_per_year, service_interval_months = n, next_service_at = v_now + make_interval(months => n)
      where id = ins.id;
      insert into invoices (firm_id, lead_id, job_id, kind, description, amount, issued_at, due_at)
      values (j.firm_id, j.lead_id, j.id, 'Maintenance plan', pl.name || ' plan · 12 months', pl.price, v_now, v_now) returning id into v_inv;
      insert into messages (firm_id, channel, to_phone, to_name, text, link, topic)
      values (j.firm_id, ch, ld.phone, ld.name,
        format('Thank you for choosing the %s plan (%s visits a year). Pay ₦%s here:', pl.name, pl.visits_per_year, to_char(pl.price, 'FM999,999,999,990')),
        base || '/pay/' || v_inv, 'payment-link');
      insert into notifications (firm_id, text, link, for_roles)
      values (j.firm_id, format('%s signed up for %s on handover', ld.name, pl.name), '/office/installations/' || ins.id, '{owner,office}');
    end if;
  end if;

  -- E8-3: a repair job resolves its ticket
  if j.ticket_id is not null then
    update tickets set status = 'Resolved' where id = j.ticket_id and status <> 'Resolved';
    if found then
      insert into ticket_updates (firm_id, ticket_id, at, text) values (j.firm_id, j.ticket_id, v_now, 'Job completed and signed off');
      insert into messages (firm_id, channel, to_phone, to_name, text, topic)
      select j.firm_id, ch, ld.phone, ld.name, format('Your fault report %s is resolved. Thank you for your patience.', t.number), 'ticket' from tickets t where t.id = j.ticket_id;
    end if;
  end if;

  -- E6-6: extra materials are invoiced at price-list prices; free-text extras go to the office to price
  select coalesce(sum(x.qty * coalesce(p.price, 0)), 0), string_agg(x.qty || ' × ' || x.description, ', '), count(*)
    into v_amount, v_desc, n
  from job_extras x left join price_items p on p.id = x.item_id
  where x.job_id = j.id and x.flagged_for_invoice and x.invoice_id is null;
  if n > 0 then
    if v_amount > 0 then
      insert into invoices (firm_id, lead_id, job_id, kind, description, amount, issued_at, due_at)
      values (j.firm_id, j.lead_id, j.id, 'Extras', 'Extra materials: ' || v_desc, v_amount, v_now, v_now) returning id into v_inv;
      update job_extras set invoice_id = v_inv where job_id = j.id and flagged_for_invoice and invoice_id is null;
    end if;
    insert into notifications (firm_id, text, link, for_roles)
    values (j.firm_id, format('%s extra item(s) used on %s need invoicing review', n, j.number), '/office/jobs/' || j.id, '{owner,office}');
  end if;

  -- E9-1: the balance falls due at handover
  v_inv := null;
  select i.id, i.amount - coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id and p.status = 'Confirmed'), 0)
    into v_inv, v_amount
  from invoices i where i.job_id = j.id and i.kind = 'Balance' limit 1;
  if v_inv is not null and v_amount > 0 then
    update invoices set due_at = v_now where id = v_inv;
  end if;

  -- E6-5: handover report (and the balance link) go to the customer
  if j.type <> 'Site survey' then
    insert into messages (firm_id, channel, to_phone, to_name, text, link, topic)
    values (j.firm_id, ch, ld.phone, ld.name,
      format('Your %s by %s is complete. Your handover report and warranty details are here.', lower(j.type::text), f.name),
      base || '/handover/' || j.id, 'handover');
    if v_inv is not null and v_amount > 0 then
      insert into messages (firm_id, channel, to_phone, to_name, text, link, topic)
      values (j.firm_id, ch, ld.phone, ld.name,
        format('Balance of ₦%s is now due. Pay by card, transfer or USSD.', to_char(v_amount, 'FM999,999,999,990')),
        base || '/pay/' || v_inv, 'payment-link');
    end if;
    insert into notifications (firm_id, text, link, for_roles)
    values (j.firm_id, format('%s for %s completed', j.number, ld.name), '/office/jobs/' || j.id, '{owner,office}');
  end if;
  return null;
end $$;

create constraint trigger job_done after update on public.jobs
  deferrable initially deferred for each row
  when (new.status = 'Done' and old.status is distinct from 'Done')
  execute function app.on_job_done();

-- ---------- survey submitted (E3): lead moves on, the survey job closes, the office is told ----------

create or replace function app.on_survey_submitted() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s surveys;
  ld leads;
begin
  -- Only when a signed-in staff member submits (not seeds or imports)
  if app.staff_id() is null then
    return null;
  end if;
  select * into s from surveys where id = new.id;
  if s.id is null or s.status <> 'submitted' or s.submitted_at is not null then
    return null;
  end if;
  update surveys set submitted_at = now() where id = s.id;
  update leads set stage = 'Surveyed' where id = s.lead_id and stage = 'New';
  if s.job_id is not null then
    update jobs set status = 'Done', completed_at = coalesce(completed_at, now()), check_out_at = coalesce(check_out_at, now()),
      checklist = (select coalesce(jsonb_agg(c || '{"done": true}'), '[]') from jsonb_array_elements(checklist) c)
    where id = s.job_id and type = 'Site survey' and status <> 'Done';
  end if;
  select * into ld from leads where id = s.lead_id;
  insert into notifications (firm_id, text, link, for_roles)
  values (s.firm_id, format('Site survey for %s is ready to quote', ld.name), '/office/leads/' || ld.id, '{owner,office}');
  return null;
end $$;

create constraint trigger survey_submitted_insert after insert on public.surveys
  deferrable initially deferred for each row when (new.status = 'submitted')
  execute function app.on_survey_submitted();
create constraint trigger survey_submitted_update after update on public.surveys
  deferrable initially deferred for each row when (new.status = 'submitted' and old.status is distinct from 'submitted')
  execute function app.on_survey_submitted();
