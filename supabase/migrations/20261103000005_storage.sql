-- Storage buckets for photos, signatures and logos. Object paths start with the firm id: <firm_id>/<...>.
-- Skipped where the Supabase storage schema doesn't exist (the PGlite test database).

do $do$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'storage schema not present; skipping bucket setup';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
    ('photos', 'photos', false, 307200, array['image/jpeg']),
    ('signatures', 'signatures', false, 307200, array['image/png', 'image/jpeg']),
    ('logos', 'logos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do nothing;

  -- Staff read and upload their own firm's files; the owner replaces the logo
  execute $p$create policy firm_files_read on storage.objects for select to authenticated
    using (bucket_id in ('photos', 'signatures', 'logos') and (storage.foldername(name))[1] = app.firm_id()::text)$p$;
  execute $p$create policy firm_files_upload on storage.objects for insert to authenticated
    with check (bucket_id in ('photos', 'signatures') and (storage.foldername(name))[1] = app.firm_id()::text)$p$;
  execute $p$create policy owner_logo on storage.objects for all to authenticated
    using (bucket_id = 'logos' and (storage.foldername(name))[1] = app.firm_id()::text and app.has_role('owner'))
    with check (bucket_id = 'logos' and (storage.foldername(name))[1] = app.firm_id()::text and app.has_role('owner'))$p$;
end
$do$;
