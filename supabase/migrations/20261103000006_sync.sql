-- Phase 2: the office app writes through one transactional function, and reminders run on the server.

-- ---------- circular links between jobs, installations, tickets and surveys are checked at commit ----------

alter table public.jobs alter constraint jobs_installation_id_fkey deferrable initially deferred;
alter table public.jobs alter constraint jobs_ticket_id_fkey deferrable initially deferred;
alter table public.installations alter constraint installations_job_fk deferrable initially deferred;
alter table public.tickets alter constraint tickets_job_fk deferrable initially deferred;
alter table public.surveys alter constraint surveys_job_fk deferrable initially deferred;
alter table public.job_extras alter constraint job_extras_invoice_fk deferrable initially deferred;

-- Who created a lead or uploaded a photo comes from the login token, not the client
alter table public.leads alter column created_by set default app.staff_id();
alter table public.photos alter column uploaded_by set default app.staff_id();

-- Any staff member can raise a notification for their firm (e.g. a technician submitting a survey)
drop policy office_insert on public.notifications;
create policy staff_insert on public.notifications for insert to authenticated
  with check (firm_id = app.firm_id() and app.role() is not null);

-- ---------- apply_changes ----------

/**
 * Applies a batch of row changes from the app in one transaction, as the signed-in user:
 * row-level security, guards, numbering and audit triggers all apply exactly as for direct writes.
 *
 * ops: [{ "t": table, "op": "insert", "row": {...} }
 *       { "t": table, "op": "update", "key": {...}, "set": {...} }
 *       { "t": table, "op": "delete", "key": {...} }]
 * Columns the table doesn't have are ignored; firm_id is always taken from the token.
 * An update that matches no visible row fails, so no change is silently dropped; deletes are idempotent.
 */
create or replace function public.apply_changes(ops jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare
  allowed constant text[] := array[
    'firms', 'staff', 'price_items', 'price_item_costs', 'plans', 'checklist_templates',
    'leads', 'surveys', 'quotes', 'quote_options', 'quote_lines', 'quote_line_costs',
    'jobs', 'job_assignees', 'job_serials', 'job_extras', 'installations', 'installation_items',
    'installation_technicians', 'tickets', 'ticket_updates', 'invoices', 'payments', 'photos',
    'messages', 'notifications', 'notification_reads'];
  o jsonb;
  t text;
  kind text;
  cols text;
  keycond text;
  n int;
begin
  if jsonb_typeof(ops) <> 'array' then
    raise exception 'ops must be an array' using errcode = '22023';
  end if;

  for o in select value from jsonb_array_elements(ops) loop
    t := o ->> 't';
    kind := o ->> 'op';
    if t is null or not (t = any (allowed)) then
      raise exception 'table "%" cannot be changed from the app', t using errcode = '42501';
    end if;

    if kind in ('update', 'delete') then
      select string_agg(format('%I::text = %L', k.key, k.value #>> '{}'), ' and ')
        into keycond
      from jsonb_each(o -> 'key') k
      where exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t and c.column_name = k.key);
      if keycond is null then
        raise exception 'missing key for % on %', kind, t using errcode = '22023';
      end if;
    end if;

    if kind = 'insert' then
      select string_agg(quote_ident(k), ', ') into cols
      from jsonb_object_keys(o -> 'row') k
      where k <> 'firm_id'
        and exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t and c.column_name = k);
      if cols is null then
        execute format('insert into public.%I default values', t);
      else
        execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)', t, cols, cols, t)
          using (o -> 'row') - 'firm_id';
      end if;

    elsif kind = 'update' then
      select string_agg(quote_ident(k), ', ') into cols
      from jsonb_object_keys(o -> 'set') k
      where k <> 'firm_id'
        and exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t and c.column_name = k);
      if cols is null then
        continue;
      end if;
      execute format('update public.%I set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where %s', t, cols, cols, t, keycond)
        using (o -> 'set') - 'firm_id';
      get diagnostics n = row_count;
      if n = 0 then
        raise exception 'no % row matching % that you can change', t, o -> 'key' using errcode = '42501';
      end if;

    elsif kind = 'delete' then
      -- Idempotent: a row already removed (e.g. by a cascade earlier in the batch) is fine.
      -- Row-level security still decides what can be deleted; a hidden row is simply not touched.
      execute format('delete from public.%I where %s', t, keycond);

    else
      raise exception 'unknown op "%"', kind using errcode = '22023';
    end if;
  end loop;
end $$;

revoke execute on function public.apply_changes(jsonb) from anon, public;
grant execute on function public.apply_changes(jsonb) to authenticated;

-- ---------- server-side reminders (E2-2 follow-ups stay a staff action; E8-1, E8-2, E9-3 are automatic) ----------

create table app.settings (key text primary key, value text not null);
-- Base URL for links in messages; set per environment. Phase 3 swaps raw ids for public_links tokens.
insert into app.settings values ('public_url', 'http://localhost:5173');

create or replace function app.setting(p_key text) returns text language sql stable as $$
  select value from app.settings where key = p_key
$$;

/**
 * Hourly job: unpaid balance reminders at the due date, +3 and +7 days (WhatsApp and SMS);
 * service reminders 7 days before a visit; plan renewal reminders 30 days before.
 * WhatsApp goes only to customers who consented (NFR-13); SMS always goes for payment reminders.
 * Idempotent: each reminder is recorded so it is sent once. Returns the number of messages queued.
 */
create or replace function app.run_automations(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  base text := coalesce(app.setting('public_url'), '');
  queued int := 0;
  r record;
  step int;
  txt text;
begin
  -- E9-3 balance reminders
  for r in
    select i.*, l.name as lead_name, l.phone as lead_phone, l.whatsapp_consent,
           i.amount - coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id and p.status = 'Confirmed'), 0) as balance,
           floor(extract(epoch from (p_now - i.due_at)) / 86400)::int as overdue_days
    from invoices i join leads l on l.id = i.lead_id
    where i.due_at <= p_now
  loop
    continue when r.balance <= 0;
    step := case when r.overdue_days >= 7 then 7 when r.overdue_days >= 3 then 3 else 0 end;
    continue when step = any (r.reminders_sent);
    txt := case when step = 0
      then format('%s of ₦%s is due today. Pay here:', r.description, to_char(r.balance, 'FM999,999,999,990'))
      else format('Reminder: %s of ₦%s is %s days overdue. Pay here:', r.description, to_char(r.balance, 'FM999,999,999,990'), step)
    end;
    if r.whatsapp_consent then
      insert into messages (firm_id, channel, to_phone, to_name, text, link, topic)
      values (r.firm_id, 'WhatsApp', r.lead_phone, r.lead_name, txt, base || '/pay/' || r.id, 'payment-reminder');
      queued := queued + 1;
    end if;
    insert into messages (firm_id, channel, to_phone, to_name, text, link, topic)
    values (r.firm_id, 'SMS', r.lead_phone, r.lead_name, txt, base || '/pay/' || r.id, 'payment-reminder');
    queued := queued + 1;
    update invoices set reminders_sent = reminders_sent || step where id = r.id;
  end loop;

  -- E8-1 service reminders, 7 days ahead
  for r in
    select ins.*, l.name as lead_name, l.phone as lead_phone, l.whatsapp_consent
    from installations ins join leads l on l.id = ins.lead_id
    where ins.next_service_at between p_now - interval '1 day' and p_now + interval '7 days'
      and (ins.last_service_reminder_at is null or ins.last_service_reminder_at < ins.next_service_at - interval '8 days')
  loop
    insert into messages (firm_id, channel, to_phone, to_name, text, topic)
    values (r.firm_id, case when r.whatsapp_consent then 'WhatsApp' else 'SMS' end::message_channel, r.lead_phone, r.lead_name,
            format('Your solar system is due for a service visit around %s. We will call to book a time.', to_char(r.next_service_at at time zone 'Africa/Lagos', 'DD Mon YYYY')),
            'service-reminder');
    insert into notifications (firm_id, text, link, for_roles)
    values (r.firm_id, r.lead_name || ' is due for a service visit in 7 days or less', '/office/service', '{owner,office}');
    update installations set last_service_reminder_at = p_now where id = r.id;
    queued := queued + 1;
  end loop;

  -- E8-2 plan renewal reminders, 30 days ahead
  for r in
    select ins.*, l.name as lead_name, l.phone as lead_phone, l.whatsapp_consent, pl.name as plan_name
    from installations ins join leads l on l.id = ins.lead_id left join plans pl on pl.id = ins.plan_id
    where ins.plan_renews_at between p_now and p_now + interval '30 days' and ins.last_renewal_reminder_at is null
  loop
    insert into messages (firm_id, channel, to_phone, to_name, text, topic)
    values (r.firm_id, case when r.whatsapp_consent then 'WhatsApp' else 'SMS' end::message_channel, r.lead_phone, r.lead_name,
            format('Your %s plan renews on %s.', coalesce(r.plan_name, 'maintenance'), to_char(r.plan_renews_at at time zone 'Africa/Lagos', 'DD Mon YYYY')),
            'plan-renewal');
    update installations set last_renewal_reminder_at = p_now where id = r.id;
    queued := queued + 1;
  end loop;

  return queued;
end $$;
revoke execute on function app.run_automations(timestamptz) from authenticated, anon, public;

-- Hourly schedule where pg_cron is available (Supabase); tests call the function directly
do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('run-automations', '0 * * * *', 'select app.run_automations()');
  end if;
end
$do$;

-- ---------- live updates: the office app refreshes when rows change (Supabase Realtime) ----------

do $do$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['firms', 'staff', 'price_items', 'plans', 'checklist_templates', 'leads', 'surveys', 'quotes',
      'quote_options', 'quote_lines', 'jobs', 'job_assignees', 'job_serials', 'job_extras', 'installations', 'installation_items',
      'tickets', 'ticket_updates', 'invoices', 'payments', 'photos', 'messages', 'notifications'] loop
      execute format('alter publication supabase_realtime add table public.%I', t);
    end loop;
  end if;
end
$do$;
