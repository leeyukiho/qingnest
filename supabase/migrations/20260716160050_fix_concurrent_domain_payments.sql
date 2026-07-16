-- Pending checkouts do not own a hostname. Ownership is decided atomically
-- when a verified payment is confirmed.
drop index if exists public.domain_reservations_active_hostname_unique;

update public.domain_reservations
set status = 'released', updated_at = now()
where status = 'active';

create or replace function public.enforce_order_payment_window()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if new.expires_at <= new.created_at
     or new.expires_at > new.created_at + interval '10 minutes 30 seconds' then
    raise exception '订单支付期限必须为 10 分钟';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_order_payment_window on public.orders;
create trigger enforce_order_payment_window before insert on public.orders
for each row execute function public.enforce_order_payment_window();

create or replace function public.create_domain_payment_order(
  p_user_id uuid,
  p_order_no text,
  p_hostname text,
  p_hostname_suffix text,
  p_duration_months integer,
  p_expires_at timestamptz
) returns public.orders
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_price public.domain_pricing%rowtype;
  v_order public.orders%rowtype;
  v_amount integer;
begin
  if p_expires_at > now() + interval '10 minutes 30 seconds'
     or p_expires_at <= now() then raise exception '订单支付期限必须为 10 分钟'; end if;
  if p_duration_months not in (1, 3, 6, 12) then raise exception '不支持的租赁周期'; end if;
  if lower(p_hostname) = lower(p_hostname_suffix)
     or right(lower(p_hostname), char_length(p_hostname_suffix) + 1) <> '.' || lower(p_hostname_suffix) then
    raise exception '域名与后缀不匹配';
  end if;
  if exists (select 1 from public.domains where lower(hostname) = lower(p_hostname) and status <> 'deleted') then
    raise exception '域名已被占用';
  end if;

  select * into v_price from public.domain_pricing
  where lower(hostname_suffix) = lower(p_hostname_suffix)
    and enabled = true and setup_status = 'active';
  if not found then raise exception '域名后缀不可购买'; end if;
  v_amount := case p_duration_months
    when 1 then v_price.monthly_price_cents when 3 then v_price.quarterly_price_cents
    when 6 then v_price.semiannual_price_cents when 12 then v_price.annual_price_cents end;
  if v_amount < 100 then raise exception '支付金额低于 FM 最低金额'; end if;

  insert into public.orders (order_no, user_id, type, amount_cents, product_key,
    product_name, product_snapshot, expires_at)
  values (p_order_no, p_user_id, 'domain_rental', v_amount, v_price.domain_type,
    lower(p_hostname), jsonb_build_object('hostname', lower(p_hostname),
      'hostnameSuffix', lower(p_hostname_suffix), 'durationMonths', p_duration_months), p_expires_at)
  returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.cancel_payment_order(p_user_id uuid, p_order_id uuid)
returns public.orders
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_order public.orders%rowtype;
begin
  select * into v_order from public.orders
  where id = p_order_id and user_id = p_user_id for update;
  if not found then raise exception '订单不存在'; end if;
  if v_order.status not in ('pending', 'payment_failed') then
    raise exception '只有未付款订单可以取消';
  end if;
  if exists (select 1 from public.payments where order_id = v_order.id and status = 'success') then
    raise exception '订单已经付款，不能取消';
  end if;
  update public.orders set status = 'cancelled', pay_url = null,
    failure_code = null, failure_message = null, updated_at = now()
  where id = v_order.id returning * into v_order;
  update public.domain_reservations set status = 'released', updated_at = now()
  where order_id = v_order.id and status = 'active';
  return v_order;
end;
$$;

revoke all on function public.cancel_payment_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_payment_order(uuid, uuid) to service_role;

-- Serialize hostname winners before the existing unique hostname constraint is
-- reached. A transaction-scoped lock also works when case differs.
create or replace function public.lock_domain_hostname_before_insert()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(lower(new.hostname), 0));
  return new;
end;
$$;

drop trigger if exists lock_domain_hostname_before_insert on public.domains;
create trigger lock_domain_hostname_before_insert before insert on public.domains
for each row execute function public.lock_domain_hostname_before_insert();

-- Turn domain race losses and payments made outside the ten-minute window into
-- an explicit money-handling state. The payment row remains the audit source.
create or replace function public.classify_unfulfillable_domain_payment()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_paid_at timestamptz;
begin
  if old.status = 'refund_pending' and new.status in ('paid', 'fulfilling', 'fulfilled', 'fulfillment_failed') then
    new.status := 'refund_pending';
    return new;
  end if;
  select paid_at into v_paid_at from public.payments
  where order_id = new.id and status = 'success';
  if v_paid_at is null then return new; end if;

  if v_paid_at > new.expires_at
     or old.status in ('cancelled', 'expired')
     or (new.type = 'domain_rental' and new.status = 'fulfillment_failed' and
       (new.failure_message ilike '%duplicate key%'
        or new.failure_message ilike '%域名已被%占用%')) then
    new.status := 'refund_pending';
    new.failure_code := case
      when v_paid_at > new.expires_at then 'PAID_AFTER_EXPIRY'
      when old.status = 'cancelled' then 'PAID_AFTER_CANCEL'
      when old.status = 'expired' then 'PAID_AFTER_EXPIRY'
      else 'DOMAIN_ALREADY_SOLD' end;
    new.failure_message := case
      when new.failure_code = 'DOMAIN_ALREADY_SOLD' then '付款时域名已被其他订单购买，款项待原路退回'
      else '订单关闭后收到付款，款项待原路退回' end;
  end if;
  return new;
end;
$$;

drop trigger if exists classify_unfulfillable_domain_payment on public.orders;
create trigger classify_unfulfillable_domain_payment before update on public.orders
for each row execute function public.classify_unfulfillable_domain_payment();

create or replace function public.guard_paid_domain_fulfillment()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if exists (
    select 1 from public.orders o
    join public.fulfillment_jobs j on j.order_id = o.id and j.status = 'processing'
    where o.type = 'domain_rental'
      and o.user_id = new.user_id
      and lower(o.product_snapshot->>'hostname') = lower(new.hostname)
      and o.status <> 'fulfilling'
  ) then
    raise exception '订单已关闭，禁止开通域名';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_paid_domain_fulfillment on public.domains;
create trigger guard_paid_domain_fulfillment before insert on public.domains
for each row execute function public.guard_paid_domain_fulfillment();

create or replace function public.guard_closed_order_fulfillment()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'profiles' and exists (
    select 1 from public.orders o
    join public.fulfillment_jobs j on j.order_id = o.id and j.status = 'processing'
    where o.type = 'plan_subscription' and o.user_id = new.id
      and o.status = 'refund_pending'
  ) then raise exception '订单已关闭，禁止开通套餐'; end if;

  if tg_table_name = 'domains' and exists (
    select 1 from public.orders o
    join public.fulfillment_jobs j on j.order_id = o.id and j.status = 'processing'
    where o.type = 'domain_renewal'
      and (o.product_snapshot->>'domainId')::uuid = new.id
      and o.status = 'refund_pending'
  ) then raise exception '订单已关闭，禁止续费域名'; end if;
  return new;
end;
$$;

drop trigger if exists guard_closed_plan_fulfillment on public.profiles;
create trigger guard_closed_plan_fulfillment before update on public.profiles
for each row execute function public.guard_closed_order_fulfillment();

drop trigger if exists guard_closed_renewal_fulfillment on public.domains;
create trigger guard_closed_renewal_fulfillment before update on public.domains
for each row execute function public.guard_closed_order_fulfillment();
