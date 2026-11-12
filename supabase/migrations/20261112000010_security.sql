-- Security hardening (found by supabase/tests/security.test.ts):
--  1. Internal owner-rights functions were executable by any signed-in user (PostgreSQL grants EXECUTE to PUBLIC
--     by default). app.rows runs whatever query it is given; app.tokenize_urls mints customer links for any firm.
--     They are only meant to be called from other owner-rights functions, so app users lose EXECUTE.
--  2. Per-client rate limiting for the public link API, so one visitor can't hammer the links, burn payment-provider
--     calls or fill a firm's enquiry allowance and lock real customers out.

revoke execute on function app.rows(text) from public, anon, authenticated;
revoke execute on function app.tokenize_urls(uuid, text) from public, anon, authenticated;
revoke execute on function app.safe_firm(uuid) from public, anon, authenticated;

-- ---------- rate limiting ----------

/** Fixed-window counters: one row per (action, client, window). The client key is a hash, never a raw IP address. */
create table if not exists app.rate_limits (
  bucket text not null,
  client text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket, client, window_start)
);
alter table app.rate_limits enable row level security; -- no policies: only owner-rights functions touch it
revoke all on app.rate_limits from public, anon, authenticated;

/**
 * Count one request and say whether it is allowed. Called by the public Edge Function (service role) before each action.
 * Returns false once the client has made p_limit requests in the current window of p_window_seconds.
 */
create or replace function public.svc_rate_limit(p_bucket text, p_key text, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public, app as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  if p_key is null or p_key = '' then
    return true;
  end if;
  insert into app.rate_limits as r (bucket, client, window_start, hits)
  values (left(p_bucket, 40), left(p_key, 128), v_start, 1)
  on conflict (bucket, client, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;
  -- Keep the table small: now and then, forget windows older than a day
  if random() < 0.01 then
    delete from app.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_limit;
end $$;

revoke execute on function public.svc_rate_limit(text, text, int, int) from public, anon, authenticated;
grant execute on function public.svc_rate_limit(text, text, int, int) to service_role;
