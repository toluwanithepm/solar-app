-- E11-3: audit log of changes to quotes, prices, invoices and payments, with who, when and before/after values.
-- Written by triggers running as the table owner, so the app can neither skip nor edit it.

create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_entity public.audit_entity := tg_argv[0]::public.audit_entity;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_before jsonb;
  v_after jsonb;
  v_changed text;
  v_label text;
begin
  if tg_op = 'UPDATE' then
    -- Keep only the fields that changed
    select jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k), string_agg(k, ', ' order by k)
      into v_before, v_after, v_changed
    from jsonb_object_keys(v_new) k
    where k not in ('updated_at') and v_old -> k is distinct from v_new -> k;
    if v_changed is null then
      return new;
    end if;
  else
    v_before := v_old;
    v_after := v_new;
  end if;

  v_label := coalesce(
    coalesce(v_new, v_old) ->> 'number',
    coalesce(v_new, v_old) ->> 'reference',
    nullif(concat_ws(' ', coalesce(v_new, v_old) ->> 'brand', coalesce(v_new, v_old) ->> 'model'), ''),
    coalesce(v_new, v_old) ->> 'description',
    tg_table_name
  );

  insert into audit_log (firm_id, actor_id, entity, table_name, entity_id, action, summary, before, after)
  values (
    (coalesce(v_new, v_old) ->> 'firm_id')::uuid,
    app.staff_id(),
    v_entity,
    tg_table_name,
    coalesce((coalesce(v_new, v_old) ->> 'id')::uuid, (coalesce(v_new, v_old) ->> 'item_id')::uuid, (coalesce(v_new, v_old) ->> 'line_id')::uuid),
    lower(tg_op),
    case tg_op
      when 'INSERT' then 'Added ' || v_label
      when 'DELETE' then 'Deleted ' || v_label
      else 'Changed ' || v_label || ': ' || v_changed
    end,
    v_before,
    v_after
  );
  return coalesce(new, old);
end $$;

create trigger audit after insert or update or delete on public.quotes for each row execute function app.audit_row('quote');
create trigger audit after insert or update or delete on public.quote_options for each row execute function app.audit_row('quote');
create trigger audit after insert or update or delete on public.quote_lines for each row execute function app.audit_row('quote');
create trigger audit after insert or update or delete on public.quote_line_costs for each row execute function app.audit_row('quote');
create trigger audit after insert or update or delete on public.price_items for each row execute function app.audit_row('price');
create trigger audit after insert or update or delete on public.price_item_costs for each row execute function app.audit_row('price');
create trigger audit after insert or update or delete on public.invoices for each row execute function app.audit_row('invoice');
create trigger audit after insert or update or delete on public.payments for each row execute function app.audit_row('payment');
