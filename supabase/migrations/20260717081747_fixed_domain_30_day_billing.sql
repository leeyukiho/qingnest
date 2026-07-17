-- Domain billing uses fixed durations: every non-annual month is 30 days;
-- annual billing is 365 days. This avoids calendar-month drift.
create or replace function public.domain_duration_interval(p_duration_months integer)
returns interval
language sql
immutable
as $$
  select make_interval(days => case when p_duration_months = 12 then 365 else p_duration_months * 30 end);
$$;
revoke all on function public.domain_duration_interval(integer) from public, anon, authenticated;
grant execute on function public.domain_duration_interval(integer) to service_role;

-- Keep the wallet purchase and renewal RPCs aligned with the same fixed-day rule.
create or replace function public.purchase_domain_with_wallet(
  p_user_id uuid, p_hostname text, p_hostname_suffix text, p_duration_months integer
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_price public.domain_pricing%rowtype; v_account public.wallet_accounts%rowtype; v_domain public.domains%rowtype; v_amount integer; v_balance bigint;
begin
  if p_duration_months not in (1,3,6,12) then raise exception '不支持的租赁周期'; end if;
  if lower(p_hostname) = lower(p_hostname_suffix) or right(lower(p_hostname), char_length(p_hostname_suffix) + 1) <> '.' || lower(p_hostname_suffix) then raise exception '域名与后缀不匹配'; end if;
  perform pg_advisory_xact_lock(hashtextextended(lower(p_hostname), 0));
  if exists (select 1 from public.domains where lower(hostname) = lower(p_hostname) and status <> 'deleted') then raise exception '域名已被占用'; end if;
  select * into v_price from public.domain_pricing where lower(hostname_suffix) = lower(p_hostname_suffix) and enabled = true and setup_status = 'active';
  if not found then raise exception '域名后缀不可购买'; end if;
  v_amount := case p_duration_months when 1 then v_price.monthly_price_cents when 3 then v_price.quarterly_price_cents when 6 then v_price.semiannual_price_cents else v_price.annual_price_cents end;
  insert into public.wallet_accounts(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_account from public.wallet_accounts where user_id = p_user_id for update;
  if v_account.balance_cents < v_amount then raise exception '余额不足，请先充值'; end if;
  v_balance := v_account.balance_cents - v_amount;
  insert into public.domains(user_id, hostname, type, entitlement_source, status, expires_at) values (p_user_id, lower(p_hostname), 'platform_subdomain', 'paid_rental', 'active', now() + public.domain_duration_interval(p_duration_months)) returning * into v_domain;
  update public.wallet_accounts set balance_cents = v_balance, updated_at = now() where user_id = p_user_id;
  insert into public.wallet_ledger(user_id, amount_cents, balance_after_cents, kind, reference_type, reference_id, description) values (p_user_id, -v_amount, v_balance, 'domain_purchase', 'domain', v_domain.id, '购买域名 ' || v_domain.hostname);
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
  if v_domain.expires_at + public.domain_duration_interval(p_duration_months) > now() + public.domain_duration_interval(v_price.max_advance_months) then raise exception '续费后超过最长持有期限'; end if;
  v_amount := case p_duration_months when 1 then v_price.monthly_price_cents when 3 then v_price.quarterly_price_cents when 6 then v_price.semiannual_price_cents else v_price.annual_price_cents end;
  insert into public.wallet_accounts(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_account from public.wallet_accounts where user_id = p_user_id for update;
  if v_account.balance_cents < v_amount then raise exception '余额不足，请先充值'; end if;
  v_balance := v_account.balance_cents - v_amount;
  update public.domains set expires_at = expires_at + public.domain_duration_interval(p_duration_months) where id = v_domain.id;
  update public.wallet_accounts set balance_cents = v_balance, updated_at = now() where user_id = p_user_id;
  insert into public.wallet_ledger(user_id, amount_cents, balance_after_cents, kind, reference_type, reference_id, description) values (p_user_id, -v_amount, v_balance, 'domain_renewal', 'domain_renewal', v_ref, '续费域名 ' || v_domain.hostname);
  return jsonb_build_object('domainId', v_domain.id, 'balanceCents', v_balance);
end; $$;
