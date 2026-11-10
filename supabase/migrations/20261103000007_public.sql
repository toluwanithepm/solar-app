-- Phase 3: customer links (E4-3, E8-3, E2-3), Paystack payments (E4-4, E9-2) and subscription billing (E11-2).
-- Customers never sign in. The `public` Edge Function (service role) calls the svc_* functions below with a link token;
-- none of them can be called by anonymous or signed-in users directly.

-- ---------- public enquiry form link (E2-3) ----------

alter table public.firms add column enquiry_token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
insert into app.settings values ('seat_price', '7500') on conflict (key) do nothing;

-- ---------- link tokens ----------

/** The live token for a record's customer link, created on first use. */
create or replace function app.link_token(p_firm uuid, p_kind public.link_kind, p_target uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  select token into v from public_links
  where firm_id = p_firm and kind = p_kind and target_id = p_target and revoked_at is null and (expires_at is null or expires_at > now())
  order by created_at limit 1;
  if v is null then
    insert into public_links (firm_id, kind, target_id) values (p_firm, p_kind, p_target) returning token into v;
  end if;
  return v;
end $$;

/** True when the record behind a link belongs to the firm. */
create or replace function app.link_target_ok(p_firm uuid, p_kind public.link_kind, p_target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'quote' then exists (select 1 from quotes where id = p_target and firm_id = p_firm)
    when 'invoice' then exists (select 1 from invoices where id = p_target and firm_id = p_firm)
    when 'handover' then exists (select 1 from jobs where id = p_target and firm_id = p_firm)
    when 'fault_report' then exists (select 1 from installations where id = p_target and firm_id = p_firm)
  end
$$;

/** Staff get a customer link to share (copy, WhatsApp). */
create or replace function public.share_link(p_kind public.link_kind, p_target uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if app.firm_id() is null or app.role() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if not app.link_target_ok(app.firm_id(), p_kind, p_target) then
    raise exception 'no such % in your firm', p_kind using errcode = '42501';
  end if;
  return app.link_token(app.firm_id(), p_kind, p_target);
end $$;
revoke execute on function public.share_link(public.link_kind, uuid) from public, anon;
grant execute on function public.share_link(public.link_kind, uuid) to authenticated;

/** Replace /q|pay|handover|report/<record id> in a message with the record's link token. */
create or replace function app.tokenize_urls(p_firm uuid, p_text text) returns text
language plpgsql security definer set search_path = public as $$
declare
  m text[];
  k public.link_kind;
  out text := p_text;
begin
  if p_text is null then
    return null;
  end if;
  for m in select regexp_matches(p_text, '/(q|pay|handover|report)/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') loop
    k := case m[1] when 'q' then 'quote' when 'pay' then 'invoice' when 'handover' then 'handover' else 'fault_report' end;
    if app.link_target_ok(p_firm, k, m[2]::uuid) then
      out := replace(out, '/' || m[1] || '/' || m[2], '/' || m[1] || '/' || app.link_token(p_firm, k, m[2]::uuid));
    end if;
  end loop;
  return out;
end $$;

-- Every queued message gets token links, whoever built it (office app, technician app, reminders)
create or replace function app.tokenize_message() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.link := app.tokenize_urls(new.firm_id, new.link);
  new.text := app.tokenize_urls(new.firm_id, new.text);
  return new;
end $$;
create trigger tokenize_links before insert on public.messages for each row execute function app.tokenize_message();

create or replace function app.resolve_link(p_token text) returns public.public_links
language sql stable security definer set search_path = public as $$
  select * from public_links
  where token = p_token and revoked_at is null and (expires_at is null or expires_at > now())
$$;

-- ---------- what a customer may see ----------

create or replace function app.rows(q text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from (%s) x', q) into v;
  return v;
end $$;

create or replace function app.safe_firm(p_firm uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(f) - 'subscription_status' - 'subscription_seats' - 'trial_ends_at' - 'paid_until' - 'enquiry_token'), '[]')
  from firms f where f.id = p_firm
$$;

/**
 * Rows for one customer link, in the office app's table shapes. Never includes costs, other customers,
 * staff phone numbers or subscription details. Also returns storage paths to sign and related link tokens.
 */
create or replace function public.svc_public_view(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l public_links;
  t jsonb := '{}';
  links jsonb := '{}';
  lead uuid;
  f uuid;
  r record;
  lead_cols constant text := 'id, firm_id, name, phone, location, address, state, source, property_type, stage, whatsapp_consent, created_at';
  pay_cols constant text := 'id, firm_id, invoice_id, amount, method, at, status, reference, created_at';
begin
  l := app.resolve_link(p_token);
  if l.token is null then
    raise exception 'This link is not valid or has expired' using errcode = 'P0002';
  end if;
  f := l.firm_id;
  t := jsonb_build_object('firms', app.safe_firm(f), 'plans', app.rows(format('select * from plans where firm_id = %L', f)));

  if l.kind = 'quote' then
    select lead_id into lead from quotes where id = l.target_id;
    t := t || jsonb_build_object(
      'quotes', app.rows(format('select * from quotes where id = %L', l.target_id)),
      'quote_options', app.rows(format('select * from quote_options where quote_id = %L', l.target_id)),
      'quote_lines', app.rows(format('select ql.* from quote_lines ql join quote_options o on o.id = ql.option_id where o.quote_id = %L', l.target_id)),
      'price_items', app.rows(format('select p.* from price_items p where p.id in (select ql.item_id from quote_lines ql join quote_options o on o.id = ql.option_id where o.quote_id = %L)', l.target_id)),
      'invoices', app.rows(format('select * from invoices where quote_id = %L', l.target_id)),
      'payments', app.rows(format('select %s from payments where status = ''Confirmed'' and invoice_id in (select id from invoices where quote_id = %L)', pay_cols, l.target_id)));
    for r in select id from invoices where quote_id = l.target_id loop
      links := links || jsonb_build_object('invoice:' || r.id, app.link_token(f, 'invoice', r.id));
    end loop;

  elsif l.kind = 'invoice' then
    select lead_id into lead from invoices where id = l.target_id;
    t := t || jsonb_build_object(
      'invoices', app.rows(format('select * from invoices where id = %L', l.target_id)),
      'payments', app.rows(format('select %s from payments where status = ''Confirmed'' and invoice_id = %L', pay_cols, l.target_id)),
      'quotes', app.rows(format('select q.* from quotes q join invoices i on i.quote_id = q.id where i.id = %L', l.target_id)),
      'quote_options', app.rows(format('select o.* from quote_options o join invoices i on i.quote_id = o.quote_id where i.id = %L', l.target_id)),
      'quote_lines', app.rows(format('select ql.* from quote_lines ql join quote_options o on o.id = ql.option_id join invoices i on i.quote_id = o.quote_id where i.id = %L', l.target_id)));

  elsif l.kind = 'handover' then
    select lead_id into lead from jobs where id = l.target_id;
    t := t || jsonb_build_object(
      'jobs', app.rows(format('select * from jobs where id = %L', l.target_id)),
      'job_assignees', app.rows(format('select * from job_assignees where job_id = %L', l.target_id)),
      'staff', app.rows(format('select s.id, s.firm_id, s.name, ''''::text as phone, s.role, s.title, s.active from staff s where s.id in (select staff_id from job_assignees where job_id = %L)', l.target_id)),
      'job_serials', app.rows(format('select * from job_serials where job_id = %L', l.target_id)),
      'photos', app.rows(format('select * from photos where job_id = %L', l.target_id)),
      'installations', app.rows(format('select i.* from installations i join jobs j on j.installation_id = i.id where j.id = %L', l.target_id)),
      'installation_items', app.rows(format('select it.* from installation_items it join jobs j on j.installation_id = it.installation_id where j.id = %L', l.target_id)),
      'installation_technicians', app.rows(format('select it.* from installation_technicians it join jobs j on j.installation_id = it.installation_id where j.id = %L', l.target_id)),
      'invoices', app.rows(format('select * from invoices where job_id = %L', l.target_id)),
      'payments', app.rows(format('select %s from payments where status = ''Confirmed'' and invoice_id in (select id from invoices where job_id = %L)', pay_cols, l.target_id)));
    for r in select installation_id as id from jobs where id = l.target_id and installation_id is not null loop
      links := links || jsonb_build_object('fault_report:' || r.id, app.link_token(f, 'fault_report', r.id));
    end loop;
    for r in select id from invoices where job_id = l.target_id loop
      links := links || jsonb_build_object('invoice:' || r.id, app.link_token(f, 'invoice', r.id));
    end loop;

  else -- fault_report
    select lead_id into lead from installations where id = l.target_id;
    t := t || jsonb_build_object(
      'installations', app.rows(format('select * from installations where id = %L', l.target_id)),
      'installation_items', app.rows(format('select * from installation_items where installation_id = %L', l.target_id)),
      'tickets', app.rows(format('select * from tickets where installation_id = %L', l.target_id)),
      'ticket_updates', app.rows(format('select u.* from ticket_updates u join tickets tk on tk.id = u.ticket_id where tk.installation_id = %L', l.target_id)),
      'photos', app.rows(format('select p.* from photos p join tickets tk on tk.id = p.ticket_id where tk.installation_id = %L', l.target_id)));
  end if;

  t := t || jsonb_build_object('leads', app.rows(format('select %s from leads where id = %L', lead_cols, lead)));

  return jsonb_build_object(
    'kind', l.kind,
    'targetId', l.target_id,
    'tables', t,
    'links', links,
    -- Storage paths the Edge Function signs for the page
    'paths', jsonb_build_object(
      'photos', coalesce((select jsonb_agg(p ->> 'storage_path') from jsonb_array_elements(coalesce(t -> 'photos', '[]')) p where p ->> 'storage_path' is not null), '[]'),
      'signatures', coalesce((select jsonb_agg(j ->> 'signature_path') from jsonb_array_elements(coalesce(t -> 'jobs', '[]')) j where j ->> 'signature_path' is not null), '[]'),
      'logos', coalesce((select jsonb_agg(x ->> 'logo_path') from jsonb_array_elements(t -> 'firms') x where x ->> 'logo_path' is not null), '[]')));
end $$;

create or replace function public.svc_firm_by_enquiry_token(p_firm_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('firms', app.safe_firm(id), 'logo_path', logo_path) from firms where enquiry_token = p_firm_token
$$;

-- ---------- customer actions ----------

/** E2-3: public enquiry form creates a lead and notifies the office. Limited to 30 web enquiries an hour per firm. */
create or replace function public.svc_submit_enquiry(
  p_firm_token text, p_name text, p_phone text, p_location text, p_property_type text, p_consent boolean, p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f firms;
  v_phone text := app.normalize_phone(p_phone);
begin
  select * into f from firms where enquiry_token = p_firm_token;
  if f.id is null then
    raise exception 'This enquiry form is not available' using errcode = 'P0002';
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 or v_phone is null then
    raise exception 'Enter your name and a Nigerian phone number' using errcode = '22023';
  end if;
  if (select count(*) from leads where firm_id = f.id and source = 'Web form' and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many enquiries right now. Please call us instead.' using errcode = '54000';
  end if;
  insert into leads (firm_id, name, phone, location, address, state, source, property_type, notes, whatsapp_consent)
  values (f.id, left(trim(p_name), 120), v_phone, left(coalesce(p_location, ''), 200), left(coalesce(p_location, ''), 200), f.state, 'Web form',
          coalesce(nullif(p_property_type, '')::public.property_type, 'Home'), left(p_notes, 2000), coalesce(p_consent, false));
  insert into notifications (firm_id, text, link, for_roles)
  values (f.id, format('New web enquiry: %s, %s', trim(p_name), coalesce(p_location, '')), '/office/leads', '{owner,office}');
  return jsonb_build_object('ok', true, 'firmName', f.name);
end $$;

/** E8-3: a customer reports a fault from their installation's link. */
create or replace function public.svc_report_fault(p_token text, p_description text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l public_links := app.resolve_link(p_token);
  ins installations;
  ld leads;
  tk tickets;
begin
  if l.token is null or l.kind <> 'fault_report' then
    raise exception 'This link is not valid or has expired' using errcode = 'P0002';
  end if;
  if length(trim(coalesce(p_description, ''))) < 5 then
    raise exception 'Tell us a little more about the problem' using errcode = '22023';
  end if;
  select * into ins from installations where id = l.target_id;
  select * into ld from leads where id = ins.lead_id;
  if (select count(*) from tickets where installation_id = ins.id and created_at > now() - interval '1 day') >= 5 then
    raise exception 'You have already reported several problems today. We will be in touch.' using errcode = '54000';
  end if;
  insert into tickets (firm_id, installation_id, lead_id, description, channel)
  values (ins.firm_id, ins.id, ins.lead_id, left(trim(p_description), 2000), 'Link') returning * into tk;
  insert into ticket_updates (firm_id, ticket_id, text) values (ins.firm_id, tk.id, 'Ticket received');
  insert into notifications (firm_id, text, link, for_roles)
  values (ins.firm_id, format('Fault reported by %s: %s', ld.name, left(trim(p_description), 80)), '/office/service', '{owner,office}');
  insert into messages (firm_id, channel, to_phone, to_name, text, link, topic)
  values (ins.firm_id, case when ld.whatsapp_consent then 'WhatsApp' else 'SMS' end::message_channel, ld.phone, ld.name,
          format('We received your fault report %s. We will update you here.', tk.number),
          coalesce(app.setting('public_url'), '') || '/report/' || ins.id, 'ticket');
  return jsonb_build_object('ticketId', tk.id, 'number', tk.number);
end $$;

/** Reserve a photo on a just-reported ticket (max 3, within 2 hours); returns the storage path to upload to. */
create or replace function public.svc_add_fault_photo(p_token text, p_ticket uuid, p_bytes int, p_taken_at timestamptz, p_lat double precision, p_lng double precision) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l public_links := app.resolve_link(p_token);
  tk tickets;
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  select * into tk from tickets where id = p_ticket;
  if l.token is null or l.kind <> 'fault_report' or tk.installation_id is distinct from l.target_id then
    raise exception 'This link is not valid or has expired' using errcode = 'P0002';
  end if;
  if tk.created_at < now() - interval '2 hours' or (select count(*) from photos where ticket_id = tk.id) >= 3 then
    raise exception 'No more photos can be added to this report' using errcode = '54000';
  end if;
  v_path := tk.firm_id || '/tickets/' || tk.id || '/' || v_id || '.jpg';
  insert into photos (id, firm_id, kind, storage_path, bytes, taken_at, lat, lng, ticket_id, uploaded_by)
  values (v_id, tk.firm_id, 'fault', v_path, p_bytes, coalesce(p_taken_at, now()), p_lat, p_lng, tk.id, null);
  return jsonb_build_object('photoId', v_id, 'path', v_path);
end $$;

create or replace function public.svc_drop_photo(p_photo uuid) returns void
language sql security definer set search_path = public as $$
  delete from photos where id = p_photo and ticket_id is not null
$$;

-- ---------- payments (Paystack) ----------

/** What a Paystack reference is for. Payments are only applied against an intent the server created. */
create table public.payment_intents (
  reference text primary key,
  firm_id uuid not null references public.firms on delete cascade,
  kind text not null check (kind in ('quote', 'invoice', 'subscription')),
  target_id uuid not null,
  option_id uuid,
  seats int,
  amount numeric(14, 2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'mismatch')),
  -- Which gateway took it, and that gateway's own id (Paystack reference or Bachs checkout id)
  provider text not null default 'paystack' check (provider in ('paystack', 'bachs')),
  provider_ref text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
alter table public.payment_intents enable row level security;
revoke all on public.payment_intents from anon, authenticated;

create or replace function app.option_total(p_option uuid) returns numeric language sql stable as $$
  select coalesce(sum(qty * unit_price), 0) from public.quote_lines where option_id = p_option
$$;

/**
 * E4-4 / E9-2: start a payment from a customer link. The amount comes from the database, never the browser:
 * a quote's deposit for the chosen option, or an invoice's remaining balance.
 */
create or replace function public.svc_create_payment_intent(p_token text, p_option uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l public_links := app.resolve_link(p_token);
  q quotes;
  inv invoices;
  ld leads;
  v_amount numeric;
  v_desc text;
  v_ref text := 'sfs_' || replace(gen_random_uuid()::text, '-', '');
begin
  if l.token is null then
    raise exception 'This link is not valid or has expired' using errcode = 'P0002';
  end if;

  if l.kind = 'quote' then
    select * into q from quotes where id = l.target_id;
    if q.status = 'Accepted' then
      raise exception 'This quote has already been accepted' using errcode = '55000';
    elsif q.status <> 'Sent' or coalesce(q.sent_at, q.created_at) + make_interval(days => q.valid_days) < now() then
      raise exception 'This quote can no longer be accepted. Please ask for a new one.' using errcode = '55000';
    end if;
    if not exists (select 1 from quote_options where id = p_option and quote_id = q.id) then
      raise exception 'Choose one of the options on the quote' using errcode = '22023';
    end if;
    v_amount := round(app.option_total(p_option) * q.deposit_pct / 100);
    v_desc := format('Deposit for quote %s', q.number);
    select * into ld from leads where id = q.lead_id;
  elsif l.kind = 'invoice' then
    select * into inv from invoices where id = l.target_id;
    v_amount := inv.amount - coalesce((select sum(amount) from payments where invoice_id = inv.id and status = 'Confirmed'), 0);
    if v_amount <= 0 then
      raise exception 'This invoice is already paid' using errcode = '55000';
    end if;
    v_desc := format('%s (%s)', inv.description, inv.number);
    select * into ld from leads where id = inv.lead_id;
  else
    raise exception 'Payments are not taken from this link' using errcode = '22023';
  end if;

  if v_amount <= 0 then
    raise exception 'Nothing to pay on this quote' using errcode = '22023';
  end if;
  insert into payment_intents (reference, firm_id, kind, target_id, option_id, amount)
  values (v_ref, l.firm_id, case when l.kind = 'quote' then 'quote' else 'invoice' end, l.target_id, p_option, v_amount);

  return jsonb_build_object('reference', v_ref, 'amount', v_amount, 'description', v_desc, 'firmId', l.firm_id,
    'customerName', ld.name, 'customerPhone', ld.phone, 'kind', l.kind, 'targetId', l.target_id);
end $$;

/** E11-2: the owner pays for a month of technician seats. Called with the owner's own token (not the service role). */
create or replace function public.create_subscription_intent() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_seats int;
  v_amount numeric;
  v_ref text := 'sfs_' || replace(gen_random_uuid()::text, '-', '');
  f firms;
begin
  if not app.has_role('owner') then
    raise exception 'Only the owner can pay for the subscription' using errcode = '42501';
  end if;
  select * into f from firms where id = app.firm_id();
  select greatest(1, count(*)) into v_seats from staff where firm_id = f.id and role = 'technician' and active;
  v_amount := v_seats * coalesce(app.setting('seat_price'), '7500')::numeric;
  insert into payment_intents (reference, firm_id, kind, target_id, seats, amount) values (v_ref, f.id, 'subscription', f.id, v_seats, v_amount);
  return jsonb_build_object('reference', v_ref, 'amount', v_amount, 'seats', v_seats, 'description', format('%s subscription: %s technician seats, 1 month', f.name, v_seats),
    'firmId', f.id, 'customerName', f.name, 'customerPhone', f.phone, 'kind', 'subscription', 'targetId', f.id);
end $$;
revoke execute on function public.create_subscription_intent() from public, anon;
grant execute on function public.create_subscription_intent() to authenticated;

/**
 * Apply a successful Paystack charge (from the webhook or the return-page check). Idempotent per reference.
 * The amount must match the intent; a quote deposit accepts the quote, creates the job and the payment schedule.
 */
create or replace function public.svc_record_gateway_payment(p_reference text, p_amount_kobo bigint, p_channel text, p_paid_at timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pi payment_intents;
  v_method public.payment_method := case lower(coalesce(p_channel, ''))
    when 'card' then 'Card' when 'apple_pay' then 'Card' when 'ussd' then 'USSD' else 'Transfer' end;
  v_inv uuid;
  q quotes;
  ld leads;
  v_job uuid;
  v_total numeric;
begin
  select * into pi from payment_intents where reference = p_reference for update;
  if pi.reference is null then
    raise exception 'Unknown payment reference %', p_reference using errcode = 'P0002';
  end if;
  if pi.status = 'paid' then
    return jsonb_build_object('status', 'success', 'kind', pi.kind, 'targetId', pi.target_id, 'duplicate', true);
  end if;
  if p_amount_kobo <> round(pi.amount * 100) then
    -- Recorded (not raised) so the mark survives; nothing is applied and staff can follow up
    update payment_intents set status = 'mismatch' where reference = pi.reference;
    insert into notifications (firm_id, text, link, for_roles)
    values (pi.firm_id, format('Paystack payment %s was for ₦%s but ₦%s was expected; it was not applied', p_reference,
            to_char(p_amount_kobo / 100.0, 'FM999,999,999,990'), to_char(pi.amount, 'FM999,999,999,990')), '/office/payments', '{owner}');
    return jsonb_build_object('status', 'mismatch', 'kind', pi.kind, 'targetId', pi.target_id);
  end if;

  if pi.kind = 'subscription' then
    update firms set subscription_status = 'active', subscription_seats = pi.seats,
      paid_until = greatest(coalesce(paid_until, p_paid_at), p_paid_at) + interval '1 month'
    where id = pi.firm_id;

  elsif pi.kind = 'invoice' then
    v_inv := pi.target_id;

  else -- quote deposit: accept the quote and set up the job and payment schedule
    select * into q from quotes where id = pi.target_id for update;
    select * into ld from leads where id = q.lead_id;
    if q.status = 'Accepted' then
      select id into v_inv from invoices where quote_id = q.id and kind = 'Deposit' order by issued_at limit 1;
    else
      v_total := app.option_total(pi.option_id);
      update quotes set status = 'Accepted', selected_option_id = pi.option_id, accepted_at = p_paid_at where id = q.id;
      update leads set stage = 'Won' where id = q.lead_id;
      insert into jobs (firm_id, lead_id, type, status, quote_id, duration_hours, address, equipment, checklist)
      values (q.firm_id, q.lead_id, 'Installation', 'Unscheduled', q.id, 5, ld.address,
        coalesce((select jsonb_agg(jsonb_build_object('description', description, 'qty', qty, 'category', category, 'itemId', item_id) order by position)
                  from quote_lines where option_id = pi.option_id and category <> 'service'), '[]'),
        coalesce((select jsonb_agg(s || '{"done": false}') from checklist_templates c, jsonb_array_elements(c.steps) s
                  where c.firm_id = q.firm_id and c.job_type = 'Installation'), '[]'))
      returning id into v_job;
      insert into invoices (firm_id, lead_id, quote_id, job_id, kind, description, amount, issued_at, due_at, reminders_sent)
      values (q.firm_id, q.lead_id, q.id, v_job, 'Deposit', format('Deposit (%s%%)', q.deposit_pct), pi.amount, p_paid_at, p_paid_at, '{0}')
      returning id into v_inv;
      insert into invoices (firm_id, lead_id, quote_id, job_id, kind, description, amount, issued_at, due_at)
      values (q.firm_id, q.lead_id, q.id, v_job, 'Balance', format('Balance at handover (%s%%)', 100 - q.deposit_pct), v_total - pi.amount, p_paid_at, p_paid_at + interval '14 days');
      insert into notifications (firm_id, text, link, for_roles)
      values (q.firm_id, format('%s accepted quote %s and paid the ₦%s deposit', ld.name, q.number, to_char(pi.amount, 'FM999,999,999,990')), '/office/schedule', '{owner,office}');
    end if;
  end if;

  if v_inv is not null then
    insert into payments (firm_id, invoice_id, amount, method, at, status, gateway_reference)
    select i.firm_id, i.id, pi.amount, v_method, p_paid_at, 'Confirmed', p_reference from invoices i where i.id = v_inv;
    select l.* into ld from leads l join invoices i on i.lead_id = l.id where i.id = v_inv;
    insert into messages (firm_id, channel, to_phone, to_name, text, link, topic)
    select i.firm_id, case when ld.whatsapp_consent then 'WhatsApp' else 'SMS' end::message_channel, ld.phone, ld.name,
           format('Receipt: we received ₦%s by %s for %s. Thank you!', to_char(pi.amount, 'FM999,999,999,990'), v_method, i.description),
           coalesce(app.setting('public_url'), '') || '/pay/' || i.id, 'receipt'
    from invoices i where i.id = v_inv;
    if pi.kind = 'invoice' then
      insert into notifications (firm_id, text, link, for_roles)
      select i.firm_id, format('%s paid ₦%s on %s', ld.name, to_char(pi.amount, 'FM999,999,999,990'), i.number), '/office/payments', '{owner,office}'
      from invoices i where i.id = v_inv;
    end if;
  end if;

  update payment_intents set status = 'paid', paid_at = p_paid_at where reference = pi.reference;
  return jsonb_build_object('status', 'success', 'kind', pi.kind, 'targetId', pi.target_id);
end $$;

create or replace function public.svc_intent(p_reference text) returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(pi) from payment_intents pi where reference = p_reference
$$;

/** Record which gateway checkout a payment was sent to. */
create or replace function public.svc_set_intent_provider(p_reference text, p_provider text, p_provider_ref text) returns void
language sql security definer set search_path = public as $$
  update payment_intents set provider = p_provider, provider_ref = p_provider_ref where reference = p_reference and status = 'pending'
$$;

-- Only the Edge Functions (service role) may call the svc_* functions
do $do$
declare fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'svc\_%' loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$do$;
