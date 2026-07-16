alter table public.domain_pricing
  add column if not exists renewal_window_days integer not null default 30
    check (renewal_window_days between 1 and 365),
  add column if not exists max_advance_months integer not null default 12
    check (max_advance_months between 1 and 36);

update public.domain_pricing set
  monthly_price_cents = greatest(monthly_price_cents, 100),
  quarterly_price_cents = greatest(quarterly_price_cents, 100),
  semiannual_price_cents = greatest(semiannual_price_cents, 100),
  annual_price_cents = greatest(annual_price_cents, 100)
where enabled = true and domain_type <> 'custom_domain';

alter table public.domains
  drop constraint if exists domains_rental_period_check;

alter table public.domains
  add constraint domains_expiration_after_creation_check
  check (expires_at > created_at);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique check (order_no ~ '^[A-Za-z0-9]{8,32}$'),
  user_id uuid not null references auth.users(id) on delete restrict,
  type text not null check (type in ('plan_subscription', 'domain_rental', 'domain_renewal')),
  status text not null default 'pending' check (status in (
    'pending', 'payment_failed', 'paid', 'fulfilling', 'fulfilled',
    'fulfillment_failed', 'expired', 'refund_pending', 'refunded', 'cancelled'
  )),
  currency text not null default 'CNY' check (currency = 'CNY'),
  amount_cents integer not null check (amount_cents >= 100),
  product_key text not null,
  product_name text not null check (char_length(product_name) between 1 and 100),
  product_snapshot jsonb not null default '{}'::jsonb,
  provider text not null default 'fm' check (provider = 'fm'),
  provider_order_id text,
  pay_url text,
  expires_at timestamptz not null,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index orders_provider_order_unique
  on public.orders(provider, provider_order_id)
  where provider_order_id is not null;
create index orders_user_created_idx on public.orders(user_id, created_at desc);
create index orders_pending_expiry_idx on public.orders(expires_at)
  where status = 'pending';
create index orders_attention_idx on public.orders(updated_at)
  where status in ('payment_failed', 'fulfillment_failed', 'refund_pending');
create unique index orders_one_open_domain_renewal
  on public.orders((product_snapshot->>'domainId'))
  where type = 'domain_renewal'
    and status in ('pending', 'paid', 'fulfilling', 'fulfillment_failed');

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null check (provider = 'fm'),
  provider_order_id text not null,
  channel_order_no text,
  status text not null check (status in ('success', 'refunded')),
  amount_cents integer not null check (amount_cents >= 100),
  actual_amount_cents integer not null check (actual_amount_cents > 0),
  pay_type text not null,
  payee text,
  paid_at timestamptz not null,
  signature_valid boolean not null default false,
  source text not null default 'notify' check (source in ('notify', 'query', 'admin')),
  raw_payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  unique(provider, provider_order_id)
);

create unique index payments_success_order_unique
  on public.payments(order_id)
  where status = 'success';
create index payments_order_idx on public.payments(order_id);

create table public.domain_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  hostname text not null,
  status text not null default 'active' check (status in ('active', 'converted', 'released')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index domain_reservations_active_hostname_unique
  on public.domain_reservations(lower(hostname))
  where status = 'active';
create index domain_reservations_expiry_idx on public.domain_reservations(expires_at)
  where status = 'active';
create index domain_reservations_user_idx on public.domain_reservations(user_id, created_at desc);

create table public.fulfillment_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  type text not null check (type in ('plan_subscription', 'domain_rental', 'domain_renewal')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index fulfillment_jobs_retry_idx on public.fulfillment_jobs(next_attempt_at)
  where status = 'failed';

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  status text not null check (status in ('pending', 'completed', 'rejected')),
  reason text not null,
  channel_reference text,
  operator_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index refunds_order_idx on public.refunds(order_id);

alter table public.orders enable row level security;
alter table public.payments enable row level security;
alter table public.domain_reservations enable row level security;
alter table public.fulfillment_jobs enable row level security;
alter table public.refunds enable row level security;

create policy orders_select_own on public.orders
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy payments_select_own on public.payments
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = payments.order_id and o.user_id = (select auth.uid())
  ));

revoke all on table public.orders, public.payments, public.domain_reservations,
  public.fulfillment_jobs, public.refunds from public, anon, authenticated;
grant select on table public.orders, public.payments to authenticated;
grant select, insert, update, delete on table public.orders, public.payments,
  public.domain_reservations, public.fulfillment_jobs, public.refunds to service_role;

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
begin
  if p_duration_months not in (1, 3, 6, 12) then
    raise exception '不支持的套餐周期';
  end if;

  select * into v_plan from public.plan_catalog
  where key = p_plan_key and enabled = true;
  if not found or v_plan.key = 'free' then raise exception '套餐不可购买'; end if;

  v_amount := v_plan.renewal_price_cents * p_duration_months;
  if v_amount < 100 then raise exception '支付金额低于 FM 最低金额'; end if;

  insert into public.orders (
    order_no, user_id, type, amount_cents, product_key, product_name,
    product_snapshot, expires_at
  ) values (
    p_order_no, p_user_id, 'plan_subscription', v_amount, v_plan.key, v_plan.label,
    jsonb_build_object('planKey', v_plan.key, 'durationMonths', p_duration_months,
      'unitPriceCents', v_plan.renewal_price_cents), p_expires_at
  ) returning * into v_order;
  return v_order;
end;
$$;

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
  if p_duration_months not in (1, 3, 6, 12) then raise exception '不支持的租赁周期'; end if;
  if lower(p_hostname) = lower(p_hostname_suffix)
     or right(lower(p_hostname), char_length(p_hostname_suffix) + 1) <> '.' || lower(p_hostname_suffix) then
    raise exception '域名与后缀不匹配';
  end if;

  update public.domain_reservations
    set status = 'released', updated_at = now()
    where status = 'active' and expires_at < now();

  if exists (select 1 from public.domains where lower(hostname) = lower(p_hostname) and status <> 'deleted') then
    raise exception '域名已被占用';
  end if;

  select * into v_price from public.domain_pricing
    where lower(hostname_suffix) = lower(p_hostname_suffix)
      and enabled = true and setup_status = 'active';
  if not found then raise exception '域名后缀不可购买'; end if;

  v_amount := case p_duration_months
    when 1 then v_price.monthly_price_cents
    when 3 then v_price.quarterly_price_cents
    when 6 then v_price.semiannual_price_cents
    when 12 then v_price.annual_price_cents
  end;
  if v_amount < 100 then raise exception '支付金额低于 FM 最低金额'; end if;

  insert into public.orders (
    order_no, user_id, type, amount_cents, product_key, product_name,
    product_snapshot, expires_at
  ) values (
    p_order_no, p_user_id, 'domain_rental', v_amount, v_price.domain_type,
    p_hostname, jsonb_build_object('hostname', lower(p_hostname),
      'hostnameSuffix', lower(p_hostname_suffix), 'durationMonths', p_duration_months), p_expires_at
  ) returning * into v_order;

  insert into public.domain_reservations(order_id, user_id, hostname, expires_at)
  values (v_order.id, p_user_id, lower(p_hostname), p_expires_at + interval '20 minutes');
  return v_order;
end;
$$;

create or replace function public.create_domain_renewal_order(
  p_user_id uuid,
  p_order_no text,
  p_domain_id uuid,
  p_duration_months integer,
  p_expires_at timestamptz
) returns public.orders
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_domain public.domains%rowtype;
  v_price public.domain_pricing%rowtype;
  v_order public.orders%rowtype;
  v_amount integer;
begin
  if p_duration_months not in (1, 3, 6, 12) then raise exception '不支持的续费周期'; end if;
  select * into v_domain from public.domains where id = p_domain_id for update;
  if not found or v_domain.user_id <> p_user_id or v_domain.type <> 'platform_subdomain'
     or v_domain.status = 'deleted' then raise exception '域名不存在或不可续费'; end if;
  if v_domain.expires_at <= now() then raise exception '域名已经到期，请联系管理员处理'; end if;

  select * into v_price from public.domain_pricing
    where enabled = true and setup_status = 'active'
      and lower(v_domain.hostname) like '%.' || lower(hostname_suffix)
    order by char_length(hostname_suffix) desc limit 1;
  if not found then raise exception '域名价格配置不存在'; end if;
  if v_domain.expires_at > now() + make_interval(days => v_price.renewal_window_days) then
    raise exception '尚未进入续费窗口';
  end if;
  if v_domain.expires_at + make_interval(months => p_duration_months)
      > now() + make_interval(months => v_price.max_advance_months) then
    raise exception '续费后超过允许的最长持有期限';
  end if;

  v_amount := case p_duration_months
    when 1 then v_price.monthly_price_cents
    when 3 then v_price.quarterly_price_cents
    when 6 then v_price.semiannual_price_cents
    when 12 then v_price.annual_price_cents
  end;
  if v_amount < 100 then raise exception '支付金额低于 FM 最低金额'; end if;

  insert into public.orders (
    order_no, user_id, type, amount_cents, product_key, product_name,
    product_snapshot, expires_at
  ) values (
    p_order_no, p_user_id, 'domain_renewal', v_amount, v_price.domain_type,
    v_domain.hostname, jsonb_build_object('domainId', v_domain.id,
      'hostname', v_domain.hostname, 'durationMonths', p_duration_months,
      'previousExpiresAt', v_domain.expires_at), p_expires_at
  ) returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.confirm_fm_payment(
  p_order_no text,
  p_provider_order_id text,
  p_channel_order_no text,
  p_amount_cents integer,
  p_actual_amount_cents integer,
  p_pay_type text,
  p_payee text,
  p_paid_at timestamptz,
  p_source text,
  p_raw_payload jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_job public.fulfillment_jobs%rowtype;
  v_domain public.domains%rowtype;
  v_months integer;
  v_hostname text;
  v_result text := 'fulfilled';
begin
  select * into v_order from public.orders where order_no = p_order_no for update;
  if not found then raise exception '订单不存在'; end if;
  if v_order.amount_cents <> p_amount_cents then raise exception '订单金额不一致'; end if;
  if v_order.provider_order_id is not null and v_order.provider_order_id <> p_provider_order_id then
    raise exception 'FM 平台订单号不一致';
  end if;

  insert into public.payments(order_id, provider, provider_order_id, channel_order_no,
    status, amount_cents, actual_amount_cents, pay_type, payee, paid_at,
    signature_valid, source, raw_payload)
  values (v_order.id, 'fm', p_provider_order_id, nullif(p_channel_order_no, ''),
    'success', p_amount_cents, p_actual_amount_cents, p_pay_type, nullif(p_payee, ''),
    p_paid_at, true, p_source, p_raw_payload)
  on conflict (provider, provider_order_id) do nothing;

  if not exists (select 1 from public.payments where order_id = v_order.id and status = 'success') then
    raise exception '该订单关联了其他成功支付';
  end if;

  if v_order.status in ('fulfilled', 'refunded', 'refund_pending') then
    return jsonb_build_object('status', v_order.status, 'duplicate', true);
  end if;

  update public.orders set status = 'paid', paid_at = coalesce(paid_at, p_paid_at),
    provider_order_id = coalesce(provider_order_id, p_provider_order_id),
    failure_code = null, failure_message = null, updated_at = now()
  where id = v_order.id;
  insert into public.fulfillment_jobs(order_id, type)
    values (v_order.id, v_order.type)
    on conflict (order_id) do update set status = 'processing', attempts = fulfillment_jobs.attempts + 1,
      last_error = null, updated_at = now()
    returning * into v_job;
  update public.orders set status = 'fulfilling', updated_at = now() where id = v_order.id;

  begin
    v_months := (v_order.product_snapshot->>'durationMonths')::integer;
    if v_months not in (1, 3, 6, 12) then raise exception '订单周期快照无效'; end if;

    if v_order.type = 'plan_subscription' then
      update public.profiles set
        plan = v_order.product_snapshot->>'planKey',
        plan_expires_at = greatest(now(), coalesce(plan_expires_at, now())) + make_interval(months => v_months)
      where id = v_order.user_id;
      if not found then raise exception '用户资料不存在'; end if;
    elsif v_order.type = 'domain_rental' then
      v_hostname := lower(v_order.product_snapshot->>'hostname');
      if exists (select 1 from public.domains where lower(hostname) = v_hostname and status <> 'deleted') then
        raise exception '域名已被其他订单占用';
      end if;
      insert into public.domains(user_id, hostname, type, status, expires_at)
      values (v_order.user_id, v_hostname, 'platform_subdomain', 'active',
        p_paid_at + make_interval(months => v_months));
      update public.domain_reservations set status = 'converted', updated_at = now()
        where order_id = v_order.id;
    elsif v_order.type = 'domain_renewal' then
      select * into v_domain from public.domains
        where id = (v_order.product_snapshot->>'domainId')::uuid for update;
      if not found or v_domain.user_id <> v_order.user_id or v_domain.expires_at <= p_paid_at then
        raise exception '域名已到期或所有权已变化';
      end if;
      if v_domain.expires_at <> (v_order.product_snapshot->>'previousExpiresAt')::timestamptz then
        raise exception '域名到期时间已变化，需要管理员处理重复续费';
      end if;
      if not exists (
        select 1 from public.domain_pricing dp
        where dp.enabled = true and dp.setup_status = 'active'
          and lower(v_domain.hostname) like '%.' || lower(dp.hostname_suffix)
          and v_domain.expires_at + make_interval(months => v_months)
            <= now() + make_interval(months => dp.max_advance_months)
      ) then raise exception '续费后超过后台设置的最长持有期限'; end if;
      update public.domains set expires_at = v_domain.expires_at + make_interval(months => v_months)
        where id = v_domain.id;
    else
      raise exception '未知订单类型';
    end if;

    update public.fulfillment_jobs set status = 'completed', attempts = attempts + 1,
      completed_at = now(), updated_at = now() where order_id = v_order.id;
    update public.orders set status = 'fulfilled', fulfilled_at = now(), updated_at = now()
      where id = v_order.id;
  exception when others then
    v_result := 'fulfillment_failed';
    update public.fulfillment_jobs set status = 'failed', attempts = attempts + 1,
      last_error = left(sqlerrm, 500), next_attempt_at = now() + interval '15 minutes', updated_at = now()
      where order_id = v_order.id;
    update public.orders set status = 'fulfillment_failed', failure_code = sqlstate,
      failure_message = left(sqlerrm, 500), updated_at = now() where id = v_order.id;
  end;

  return jsonb_build_object('status', v_result, 'duplicate', false, 'orderId', v_order.id);
end;
$$;

create or replace function public.record_order_refund(
  p_order_id uuid,
  p_operator_id uuid,
  p_reason text,
  p_channel_reference text
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_months integer;
  v_domain_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.paid_at is null or v_order.status = 'refunded' then
    raise exception '订单不可退款';
  end if;
  if nullif(trim(p_reason), '') is null or nullif(trim(p_channel_reference), '') is null then
    raise exception '退款原因和支付宝退款凭证必填';
  end if;

  if v_order.status = 'fulfilled' and v_order.type = 'plan_subscription' then
    if exists (select 1 from public.orders where user_id = v_order.user_id
      and type = 'plan_subscription' and status = 'fulfilled' and fulfilled_at > v_order.fulfilled_at) then
      raise exception '存在后续套餐订单，请先人工调整权益再登记退款';
    end if;
    update public.profiles set plan = 'free', plan_expires_at = null where id = v_order.user_id;
  elsif v_order.status = 'fulfilled' and v_order.type = 'domain_rental' then
    if exists (select 1 from public.orders where user_id = v_order.user_id
      and type = 'domain_renewal' and status = 'fulfilled'
      and product_snapshot->>'hostname' = v_order.product_snapshot->>'hostname') then
      raise exception '域名已有续费订单，请先人工处理权益再登记退款';
    end if;
    update public.domains set status = 'deleted'
      where user_id = v_order.user_id and lower(hostname) = lower(v_order.product_snapshot->>'hostname');
  elsif v_order.status = 'fulfilled' and v_order.type = 'domain_renewal' then
    v_domain_id := (v_order.product_snapshot->>'domainId')::uuid;
    v_months := (v_order.product_snapshot->>'durationMonths')::integer;
    if exists (select 1 from public.orders where user_id = v_order.user_id
      and type = 'domain_renewal' and status = 'fulfilled' and fulfilled_at > v_order.fulfilled_at
      and product_snapshot->>'domainId' = v_domain_id::text) then
      raise exception '存在后续域名续费，请先人工处理权益再登记退款';
    end if;
    update public.domains set expires_at = expires_at - make_interval(months => v_months)
      where id = v_domain_id and user_id = v_order.user_id;
  end if;

  insert into public.refunds(order_id, amount_cents, status, reason, channel_reference,
    operator_id, completed_at)
  values (v_order.id, v_order.amount_cents, 'completed', left(trim(p_reason), 500),
    left(trim(p_channel_reference), 200), p_operator_id, now());
  update public.payments set status = 'refunded' where order_id = v_order.id and status = 'success';
  update public.orders set status = 'refunded', updated_at = now() where id = v_order.id;
  insert into public.audit_events(user_id, event_type, message)
    values (p_operator_id, 'admin.order.refunded', '管理员登记订单退款 ' || v_order.order_no);
  return jsonb_build_object('status', 'refunded');
end;
$$;

revoke all on function public.create_plan_payment_order(uuid, text, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.create_domain_payment_order(uuid, text, text, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.create_domain_renewal_order(uuid, text, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.confirm_fm_payment(text, text, text, integer, integer, text, text, timestamptz, text, jsonb) from public, anon, authenticated;
revoke all on function public.record_order_refund(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_plan_payment_order(uuid, text, text, integer, timestamptz) to service_role;
grant execute on function public.create_domain_payment_order(uuid, text, text, text, integer, timestamptz) to service_role;
grant execute on function public.create_domain_renewal_order(uuid, text, uuid, integer, timestamptz) to service_role;
grant execute on function public.confirm_fm_payment(text, text, text, integer, integer, text, text, timestamptz, text, jsonb) to service_role;
grant execute on function public.record_order_refund(uuid, uuid, text, text) to service_role;
