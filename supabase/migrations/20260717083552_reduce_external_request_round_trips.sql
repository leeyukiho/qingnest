create index if not exists deployments_site_created_idx
  on public.deployments (site_id, created_at desc);

create index if not exists profiles_plan_expiry_idx
  on public.profiles (plan_expires_at)
  where plan_expires_at is not null;

create index if not exists domains_paid_expiry_idx
  on public.domains (expires_at)
  where entitlement_source = 'paid_rental' and status <> 'deleted';

create index if not exists domains_grace_expiry_idx
  on public.domains (grace_expires_at)
  where grace_expires_at is not null and status <> 'deleted';

create or replace function public.get_account_snapshot(
  p_user_id uuid,
  p_email text,
  p_day_start timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  insert into public.profiles (id, email)
  values (p_user_id, p_email)
  on conflict (id) do update
    set email = excluded.email
    where profiles.email is distinct from excluded.email;

  select jsonb_build_object(
    'email', p.email,
    'plan', p.plan,
    'role', p.role,
    'plan_expires_at', p.plan_expires_at,
    'created_at', p.created_at,
    'wallet_balance_cents', coalesce(w.balance_cents, 0),
    'sites', coalesce(s.site_count, 0),
    'public_sites', coalesce(d.public_sites, 0),
    'free_domains', coalesce(d.free_domains, 0),
    'storage_bytes', coalesce(s.storage_bytes, 0),
    'deployments_today', coalesce(x.deployments_today, 0)
  )
  into v_result
  from public.profiles p
  left join public.wallet_accounts w on w.user_id = p.id
  left join lateral (
    select
      count(*)::integer as site_count,
      coalesce(sum(dep.total_bytes), 0)::bigint as storage_bytes
    from public.sites site
    left join public.deployments dep on dep.id = site.active_deployment_id
    where site.user_id = p.id and site.status <> 'deleted'
  ) s on true
  left join lateral (
    select
      count(distinct domain.site_id) filter (where domain.status = 'active')::integer as public_sites,
      count(*) filter (where domain.entitlement_source = 'plan_grant')::integer as free_domains
    from public.domains domain
    where domain.user_id = p.id and domain.status <> 'deleted'
  ) d on true
  left join lateral (
    select count(*)::integer as deployments_today
    from public.deployments deployment
    join public.sites site on site.id = deployment.site_id
    where site.user_id = p.id and deployment.created_at >= p_day_start
  ) x on true
  where p.id = p_user_id;

  return v_result;
end;
$$;

create or replace function public.get_user_notifications(p_user_id uuid)
returns table(
  id uuid,
  title text,
  body text,
  audience text,
  acknowledged_at timestamptz,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    n.id,
    n.title,
    n.body,
    n.audience::text,
    r.acknowledged_at,
    n.created_at
  from public.notifications n
  left join public.notification_receipts r
    on r.notification_id = n.id and r.user_id = p_user_id
  where n.audience = 'all' or n.user_id = p_user_id
  order by n.created_at desc
  limit 100;
$$;

create or replace function public.acknowledge_user_notification(
  p_user_id uuid,
  p_notification_id uuid
)
returns timestamptz
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_acknowledged_at timestamptz := now();
begin
  if not exists (
    select 1 from public.notifications
    where id = p_notification_id
      and (audience = 'all' or user_id = p_user_id)
  ) then
    raise exception 'Notification does not exist or is not accessible';
  end if;

  insert into public.notification_receipts (notification_id, user_id, acknowledged_at)
  values (p_notification_id, p_user_id, v_acknowledged_at)
  on conflict (notification_id, user_id) do update
    set acknowledged_at = excluded.acknowledged_at;

  return v_acknowledged_at;
end;
$$;

create or replace function public.acknowledge_all_user_notifications(p_user_id uuid)
returns timestamptz
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_acknowledged_at timestamptz := now();
begin
  insert into public.notification_receipts (notification_id, user_id, acknowledged_at)
  select n.id, p_user_id, v_acknowledged_at
  from public.notifications n
  where n.audience = 'all' or n.user_id = p_user_id
  on conflict (notification_id, user_id) do update set acknowledged_at = excluded.acknowledged_at;
  return v_acknowledged_at;
end;
$$;

create or replace function public.increment_pages_deployment(
  p_month_start date,
  p_failed boolean default false
)
returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  insert into public.infrastructure_usage_monthly (
    month_start, pages_deployments, pages_failures, updated_at
  ) values (
    p_month_start, 1, case when p_failed then 1 else 0 end, now()
  )
  on conflict (month_start) do update set
    pages_deployments = infrastructure_usage_monthly.pages_deployments + 1,
    pages_failures = infrastructure_usage_monthly.pages_failures + case when p_failed then 1 else 0 end,
    updated_at = now();
$$;

create or replace function public.get_capacity_snapshot(
  p_month_start date,
  p_usage_date date
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'settings', coalesce((select to_jsonb(s) from public.infrastructure_capacity_settings s where s.id = true), '{}'::jsonb),
    'usage', coalesce((select to_jsonb(u) from public.infrastructure_usage_monthly u where u.month_start = p_month_start), '{}'::jsonb),
    'accelerated_sites', (select count(*) from public.pages_accelerations where status = 'accelerated'),
    'pages_projects', (select count(*) from public.pages_accelerations where pages_project_name is not null),
    'resend_emails_daily', coalesce((select sum(sent_count) from public.resend_email_usage_daily where usage_date = p_usage_date), 0),
    'resend_emails_monthly', coalesce((select sum(sent_count) from public.resend_email_usage_daily where usage_date >= p_month_start), 0)
  );
$$;

create or replace function public.run_payment_maintenance(p_now timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_reclaimed text[];
  v_failed_order_ids uuid[];
begin
  update public.orders
  set status = 'expired', updated_at = p_now
  where status = 'pending' and expires_at < p_now;

  update public.wallet_topups
  set status = 'expired', updated_at = p_now
  where status = 'pending' and expires_at < p_now;

  update public.domain_reservations
  set status = 'released', updated_at = p_now
  where status = 'active' and expires_at < p_now;

  update public.profiles
  set plan = 'free', plan_expires_at = null
  where plan_expires_at is not null and plan_expires_at <= p_now;

  select coalesce(array_agg(hostname), '{}'::text[])
  into v_reclaimed
  from public.reconcile_domain_entitlements();

  select coalesce(array_agg(order_id), '{}'::uuid[])
  into v_failed_order_ids
  from (
    select order_id
    from public.fulfillment_jobs
    where status = 'failed' and next_attempt_at <= p_now
    order by next_attempt_at
    limit 20
  ) due;

  return jsonb_build_object(
    'reclaimed_hostnames', to_jsonb(v_reclaimed),
    'failed_order_ids', to_jsonb(v_failed_order_ids)
  );
end;
$$;

create or replace function public.get_admin_full_overview(
  p_admin_id uuid,
  p_today_start timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select public.get_admin_overview(p_admin_id) || jsonb_build_object(
    'todayUsers', (select count(*) from public.profiles where created_at >= p_today_start),
    'successfulTransactionAmountCents', coalesce((select sum(coalesce(actual_amount_cents, amount_cents)) from public.payments where status = 'success'), 0),
    'domainsList', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'userId', d.user_id,
        'ownerEmail', coalesce(p.email, '未知用户'),
        'siteId', d.site_id,
        'siteName', s.name,
        'hostname', d.hostname,
        'type', d.type,
        'status', d.status,
        'createdAt', d.created_at
      ) order by d.created_at desc)
      from (
        select * from public.domains
        where status <> 'deleted'
        order by created_at desc
        limit 100
      ) d
      left join public.profiles p on p.id = d.user_id
      left join public.sites s on s.id = d.site_id
    ), '[]'::jsonb),
    'plans', coalesce((select jsonb_agg(to_jsonb(plan) order by monthly_price_cents) from public.plan_catalog plan), '[]'::jsonb),
    'domainPricing', coalesce((select jsonb_agg(to_jsonb(price) order by domain_type) from public.domain_pricing price), '[]'::jsonb)
  );
$$;

revoke execute on function public.get_account_snapshot(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.get_user_notifications(uuid) from public, anon, authenticated;
revoke execute on function public.acknowledge_user_notification(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.increment_pages_deployment(date, boolean) from public, anon, authenticated;
revoke execute on function public.get_capacity_snapshot(date, date) from public, anon, authenticated;
revoke execute on function public.run_payment_maintenance(timestamptz) from public, anon, authenticated;
revoke execute on function public.get_admin_full_overview(uuid, timestamptz) from public, anon, authenticated;

grant execute on function public.get_account_snapshot(uuid, text, timestamptz) to service_role;
grant execute on function public.get_user_notifications(uuid) to service_role;
grant execute on function public.acknowledge_user_notification(uuid, uuid) to service_role;
grant execute on function public.acknowledge_all_user_notifications(uuid) to service_role;
grant execute on function public.increment_pages_deployment(date, boolean) to service_role;
grant execute on function public.get_capacity_snapshot(date, date) to service_role;
grant execute on function public.run_payment_maintenance(timestamptz) to service_role;
grant execute on function public.get_admin_full_overview(uuid, timestamptz) to service_role;
