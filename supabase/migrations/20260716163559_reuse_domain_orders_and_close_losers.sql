-- Reuse an unpaid checkout for the same user and hostname. Existing duplicate
-- checkouts are closed before the uniqueness rule is installed.
with ranked as (
  select id, row_number() over (
    partition by user_id, lower(product_snapshot->>'hostname')
    order by (status = 'pending' and expires_at > now() and pay_url is not null) desc,
      created_at asc, id asc
  ) as position
  from public.orders
  where type = 'domain_rental' and status in ('pending', 'payment_failed')
)
update public.orders o
set status = 'cancelled', pay_url = null, failure_code = 'DUPLICATE_CHECKOUT',
  failure_message = '已合并到同一域名的首个未付款订单', updated_at = now()
from ranked r where r.id = o.id and r.position > 1;

create unique index if not exists orders_one_unpaid_domain_per_user
  on public.orders (user_id, lower((product_snapshot->>'hostname')))
  where type = 'domain_rental' and status in ('pending', 'payment_failed');

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
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || lower(p_hostname), 0));

  update public.orders set status = 'expired', pay_url = null, updated_at = now()
  where user_id = p_user_id and type = 'domain_rental' and status = 'pending'
    and lower(product_snapshot->>'hostname') = lower(p_hostname) and expires_at <= now();

  select * into v_order from public.orders
  where user_id = p_user_id and type = 'domain_rental'
    and status in ('pending', 'payment_failed')
    and lower(product_snapshot->>'hostname') = lower(p_hostname)
  order by created_at asc limit 1 for update;
  if found then return v_order; end if;

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

-- Once a hostname is delivered, unpaid competing checkouts must no longer
-- present a working payment URL. Already-paid losers are handled by the
-- existing refund_pending flow.
create or replace function public.close_unpaid_domain_competitors()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  update public.orders
  set status = 'cancelled', pay_url = null, failure_code = 'DOMAIN_ALREADY_SOLD',
    failure_message = '该域名已被其他订单购买，本订单已自动关闭', updated_at = now()
  where type = 'domain_rental' and status in ('pending', 'payment_failed')
    and lower(product_snapshot->>'hostname') = lower(new.hostname)
    and user_id <> new.user_id;
  return new;
end;
$$;

drop trigger if exists close_unpaid_domain_competitors on public.domains;
create trigger close_unpaid_domain_competitors after insert on public.domains
for each row when (new.type = 'platform_subdomain' and new.status <> 'deleted')
execute function public.close_unpaid_domain_competitors();
