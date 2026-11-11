-- Phase 4, NFR-11: the owner can sign a staff member out of every phone and wipe the copy kept on those phones
-- (lost or stolen phone, or someone leaving).
--
-- How it works:
--   1. sign_out_staff() deletes that person's sign-in sessions, so no phone can refresh its sign-in any more.
--      When a phone next connects, its refresh fails, it is signed out and the app wipes its device copy.
--   2. staff.signed_out_at is stamped. Phones that are online see the change straight away through live updates
--      and wipe themselves without waiting for their sign-in to expire.
-- The person can sign in again (on a new phone) with a fresh code; that new sign-in is not affected.

alter table public.staff add column if not exists signed_out_at timestamptz;

/** Only through sign_out_staff(): nobody can clear or back-date the stamp from the app. */
create or replace function app.staff_signout_guard() returns trigger language plpgsql as $$
begin
  if not app.is_privileged() and new.signed_out_at is distinct from old.signed_out_at then
    raise exception 'use "sign out of all phones" to change this' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger staff_signout_guard before update on public.staff for each row execute function app.staff_signout_guard();

create or replace function public.sign_out_staff(p_staff uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  s record;
  v_at timestamptz := now();
begin
  if not app.has_role('owner') then
    raise exception 'only the owner can sign staff out of their phones' using errcode = '42501';
  end if;
  select id, firm_id, auth_user_id, phone into s from staff where id = p_staff and firm_id = app.firm_id();
  if not found then
    raise exception 'no such staff member' using errcode = '42501';
  end if;
  if s.id = app.staff_id() then
    raise exception 'use Sign out to sign yourself out' using errcode = '22023';
  end if;

  update staff set signed_out_at = v_at where id = s.id; -- this function runs as its owner, so the guard lets it through

  -- Ending the sessions also revokes their refresh tokens
  delete from auth.sessions
  where user_id = s.auth_user_id
     or user_id in (select u.id from auth.users u where app.normalize_phone(u.phone) = s.phone);
  return v_at;
end $$;

revoke execute on function public.sign_out_staff(uuid) from public, anon;
grant execute on function public.sign_out_staff(uuid) to authenticated;
