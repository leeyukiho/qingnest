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
        'ownerEmail', coalesce(p.email, U&'\\672A\\77E5\\7528\\6237'),
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
