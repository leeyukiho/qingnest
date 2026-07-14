create table if not exists public.plan_catalog (
  key text primary key check (key ~ '^[a-z][a-z0-9_-]{1,39}$'),
  label text not null check (char_length(label) between 1 and 40),
  enabled boolean not null default true,
  monthly_price_cents integer not null default 0 check (monthly_price_cents >= 0),
  max_sites integer not null check (max_sites > 0),
  max_public_sites integer not null check (max_public_sites > 0),
  max_storage_bytes bigint not null check (max_storage_bytes > 0),
  max_deployments_per_day integer not null check (max_deployments_per_day > 0),
  max_domains_per_site integer not null check (max_domains_per_site > 0),
  custom_domain boolean not null default false,
  password_protection boolean not null default false,
  access_analytics boolean not null default false,
  remove_branding boolean not null default false,
  rollback boolean not null default true,
  source_build boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.domain_pricing (
  domain_type text primary key check (domain_type in ('platform_subdomain', 'custom_domain')),
  label text not null,
  price_cents integer not null default 0 check (price_cents >= 0),
  billing_period text not null check (billing_period in ('month', 'year', 'one_time')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.plan_catalog
  (key, label, enabled, monthly_price_cents, max_sites, max_public_sites, max_storage_bytes, max_deployments_per_day, max_domains_per_site, custom_domain, password_protection, access_analytics, remove_branding, rollback, source_build)
values
  ('free', '免费版', true, 0, 3, 1, 157286400, 20, 1, false, false, false, false, true, false),
  ('starter', '入门版', true, 1900, 20, 3, 2147483648, 100, 1, false, true, true, true, true, false),
  ('pro', '专业版', true, 6900, 100, 10, 21474836480, 500, 5, true, true, true, true, true, true)
on conflict (key) do nothing;

insert into public.domain_pricing (domain_type, label, price_cents, billing_period)
values
  ('platform_subdomain', '平台子域名', 990, 'year'),
  ('custom_domain', '自定义域名接入', 0, 'year')
on conflict (domain_type) do nothing;

alter table public.plan_catalog enable row level security;
alter table public.domain_pricing enable row level security;
revoke all on table public.plan_catalog, public.domain_pricing from public, anon, authenticated;
grant select, insert, update, delete on table public.plan_catalog, public.domain_pricing to service_role;
