create or replace function public.record_order_refund(
  p_order_id uuid,
  p_operator_id uuid,
  p_reason text,
  p_channel_reference text default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_account public.wallet_accounts%rowtype;
  v_balance bigint;
  v_months integer;
  v_domain_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.paid_at is null or v_order.status = 'refunded' then
    raise exception '订单不可退款';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception '退款原因必填';
  end if;
  select * into v_payment from public.payments where order_id = v_order.id and status = 'success' order by paid_at desc limit 1;
  if not found then raise exception '未找到成功交易记录'; end if;
  if v_order.status = 'fulfilled' and v_order.type = 'plan_subscription' then
    update public.profiles set plan = 'free', plan_expires_at = null where id = v_order.user_id;
  elsif v_order.status = 'fulfilled' and v_order.type = 'domain_rental' then
    update public.domains set status = 'deleted' where user_id = v_order.user_id and lower(hostname) = lower(v_order.product_snapshot->>'hostname');
  elsif v_order.status = 'fulfilled' and v_order.type = 'domain_renewal' then
    v_domain_id := (v_order.product_snapshot->>'domainId')::uuid;
    v_months := (v_order.product_snapshot->>'durationMonths')::integer;
    update public.domains set expires_at = expires_at - make_interval(months => v_months) where id = v_domain_id and user_id = v_order.user_id;
  end if;
  select * into v_account from public.wallet_accounts where user_id = v_order.user_id for update;
  if not found then
    insert into public.wallet_accounts(user_id, balance_cents) values (v_order.user_id, 0) returning * into v_account;
  end if;
  v_balance := v_account.balance_cents + coalesce(v_payment.actual_amount_cents, v_payment.amount_cents);
  update public.wallet_accounts set balance_cents = v_balance, updated_at = now() where user_id = v_order.user_id;
  insert into public.wallet_ledger(user_id, amount_cents, balance_after_cents, kind, reference_type, reference_id, description)
    values (v_order.user_id, coalesce(v_payment.actual_amount_cents, v_payment.amount_cents), v_balance, 'admin_adjustment', 'order_refund', v_order.id, '管理员退款：' || left(trim(p_reason), 500));
  insert into public.refunds(order_id, amount_cents, status, reason, channel_reference, operator_id, completed_at)
    values (v_order.id, coalesce(v_payment.actual_amount_cents, v_payment.amount_cents), 'completed', left(trim(p_reason), 500), coalesce(nullif(trim(p_channel_reference), ''), '余额退款'), p_operator_id, now());
  update public.payments set status = 'refunded' where order_id = v_order.id and status = 'success';
  update public.orders set status = 'refunded', updated_at = now() where id = v_order.id;
  insert into public.audit_events(user_id, event_type, message) values (p_operator_id, 'admin.order.refunded', '管理员退款至余额：' || v_order.order_no);
  return jsonb_build_object('status', 'refunded', 'amountCents', coalesce(v_payment.actual_amount_cents, v_payment.amount_cents));
end;
$$;

revoke all on function public.record_order_refund(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_order_refund(uuid, uuid, text, text) to service_role;
