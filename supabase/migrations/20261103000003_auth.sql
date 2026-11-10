-- Phone OTP sign-in (E1-1) with the firm, staff id and role carried in the login token (E11-1).
-- Supabase Auth handles the OTP; this migration adds the token hook and firm sign-up.

/** 0803 123 4567, 2348031234567 and +2348031234567 all become +2348031234567. */
create or replace function app.normalize_phone(p text) returns text language sql immutable as $$
  select case
    when d ~ '^234[0-9]{10}$' then '+' || d
    when d ~ '^0[0-9]{10}$' then '+234' || substr(d, 2)
    when d ~ '^[0-9]{10}$' then '+234' || d
    else null
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

/**
 * Supabase custom access token hook (enabled in supabase/config.toml).
 * Adds firm_id, staff_id and app_role for an active staff member matching the user's phone.
 * A user with no active staff record (new sign-up, or deactivated) gets no firm claims, so row-level security shows them nothing.
 */
create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable as $$
declare
  claims jsonb := coalesce(event -> 'claims', '{}');
  s record;
begin
  select id, firm_id, role into s
  from public.staff
  where active
    and (auth_user_id = nullif(event ->> 'user_id', '')::uuid or phone = app.normalize_phone(claims ->> 'phone'))
  order by (auth_user_id = nullif(event ->> 'user_id', '')::uuid) desc nulls last
  limit 1;

  claims := claims - 'firm_id' - 'staff_id' - 'app_role';
  if found then
    claims := claims || jsonb_build_object('firm_id', s.firm_id, 'staff_id', s.id, 'app_role', s.role);
  end if;
  return jsonb_build_object('claims', claims);
end $$;

grant usage on schema public, app to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant execute on function app.normalize_phone(text) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on public.staff to supabase_auth_admin;
create policy auth_admin_read on public.staff for select to supabase_auth_admin using (true);

-- ---------- firm sign-up (E1-1) ----------

create or replace function app.default_checklists() returns table (job_type public.job_type, steps jsonb) language sql immutable as $$
  values
  ('Installation'::public.job_type, '[
    {"id":"s1","label":"Isolate mains and generator","hint":"Required","required":true},
    {"id":"s2","label":"Mount panels on roof","hint":"Required · photo of rails","required":true},
    {"id":"s3","label":"Install inverter and batteries","hint":"Required","required":true},
    {"id":"s4","label":"DC and AC wiring","hint":"Required · breakers and surge protection","required":true},
    {"id":"s5","label":"Earthing and bonding","hint":"Required · record earth resistance","required":true},
    {"id":"s6","label":"Configure inverter","hint":"Battery type and charge limits","required":false},
    {"id":"s7","label":"Test switchover","hint":"Required · mains off, load stays on","required":true},
    {"id":"s8","label":"Walk customer through the system","hint":"Optional","required":false}]'::jsonb),
  ('Maintenance', '[
    {"id":"m1","label":"Clean panels","hint":"Required","required":true},
    {"id":"m2","label":"Check battery voltage and health","hint":"Required · note readings","required":true},
    {"id":"m3","label":"Tighten terminals and check cables","hint":"Required","required":true},
    {"id":"m4","label":"Update inverter firmware","hint":"If available","required":false},
    {"id":"m5","label":"Test switchover","hint":"Required","required":true}]'),
  ('Fault repair', '[
    {"id":"f1","label":"Diagnose fault","hint":"Required · record error codes","required":true},
    {"id":"f2","label":"Repair or replace part","hint":"Required · scan any new serial","required":true},
    {"id":"f3","label":"Test system under load","hint":"Required","required":true}]'),
  ('Site survey', '[
    {"id":"v1","label":"Record appliances and hours","hint":"Required · in the load calculator","required":true},
    {"id":"v2","label":"Photograph roof, DB board and wiring","hint":"Required","required":true},
    {"id":"v3","label":"Agree inverter and battery location","hint":"Optional","required":false}]')
$$;

/**
 * Called once by a newly signed-in user who isn't staff anywhere: creates the firm on a 14-day trial,
 * makes the caller its owner, and copies default checklists and maintenance plans.
 * The client then refreshes its session so the token carries the new firm claims.
 */
create or replace function public.create_firm(
  p_firm_name text,
  p_owner_name text,
  p_address text default '',
  p_state text default 'Lagos',
  p_bank_name text default '',
  p_account_number text default '',
  p_account_name text default ''
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := nullif(app.claims() ->> 'sub', '')::uuid;
  v_phone text := app.normalize_phone(app.claims() ->> 'phone');
  v_firm uuid;
begin
  if v_user is null or v_phone is null then
    raise exception 'sign in with your phone number first' using errcode = '42501';
  end if;
  if exists (select 1 from staff where phone = v_phone or auth_user_id = v_user) then
    raise exception 'this phone number already belongs to a firm' using errcode = '23505';
  end if;
  if length(trim(coalesce(p_firm_name, ''))) = 0 or length(trim(coalesce(p_owner_name, ''))) = 0 then
    raise exception 'firm name and your name are required' using errcode = '22023';
  end if;

  insert into firms (name, address, state, phone, bank_name, account_number, account_name, labour_price, transport_price, setup_completed_at)
  values (trim(p_firm_name), p_address, p_state, v_phone, p_bank_name, p_account_number, p_account_name, 80000, 30000, now())
  returning id into v_firm;

  insert into staff (firm_id, auth_user_id, name, phone, role, title)
  values (v_firm, v_user, trim(p_owner_name), v_phone, 'owner', 'Owner');

  insert into checklist_templates (firm_id, job_type, steps)
  select v_firm, d.job_type, d.steps from app.default_checklists() d;

  insert into plans (firm_id, name, price, visits_per_year)
  values (v_firm, 'Basic care', 60000, 2), (v_firm, 'Care plus', 110000, 4);

  return v_firm;
end $$;

revoke execute on function public.create_firm(text, text, text, text, text, text, text) from anon, public;
grant execute on function public.create_firm(text, text, text, text, text, text, text) to authenticated;
