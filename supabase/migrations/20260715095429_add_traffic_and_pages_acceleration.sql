create table if not exists public.site_traffic_hourly (
  site_id uuid not null references public.sites(id) on delete cascade,
  bucket_start timestamptz not null,
  requests bigint not null default 0 check (requests >= 0),
  bytes_sent bigint not null default 0 check (bytes_sent >= 0),
  updated_at timestamptz not null default now(),
  primary key (site_id, bucket_start)
);

create table if not exists public.pages_accelerations (
  site_id uuid primary key references public.sites(id) on delete cascade,
  hostname text not null unique,
  pages_project_name text unique,
  pages_deployment_id text,
  bypass_route_id text,
  status text not null default 'shared' check (status in ('shared', 'provisioning', 'binding', 'verifying', 'accelerated', 'cooling', 'deleting', 'failed')),
  hot_windows integer not null default 0 check (hot_windows >= 0),
  cool_windows integer not null default 0 check (cool_windows >= 0),
  temporary_until timestamptz,
  last_request_count bigint not null default 0 check (last_request_count >= 0),
  last_error text,
  retry_count integer not null default 0 check (retry_count >= 0),
  next_retry_at timestamptz,
  accelerated_at timestamptz,
  last_evaluated_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists pages_accelerations_status_retry_idx
  on public.pages_accelerations (status, next_retry_at);
create index if not exists site_traffic_hourly_bucket_idx
  on public.site_traffic_hourly (bucket_start desc);

alter table public.site_traffic_hourly enable row level security;
alter table public.pages_accelerations enable row level security;
revoke all on table public.site_traffic_hourly, public.pages_accelerations from public, anon, authenticated;
grant select, insert, update, delete on table public.site_traffic_hourly, public.pages_accelerations to service_role;
