create table public.wallet_accounts (
  user_id uuid primary key references public.profiles(id) on delete restrict,
  balance_cents bigint not null default 0 check (balance_cents >= 0),
  updated_at timestamptz not null default now()
);

create table public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  amount_cents bigint not null check (amount_cents <> 0),
  balance_after_cents bigint not null check (balance_after_cents >= 0),
  kind text not null check (kind in ('topup', 'domain_purchase', 'domain_renewal', 'plan_purchase', 'admin_adjustment')),
  reference_type text not null,
  reference_id uuid not null,
  description text not null,
  created_at timestamptz not null default now(),
  unique (reference_type, reference_id)
);
create index wallet_ledger_user_created_idx on public.wallet_ledger(user_id, created_at desc);

create table public.wallet_topups (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique check (order_no ~ '^[A-Za-z0-9]{8,32}$'),
  user_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'payment_failed', 'paid', 'expired', 'cancelled')),
  amount_cents integer not null check (amount_cents >= 100),
  actual_amount_cents integer,
  provider_order_id text unique,
  pay_url text,
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index wallet_topups_user_created_idx on public.wallet_topups(user_id, created_at desc);
create index wallet_topups_pending_expiry_idx on public.wallet_topups(expires_at) where status = 'pending';

alter table public.wallet_accounts enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.wallet_topups enable row level security;
revoke all on table public.wallet_accounts, public.wallet_ledger, public.wallet_topups from public, anon, authenticated;
grant select, insert, update, delete on table public.wallet_accounts, public.wallet_ledger, public.wallet_topups to service_role;

create or replace function public.create_wallet_topup(
  p_user_id uuid, p_order_no text, p_amount_cents integer, p_expires_at timestamptz
) returns public.wallet_topups language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_topup public.wallet_topups%rowtype;
begin
  if p_amount_cents < 100 or p_amount_cents > 100000000 then raise exception '充值金额必须在 1 元至 100 万元之间'; end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '10 minutes 30 seconds' then raise exception '充值支付期限必须为 10 分钟'; end if;
  insert into public.wallet_accounts(user_id) values (p_user_id) on conflict (user_id) do nothing;
  insert into public.wallet_topups(order_no, user_id, amount_cents, expires_at)
    values (p_order_no, p_user_id, p_amount_cents, p_expires_at) returning * into v_topup;
  return v_topup;
end; $$;

create or replace function public.confirm_wallet_topup(
  p_order_no text, p_provider_order_id text, p_amount_cents integer,
  p_actual_amount_cents integer, p_paid_at timestamptz
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_topup public.wallet_topups%rowtype; v_account public.wallet_accounts%rowtype; v_balance bigint;
begin
  select * into v_topup from public.wallet_topups where order_no = p_order_no for update;
  if not found then raise exception '充值订单不存在'; end if;
  if v_topup.status = 'paid' then return jsonb_build_object('status', 'paid', 'duplicate', true); end if;
  if v_topup.status in ('cancelled', 'expired') then raise exception '充值订单已关闭'; end if;
  if v_topup.amount_cents <> p_amount_cents then raise exception '充值订单金额不一致'; end if;
  if p_actual_amount_cents <= 0 then raise exception '实际到账金额无效'; end if;
  if exists (select 1 from public.wallet_topups where provider_order_id = p_provider_order_id and id <> v_topup.id) then raise exception '支付流水已被其他充值订单使用'; end if;
  insert into public.wallet_accounts(user_id) values (v_topup.user_id) on conflict (user_id) do nothing;
  select * into v_account from public.wallet_accounts where user_id = v_topup.user_id for update;
  v_balance := v_account.balance_cents + p_actual_amount_cents;
  insert into public.wallet_ledger(user_id, amount_cents, balance_after_cents, kind, reference_type, reference_id, description)
    values (v_topup.user_id, p_actual_amount_cents, v_balance, 'topup', 'wallet_topup', v_topup.id, '支付宝充值')
    on conflict (reference_type, reference_id) do nothing;
  if found then update public.wallet_accounts set balance_cents = v_balance, updated_at = now() where user_id = v_topup.user_id; end if;
  update public.wallet_topups set status = 'paid', actual_amount_cents = p_actual_amount_cents,
    provider_order_id = p_provider_order_id, paid_at = p_paid_at, updated_at = now() where id = v_topup.id;
  return jsonb_build_object('status', 'paid', 'duplicate', false, 'balanceCents', v_balance);
end; $$;

create or replace function public.purchase_domain_with_wallet(
  p_user_id uuid, p_hostname text, p_hostname_suffix text, p_duration_months integer
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_price public.domain_pricing%rowtype; v_account public.wallet_accounts%rowtype; v_domain public.domains%rowtype; v_amount integer; v_balance bigint;
begin
  if p_duration_months not in (1,3,6,12) then raise exception '不支持的租赁周期'; end if;
  if lower(p_hostname) = lower(p_hostname_suffix)
     or right(lower(p_hostname), char_length(p_hostname_suffix) + 1) <> '.' || lower(p_hostname_suffix) then
    raise exception '域名与后缀不匹配';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(lower(p_hostname), 0));
  if exists (select 1 from public.domains where lower(hostname) = lower(p_hostname) and status <> 'deleted') then raise exception '域名已被占用'; end if;
  select * into v_price from public.domain_pricing where lower(hostname_suffix) = lower(p_hostname_suffix) and enabled = true and setup_status = 'active';
  if not found then raise exception '域名后缀不可购买'; end if;
  v_amount := case p_duration_months when 1 then v_price.monthly_price_cents when 3 then v_price.quarterly_price_cents when 6 then v_price.semiannual_price_cents else v_price.annual_price_cents end;
  insert into public.wallet_accounts(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_account from public.wallet_accounts where user_id = p_user_id for update;
  if v_account.balance_cents < v_amount then raise exception '余额不足，请先充值'; end if;
  v_balance := v_account.balance_cents - v_amount;
  insert into public.domains(user_id, hostname, type, entitlement_source, status, expires_at)
    values (p_user_id, lower(p_hostname), 'platform_subdomain', 'paid_rental', 'active', now() + make_interval(months => p_duration_months)) returning * into v_domain;
  update public.wallet_accounts set balance_cents = v_balance, updated_at = now() where user_id = p_user_id;
  insert into public.wallet_ledger(user_id, amount_cents, balance_after_cents, kind, reference_type, reference_id, description)
    values (p_user_id, -v_amount, v_balance, 'domain_purchase', 'domain', v_domain.id, '购买域名 ' || v_domain.hostname);
  return jsonb_build_object('domainId', v_domain.id, 'balanceCents', v_balance);
end; $$;

create or replace function public.renew_domain_with_wallet(p_user_id uuid, p_domain_id uuid, p_duration_months integer)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_domain public.domains%rowtype; v_price public.domain_pricing%rowtype; v_account public.wallet_accounts%rowtype; v_amount integer; v_balance bigint; v_ref uuid := gen_random_uuid();
begin
  if p_duration_months not in (1,3,6,12) then raise exception '不支持的续费周期'; end if;
  select * into v_domain from public.domains where id = p_domain_id for update;
  if not found or v_domain.user_id <> p_user_id or v_domain.entitlement_source <> 'paid_rental' or v_domain.status = 'deleted' then raise exception '域名不存在或不可续费'; end if;
  if v_domain.expires_at <= now() then raise exception '域名已经到期'; end if;
  select * into v_price from public.domain_pricing where enabled = true and setup_status = 'active' and lower(v_domain.hostname) like '%.' || lower(hostname_suffix) order by char_length(hostname_suffix) desc limit 1;
  if not found then raise exception '域名价格配置不存在'; end if;
  if v_domain.expires_at > now() + make_interval(days => v_price.renewal_window_days) then raise exception '尚未进入续费窗口'; end if;
  if v_domain.expires_at + make_interval(months => p_duration_months) > now() + make_interval(months => v_price.max_advance_months) then raise exception '续费后超过最长持有期限'; end if;
  v_amount := case p_duration_months when 1 then v_price.monthly_price_cents when 3 then v_price.quarterly_price_cents when 6 then v_price.semiannual_price_cents else v_price.annual_price_cents end;
  insert into public.wallet_accounts(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_account from public.wallet_accounts where user_id = p_user_id for update;
  if v_account.balance_cents < v_amount then raise exception '余额不足，请先充值'; end if;
  v_balance := v_account.balance_cents - v_amount;
  update public.domains set expires_at = expires_at + make_interval(months => p_duration_months) where id = v_domain.id;
  update public.wallet_accounts set balance_cents = v_balance, updated_at = now() where user_id = p_user_id;
  insert into public.wallet_ledger(user_id, amount_cents, balance_after_cents, kind, reference_type, reference_id, description)
    values (p_user_id, -v_amount, v_balance, 'domain_renewal', 'domain_renewal', v_ref, '续费域名 ' || v_domain.hostname);
  return jsonb_build_object('domainId', v_domain.id, 'balanceCents', v_balance);
end; $$;

create or replace function public.purchase_plan_with_wallet(p_user_id uuid, p_plan_key text, p_duration_months integer)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_plan public.plan_catalog%rowtype; v_account public.wallet_accounts%rowtype; v_amount integer; v_balance bigint; v_ref uuid := gen_random_uuid();
begin
  if p_duration_months not in (1,3,6,12) then raise exception '不支持的套餐周期'; end if;
  select * into v_plan from public.plan_catalog where key = p_plan_key and enabled = true;
  if not found or v_plan.key = 'free' then raise exception '套餐不可购买'; end if;
  v_amount := v_plan.renewal_price_cents * p_duration_months;
  insert into public.wallet_accounts(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_account from public.wallet_accounts where user_id = p_user_id for update;
  if v_account.balance_cents < v_amount then raise exception '余额不足，请先充值'; end if;
  v_balance := v_account.balance_cents - v_amount;
  update public.profiles set plan = v_plan.key, plan_expires_at = greatest(now(), coalesce(plan_expires_at, now())) + make_interval(months => p_duration_months) where id = p_user_id;
  update public.wallet_accounts set balance_cents = v_balance, updated_at = now() where user_id = p_user_id;
  insert into public.wallet_ledger(user_id, amount_cents, balance_after_cents, kind, reference_type, reference_id, description)
    values (p_user_id, -v_amount, v_balance, 'plan_purchase', 'plan_purchase', v_ref, '购买套餐 ' || v_plan.label);
  return jsonb_build_object('planKey', v_plan.key, 'balanceCents', v_balance);
end; $$;

revoke all on function public.create_wallet_topup(uuid,text,integer,timestamptz) from public, anon, authenticated;
revoke all on function public.confirm_wallet_topup(text,text,integer,integer,timestamptz) from public, anon, authenticated;
revoke all on function public.purchase_domain_with_wallet(uuid,text,text,integer) from public, anon, authenticated;
revoke all on function public.renew_domain_with_wallet(uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.purchase_plan_with_wallet(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.create_wallet_topup(uuid,text,integer,timestamptz) to service_role;
grant execute on function public.confirm_wallet_topup(text,text,integer,integer,timestamptz) to service_role;
grant execute on function public.purchase_domain_with_wallet(uuid,text,text,integer) to service_role;
grant execute on function public.renew_domain_with_wallet(uuid,uuid,integer) to service_role;
grant execute on function public.purchase_plan_with_wallet(uuid,text,integer) to service_role;
