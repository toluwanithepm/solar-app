-- Stand-ins for the roles Supabase provides, so the migrations run on plain Postgres (PGlite) in tests.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
