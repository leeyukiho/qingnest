alter table public.domain_pricing
  add column if not exists cloudflare_zone_id text,
  add column if not exists cloudflare_zone_status text,
  add column if not exists cloudflare_nameservers text[] not null default '{}',
  add column if not exists cloudflare_dns_record_id text,
  add column if not exists cloudflare_worker_route_id text,
  add column if not exists setup_status text not null default 'pending_zone',
  add column if not exists setup_error text,
  add column if not exists last_checked_at timestamptz,
  add column if not exists next_check_at timestamptz;

alter table public.domain_pricing
  add constraint domain_pricing_setup_status_check
  check (setup_status in ('pending_zone', 'pending_nameservers', 'configuring', 'active', 'error'));

update public.domain_pricing
set cloudflare_zone_id = coalesce(cloudflare_zone_id, nullif(current_setting('app.cloudflare_zone_id', true), '')),
    cloudflare_zone_status = 'active',
    setup_status = 'active',
    last_checked_at = now(),
    next_check_at = null
where enabled = true
  and setup_status = 'pending_zone';

create index if not exists domain_pricing_setup_due_idx
  on public.domain_pricing (next_check_at)
  where setup_status in ('pending_zone', 'pending_nameservers', 'configuring', 'error');

alter table public.infrastructure_usage_monthly
  add column if not exists cloudflare_api_requests bigint not null default 0 check (cloudflare_api_requests >= 0),
  add column if not exists cloudflare_api_failures bigint not null default 0 check (cloudflare_api_failures >= 0);

create or replace function public.increment_infrastructure_usage(
  usage_month date,
  cloudflare_requests_delta bigint default 0,
  cloudflare_failures_delta bigint default 0
)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.infrastructure_usage_monthly (
    month_start,
    cloudflare_api_requests,
    cloudflare_api_failures,
    updated_at
  ) values (
    usage_month,
    greatest(cloudflare_requests_delta, 0),
    greatest(cloudflare_failures_delta, 0),
    now()
  )
  on conflict (month_start) do update
  set cloudflare_api_requests = public.infrastructure_usage_monthly.cloudflare_api_requests + excluded.cloudflare_api_requests,
      cloudflare_api_failures = public.infrastructure_usage_monthly.cloudflare_api_failures + excluded.cloudflare_api_failures,
      updated_at = now();
$$;

revoke all on function public.increment_infrastructure_usage(date, bigint, bigint) from public, anon, authenticated;
grant execute on function public.increment_infrastructure_usage(date, bigint, bigint) to service_role;

comment on function public.increment_infrastructure_usage(date, bigint, bigint) is
  'Atomically records low-volume Cloudflare control-plane API usage from the trusted Worker.';
