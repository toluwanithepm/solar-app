-- Row-level security: firm isolation (NFR-17) and role permissions enforced in the database (E11-1, NFR-10).
-- Claims come from the login token, added by public.custom_access_token_hook (auth migration):
--   firm_id, staff_id, app_role.

-- ---------- claim helpers ----------

create or replace function app.claims() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function app.firm_id() returns uuid language sql stable as $$
  select nullif(app.claims() ->> 'firm_id', '')::uuid
$$;

create or replace function app.staff_id() returns uuid language sql stable as $$
  select nullif(app.claims() ->> 'staff_id', '')::uuid
$$;

create or replace function app.role() returns text language sql stable as $$
  select app.claims() ->> 'app_role'
$$;

create or replace function app.has_role(variadic roles text[]) returns boolean language sql stable as $$
  select coalesce(app.role() = any (roles), false)
$$;

/** Service role, migrations and seeds bypass the field-ownership and payment guards. */
create or replace function app.is_privileged() returns boolean language sql stable as $$
  select current_user not in ('authenticated', 'anon')
$$;

-- Security definer helpers avoid policy recursion between jobs, assignees and leads.
create or replace function app.is_assigned(p_job uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from job_assignees where job_id = p_job and staff_id = app.staff_id())
$$;

/** Leads a technician may see: on jobs assigned to them, surveyed by them, or created by them. */
create or replace function app.my_lead_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select j.lead_id from jobs j join job_assignees a on a.job_id = j.id where a.staff_id = app.staff_id()
  union
  select lead_id from surveys where technician_id = app.staff_id()
  union
  select id from leads where created_by = app.staff_id()
$$;

-- ---------- grants ----------

grant usage on schema public, app to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on public.counters, public.audit_log from authenticated;
grant select on public.audit_log to authenticated;
grant execute on all functions in schema app to authenticated;
-- Anonymous visitors get nothing directly; customer links go through server functions (Phase 3)
revoke all on all tables in schema public from anon;

-- ---------- policies ----------

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

/**
 * Standard firm policies: office roles (owner, office, viewer) read; `writers` insert/update/delete.
 * Technician access is granted per table below; policies for the same command are OR-ed.
 */
create or replace procedure app.firm_policies(tbl text, writers text[]) language plpgsql as $$
begin
  execute format($p$create policy office_read on public.%I for select to authenticated
    using (firm_id = app.firm_id() and app.has_role('owner', 'office', 'viewer'))$p$, tbl);
  execute format($p$create policy writers_insert on public.%I for insert to authenticated
    with check (firm_id = app.firm_id() and app.has_role(variadic %L::text[]))$p$, tbl, writers);
  execute format($p$create policy writers_update on public.%I for update to authenticated
    using (firm_id = app.firm_id() and app.has_role(variadic %L::text[]))
    with check (firm_id = app.firm_id() and app.has_role(variadic %L::text[]))$p$, tbl, writers, writers);
  execute format($p$create policy writers_delete on public.%I for delete to authenticated
    using (firm_id = app.firm_id() and app.has_role(variadic %L::text[]))$p$, tbl, writers);
end $$;

-- Firm record: everyone in the firm reads it; only the owner edits
create policy firm_read on public.firms for select to authenticated using (id = app.firm_id());
create policy firm_update on public.firms for update to authenticated
  using (id = app.firm_id() and app.has_role('owner')) with check (id = app.firm_id());

-- Staff (E11-1): everyone sees colleagues' names; only the owner manages staff
call app.firm_policies('staff', '{owner}');
create policy tech_read on public.staff for select to authenticated using (firm_id = app.firm_id() and app.has_role('technician'));

-- Price list (E1-2): owner edits prices; everyone may read selling prices, costs are owner-only
call app.firm_policies('price_items', '{owner}');
create policy tech_read on public.price_items for select to authenticated using (firm_id = app.firm_id() and app.has_role('technician'));
create policy owner_only on public.price_item_costs for all to authenticated
  using (firm_id = app.firm_id() and app.has_role('owner')) with check (firm_id = app.firm_id() and app.has_role('owner'));

-- Leads (E2-1)
call app.firm_policies('leads', '{owner,office}');
create policy tech_read on public.leads for select to authenticated
  using (firm_id = app.firm_id() and app.has_role('technician') and id in (select app.my_lead_ids()));
create policy tech_insert on public.leads for insert to authenticated
  with check (firm_id = app.firm_id() and app.has_role('technician') and created_by = app.staff_id());

-- Surveys (E3): technicians own theirs
call app.firm_policies('surveys', '{owner,office}');
create policy tech_own on public.surveys for all to authenticated
  using (firm_id = app.firm_id() and app.has_role('technician') and technician_id = app.staff_id())
  with check (firm_id = app.firm_id() and app.has_role('technician') and technician_id = app.staff_id());

-- Quotes (E4): office staff build them; technicians never see them (prices and options live here)
call app.firm_policies('quotes', '{owner,office}');
call app.firm_policies('quote_options', '{owner,office}');
call app.firm_policies('quote_lines', '{owner,office}');
create policy owner_only on public.quote_line_costs for all to authenticated
  using (firm_id = app.firm_id() and app.has_role('owner')) with check (firm_id = app.firm_id() and app.has_role('owner'));

-- Jobs (E5, E6): technicians see and work on jobs assigned to them; column ownership is enforced by a trigger
call app.firm_policies('jobs', '{owner,office}');
create policy tech_read on public.jobs for select to authenticated
  using (firm_id = app.firm_id() and app.has_role('technician') and app.is_assigned(id));
create policy tech_update on public.jobs for update to authenticated
  using (firm_id = app.firm_id() and app.has_role('technician') and app.is_assigned(id))
  with check (firm_id = app.firm_id() and app.is_assigned(id));

call app.firm_policies('job_assignees', '{owner,office}');
create policy tech_read on public.job_assignees for select to authenticated
  using (firm_id = app.firm_id() and app.has_role('technician') and app.is_assigned(job_id));

-- Field records on assigned jobs (E6-3, E6-6): technicians write, office reads (field data is never overwritten by the office)
call app.firm_policies('job_serials', '{}');
create policy tech_all on public.job_serials for all to authenticated
  using (firm_id = app.firm_id() and app.has_role('technician') and app.is_assigned(job_id))
  with check (firm_id = app.firm_id() and app.has_role('technician') and app.is_assigned(job_id));
call app.firm_policies('job_extras', '{owner,office}');
create policy tech_all on public.job_extras for all to authenticated
  using (firm_id = app.firm_id() and app.has_role('technician') and app.is_assigned(job_id))
  with check (firm_id = app.firm_id() and app.has_role('technician') and app.is_assigned(job_id) and invoice_id is null);

-- Photos: technicians add to their jobs and surveys; office staff add fault and payment-proof photos
call app.firm_policies('photos', '{owner,office}');
create policy tech_read on public.photos for select to authenticated
  using (firm_id = app.firm_id() and app.has_role('technician')
    and (app.is_assigned(job_id) or survey_id in (select id from public.surveys where technician_id = app.staff_id())));
create policy tech_insert on public.photos for insert to authenticated
  with check (firm_id = app.firm_id() and app.has_role('technician') and uploaded_by = app.staff_id()
    and (app.is_assigned(job_id) or survey_id in (select id from public.surveys where technician_id = app.staff_id())));
create policy tech_delete on public.photos for delete to authenticated
  using (firm_id = app.firm_id() and app.has_role('technician') and uploaded_by = app.staff_id());

-- Installations (E7): office manages; technicians see systems belonging to their customers
call app.firm_policies('installations', '{owner,office}');
call app.firm_policies('installation_items', '{owner,office}');
call app.firm_policies('installation_technicians', '{owner,office}');
create policy tech_read on public.installations for select to authenticated
  using (firm_id = app.firm_id() and app.has_role('technician') and lead_id in (select app.my_lead_ids()));
create policy tech_read on public.installation_items for select to authenticated
  using (firm_id = app.firm_id() and app.has_role('technician') and installation_id in (select id from public.installations));

-- Plans and checklist templates: everyone reads; owner edits (E8-2, E6-2)
call app.firm_policies('plans', '{owner}');
create policy tech_read on public.plans for select to authenticated using (firm_id = app.firm_id() and app.has_role('technician'));
call app.firm_policies('checklist_templates', '{owner}');
create policy tech_read on public.checklist_templates for select to authenticated using (firm_id = app.firm_id() and app.has_role('technician'));

-- Tickets (E8-3): technicians see the fault on a repair job assigned to them
call app.firm_policies('tickets', '{owner,office}');
call app.firm_policies('ticket_updates', '{owner,office}');
create policy tech_read on public.tickets for select to authenticated
  using (firm_id = app.firm_id() and app.has_role('technician') and exists (select 1 from public.jobs j where j.ticket_id = tickets.id));

-- Invoices and payments (E9): technicians only see what to collect on their own jobs
call app.firm_policies('invoices', '{owner,office}');
create policy tech_read on public.invoices for select to authenticated
  using (firm_id = app.firm_id() and app.has_role('technician') and app.is_assigned(job_id));
call app.firm_policies('payments', '{owner,office}');
create policy tech_read on public.payments for select to authenticated
  using (firm_id = app.firm_id() and app.has_role('technician') and exists (select 1 from public.invoices i where i.id = payments.invoice_id));

-- Outbox: office reads and queues messages
call app.firm_policies('messages', '{owner,office}');

-- Notifications: shown to the roles they are for; read state is per person
create policy role_read on public.notifications for select to authenticated
  using (firm_id = app.firm_id() and app.role()::public.staff_role = any (for_roles));
create policy office_insert on public.notifications for insert to authenticated
  with check (firm_id = app.firm_id() and app.has_role('owner', 'office'));
create policy own_reads on public.notification_reads for all to authenticated
  using (firm_id = app.firm_id() and staff_id = app.staff_id())
  with check (firm_id = app.firm_id() and staff_id = app.staff_id());

-- Audit log (E11-3): owner reads; no insert/update/delete policies, so only definer triggers write
create policy owner_read on public.audit_log for select to authenticated using (firm_id = app.firm_id() and app.has_role('owner'));

-- Customer link tokens
call app.firm_policies('public_links', '{owner,office}');

-- counters: RLS on with no policies; reached only through app.next_number()

-- ---------- guards that row-level security can't express ----------

/**
 * NFR-2 field ownership on jobs. Technicians may only change field data (checklist, check-in/out,
 * signature, completion); the office may only change scheduling data and never overwrites field data.
 */
create or replace function app.jobs_field_guard() returns trigger language plpgsql as $$
begin
  if app.is_privileged() then
    return new;
  end if;
  if new.firm_id <> old.firm_id or new.number <> old.number then
    raise exception 'firm and job number cannot change' using errcode = '42501';
  end if;
  if app.has_role('technician') then
    if (new.lead_id, new.type, new.quote_id, new.installation_id, new.ticket_id, new.start_at, new.duration_hours,
        new.address, new.lat, new.lng, new.equipment, new.notes)
       is distinct from
       (old.lead_id, old.type, old.quote_id, old.installation_id, old.ticket_id, old.start_at, old.duration_hours,
        old.address, old.lat, old.lng, old.equipment, old.notes) then
      raise exception 'technicians can only update field data on a job' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and new.status not in ('In progress', 'Done') then
      raise exception 'technicians can only start or complete a job' using errcode = '42501';
    end if;
  else
    if (new.checklist, new.check_in_at, new.check_in_lat, new.check_in_lng, new.check_out_at, new.check_out_lat,
        new.check_out_lng, new.signature_path, new.signature_name, new.signed_at, new.completed_at)
       is distinct from
       (old.checklist, old.check_in_at, old.check_in_lat, old.check_in_lng, old.check_out_at, old.check_out_lat,
        old.check_out_lng, old.signature_path, old.signature_name, old.signed_at, old.completed_at) then
      raise exception 'field data on a job is written from the technician''s phone only' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger field_guard before update on public.jobs for each row execute function app.jobs_field_guard();

/**
 * E9-4 and E9-2: staff can only record cash or bank payments as pending; only the owner approves or rejects them.
 * Confirmed gateway payments are written by the payment webhook with the service role.
 */
create or replace function app.payments_guard() returns trigger language plpgsql as $$
begin
  if app.is_privileged() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'Pending approval' or new.method not in ('Cash', 'Bank transfer (outside app)') then
      raise exception 'only cash or bank payments outside the app can be recorded, as pending approval' using errcode = '42501';
    end if;
    new.recorded_by := app.staff_id();
    new.approved_by := null;
    new.gateway_reference := null;
    return new;
  end if;
  -- UPDATE: owner approves or rejects a pending payment; nothing else changes
  if not app.has_role('owner') or old.status <> 'Pending approval' or new.status not in ('Confirmed', 'Rejected') then
    raise exception 'only the owner can approve or reject a pending payment' using errcode = '42501';
  end if;
  if (new.invoice_id, new.amount, new.method, new.at, new.reference, new.gateway_reference, new.recorded_by)
     is distinct from (old.invoice_id, old.amount, old.method, old.at, old.reference, old.gateway_reference, old.recorded_by) then
    raise exception 'payment details cannot be edited' using errcode = '42501';
  end if;
  new.approved_by := app.staff_id();
  return new;
end $$;
create trigger payments_guard before insert or update on public.payments for each row execute function app.payments_guard();
-- Payments are a financial record: nobody deletes them from the app
drop policy writers_delete on public.payments;

/** E11-2: subscription fields change only through billing (service role). */
create or replace function app.firms_guard() returns trigger language plpgsql as $$
begin
  if app.is_privileged() then
    return new;
  end if;
  if (new.subscription_status, new.subscription_seats, new.trial_ends_at, new.paid_until)
     is distinct from (old.subscription_status, old.subscription_seats, old.trial_ends_at, old.paid_until) then
    raise exception 'subscription changes go through billing' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger firms_guard before update on public.firms for each row execute function app.firms_guard();

/** E11-1: a firm always keeps at least one active owner, and sign-in identity can't be reassigned from the app. */
create or replace function app.staff_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and not app.is_privileged() and new.auth_user_id is distinct from old.auth_user_id then
    raise exception 'sign-in identity cannot be changed' using errcode = '42501';
  end if;
  if old.role = 'owner' and old.active
     and (tg_op = 'DELETE' or new.role <> 'owner' or not new.active)
     and not exists (select 1 from staff where firm_id = old.firm_id and role = 'owner' and active and id <> old.id) then
    raise exception 'a firm must keep at least one active owner' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
create trigger staff_guard before update or delete on public.staff for each row execute function app.staff_guard();

/**
 * E4-5: quote line costs are filled from the owner's price list on the server,
 * so office staff can build quotes and the owner still sees margin.
 */
create or replace function app.fill_line_cost() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.item_id is not null then
    insert into quote_line_costs (line_id, firm_id, unit_cost)
    select new.id, new.firm_id, c.cost from price_item_costs c where c.item_id = new.item_id
    on conflict (line_id) do update set unit_cost = excluded.unit_cost;
  end if;
  return new;
end $$;
create trigger fill_cost after insert or update of item_id on public.quote_lines for each row execute function app.fill_line_cost();

-- ---------- human-readable numbers (Q-2318, SJ-1042, INV-3101, T-211, PAY-5001) ----------

create or replace function app.next_number(p_firm uuid, p_prefix text) returns text
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into counters (firm_id, prefix, value) values (p_firm, p_prefix, 1001)
  on conflict (firm_id, prefix) do update set value = counters.value + 1
  returning value into v;
  return p_prefix || '-' || v;
end $$;
revoke execute on function app.next_number(uuid, text) from authenticated;

create or replace function app.assign_number() returns trigger language plpgsql security definer set search_path = public as $$
declare col text := tg_argv[1];
begin
  if (to_jsonb(new) ->> col) is null then
    new := jsonb_populate_record(new, jsonb_build_object(col, app.next_number(new.firm_id, tg_argv[0])));
  end if;
  return new;
end $$;
create trigger assign_number before insert on public.quotes for each row execute function app.assign_number('Q', 'number');
create trigger assign_number before insert on public.jobs for each row execute function app.assign_number('SJ', 'number');
create trigger assign_number before insert on public.invoices for each row execute function app.assign_number('INV', 'number');
create trigger assign_number before insert on public.tickets for each row execute function app.assign_number('T', 'number');
create trigger assign_number before insert on public.payments for each row execute function app.assign_number('PAY', 'reference');
