-- Payment idempotency (found by the payment idempotency tests in supabase/tests/public.test.ts):
-- the same payment arriving twice (webhook retries, webhook racing the return page) was already recorded once, thanks to
-- the row lock on the payment intent and the unique gateway reference. But two separate payment attempts for the same
-- bill (two tabs, or paying again after closing the checkout) were both recorded silently. The second is still recorded,
-- because the money is real, but it is now flagged and the owner is told to refund it.

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
  v_inv_row invoices;
  v_overpaid boolean := false;
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
    -- Two payment attempts for the same bill (two tabs, a retry after closing the checkout) can both be charged.
    -- The money is real, so it is always recorded, but if the bill was already settled the owner is told to refund.
    select * into v_inv_row from invoices where id = v_inv for update;
    v_overpaid := coalesce((select sum(amount) from payments where invoice_id = v_inv and status = 'Confirmed'), 0) >= v_inv_row.amount;
    insert into payments (firm_id, invoice_id, amount, method, at, status, gateway_reference)
    select i.firm_id, i.id, pi.amount, v_method, p_paid_at, 'Confirmed', p_reference from invoices i where i.id = v_inv;
    select l.* into ld from leads l join invoices i on i.lead_id = l.id where i.id = v_inv;
    insert into messages (firm_id, channel, to_phone, to_name, text, link, topic)
    select i.firm_id, case when ld.whatsapp_consent then 'WhatsApp' else 'SMS' end::message_channel, ld.phone, ld.name,
           format('Receipt: we received ₦%s by %s for %s. Thank you!', to_char(pi.amount, 'FM999,999,999,990'), v_method, i.description),
           coalesce(app.setting('public_url'), '') || '/pay/' || i.id, 'receipt'
    from invoices i where i.id = v_inv;
    if v_overpaid then
      insert into notifications (firm_id, text, link, for_roles)
      values (v_inv_row.firm_id,
        format('%s paid %s twice: an extra ₦%s by %s (reference %s). Refund it from your payment provider''s dashboard.',
               ld.name, v_inv_row.number, to_char(pi.amount, 'FM999,999,999,990'), v_method, p_reference),
        '/office/payments', '{owner}');
    elsif pi.kind = 'invoice' then
      insert into notifications (firm_id, text, link, for_roles)
      select i.firm_id, format('%s paid ₦%s on %s', ld.name, to_char(pi.amount, 'FM999,999,999,990'), i.number), '/office/payments', '{owner,office}'
      from invoices i where i.id = v_inv;
    end if;
  end if;

  update payment_intents set status = 'paid', paid_at = p_paid_at where reference = pi.reference;
  return jsonb_build_object('status', 'success', 'kind', pi.kind, 'targetId', pi.target_id, 'overpaid', v_overpaid);
end $$;
