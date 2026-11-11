-- Stand-ins for the roles Supabase provides, so the migrations run on plain Postgres (PGlite) in tests.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;

-- Minimal stand-ins for the Supabase Auth tables the migrations touch
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, phone text);
create table if not exists auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null, created_at timestamptz not null default now());
