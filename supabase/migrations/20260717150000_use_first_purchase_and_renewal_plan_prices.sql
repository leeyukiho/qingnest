-- Use the administrator-configured first-purchase price for users without an
-- active paid plan, and the renewal price for active paid subscriptions.
create or replace function public.create_plan_payment_order(
  p_user_id uuid,
  p_order_no text,
  p_plan_key text,
  p_duration_months integer,
  p_expires_at timestamptz
) returns public.orders
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_plan public.plan_catalog%rowtype;
  v_order public.orders%rowtype;
  v_amount integer;
  v_unit_price integer;
  v_is_first_purchase boolean;
begin
  if p_duration_months not in (1, 3, 6, 12) then
    raise exception '不支持的套餐周期';
  end if;

  select * into v_plan from public.plan_catalog
  where key = p_plan_key and enabled = true;
  if not found or v_plan.key = 'free' then raise exception '套餐不可购买'; end if;

  select not exists (
    select 1 from public.profiles
    where id = p_user_id
      and plan <> 'free'
      and plan_expires_at > now()
  ) into v_is_first_purchase;
  v_unit_price := case when v_is_first_purchase then v_plan.monthly_price_cents else v_plan.renewal_price_cents end;
  v_amount := v_unit_price * p_duration_months;
  if v_amount < 100 then raise exception '支付金额低于 FM 最低金额'; end if;

  insert into public.orders (
    order_no, user_id, type, amount_cents, product_key, product_name,
    product_snapshot, expires_at
  ) values (
    p_order_no, p_user_id, 'plan_subscription', v_amount, v_plan.key, v_plan.label,
    jsonb_build_object('planKey', v_plan.key, 'durationMonths', p_duration_months,
      'purchaseType', case when v_is_first_purchase then 'first_purchase' else 'renewal' end,
      'unitPriceCents', v_unit_price), p_expires_at
  ) returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.purchase_plan_with_wallet(p_user_id uuid, p_plan_key text, p_duration_months integer)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_plan public.plan_catalog%rowtype;
  v_account public.wallet_accounts%rowtype;
  v_amount integer;
  v_balance bigint;
  v_unit_price integer;
  v_is_first_purchase boolean;
  v_ref uuid := gen_random_uuid();
begin
  if p_duration_months not in (1,3,6,12) then raise exception '不支持的套餐周期'; end if;
  select * into v_plan from public.plan_catalog where key = p_plan_key and enabled = true;
  if not found or v_plan.key = 'free' then raise exception '套餐不可购买'; end if;
  select not exists (
    select 1 from public.profiles
    where id = p_user_id
      and plan <> 'free'
      and plan_expires_at > now()
  ) into v_is_first_purchase;
  v_unit_price := case when v_is_first_purchase then v_plan.monthly_price_cents else v_plan.renewal_price_cents end;
  v_amount := v_unit_price * p_duration_months;
  insert into public.wallet_accounts(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_account from public.wallet_accounts where user_id = p_user_id for update;
  if v_account.balance_cents < v_amount then raise exception '余额不足，请先充值'; end if;
  v_balance := v_account.balance_cents - v_amount;
  update public.profiles set plan = v_plan.key, plan_expires_at = greatest(now(), coalesce(plan_expires_at, now())) + make_interval(months => p_duration_months) where id = p_user_id;
  update public.wallet_accounts set balance_cents = v_balance, updated_at = now() where user_id = p_user_id;
  insert into public.wallet_ledger(user_id, amount_cents, balance_after_cents, kind, reference_type, reference_id, description)
    values (p_user_id, -v_amount, v_balance, 'plan_purchase', 'plan_purchase', v_ref, '购买套餐 ' || v_plan.label);
  return jsonb_build_object('planKey', v_plan.key, 'balanceCents', v_balance,
    'purchaseType', case when v_is_first_purchase then 'first_purchase' else 'renewal' end,
    'unitPriceCents', v_unit_price);
end;
$$;
