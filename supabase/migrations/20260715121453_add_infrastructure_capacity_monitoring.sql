create table if not exists public.infrastructure_capacity_settings (
  id boolean primary key default true check (id),
  stage text not null default 'workers_paid' check (stage in ('workers_paid', 'workers_paid_stable', 'pages_pro')),
  limits jsonb not null,
  warning_percent integer not null default 70 check (warning_percent between 1 and 100),
  critical_percent integer not null default 90 check (critical_percent between 1 and 100),
  notification_cooldown_hours integer not null default 24 check (notification_cooldown_hours between 1 and 720),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.infrastructure_usage_monthly (
  month_start date primary key,
  pages_deployments bigint not null default 0 check (pages_deployments >= 0),
  pages_failures bigint not null default 0 check (pages_failures >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.infrastructure_alert_state (
  metric_key text primary key,
  severity text not null check (severity in ('warning', 'critical')),
  last_percent numeric(8,2) not null default 0,
  last_notified_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.infrastructure_capacity_settings (id, stage, limits) values
  (true, 'workers_paid', '{"workerRequests":10000000,"kvReads":10000000,"kvWrites":1000000,"r2StorageBytes":10737418240,"r2ClassA":1000000,"r2ClassB":10000000,"pagesDeployments":500,"pagesProjects":85}'::jsonb)
on conflict (id) do nothing;

alter table public.infrastructure_capacity_settings enable row level security;
alter table public.infrastructure_usage_monthly enable row level security;
alter table public.infrastructure_alert_state enable row level security;
revoke all on table public.infrastructure_capacity_settings, public.infrastructure_usage_monthly, public.infrastructure_alert_state from public, anon, authenticated;
grant select, insert, update on table public.infrastructure_capacity_settings, public.infrastructure_usage_monthly, public.infrastructure_alert_state to service_role;
