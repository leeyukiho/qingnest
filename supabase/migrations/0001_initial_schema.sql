create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  plan text not null default 'free',
  created_at timestamptz not null default now()
);

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'pending_review', 'blocked', 'deleted')),
  active_deployment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.domains (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  hostname text not null unique,
  type text not null check (type in ('platform_subdomain', 'custom_domain')),
  status text not null default 'active' check (status in ('active', 'pending_review', 'blocked', 'deleted')),
  created_at timestamptz not null default now()
);

create table if not exists public.deployments (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  version integer not null,
  status text not null default 'uploading' check (status in ('uploading', 'scanning', 'active', 'failed', 'blocked', 'pending_review')),
  r2_prefix text not null,
  file_count integer not null default 0,
  total_bytes bigint not null default 0,
  entrypoint text,
  spa_fallback_enabled boolean not null default true,
  risk_score integer not null default 0,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  unique (site_id, version)
);

alter table public.sites
  add constraint sites_active_deployment_id_fkey
  foreign key (active_deployment_id)
  references public.deployments(id)
  deferrable initially deferred;

create table if not exists public.deployment_files (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references public.deployments(id) on delete cascade,
  path text not null,
  size bigint not null,
  content_type text not null,
  sha256 text,
  unique (deployment_id, path)
);

create table if not exists public.upload_sessions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'created' check (status in ('created', 'uploading', 'completed', 'expired', 'blocked')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  site_id uuid references public.sites(id) on delete set null,
  deployment_id uuid references public.deployments(id) on delete set null,
  event_type text not null,
  risk_score integer not null default 0,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.abuse_reports (
  id uuid primary key default gen_random_uuid(),
  hostname text not null,
  url text,
  reporter_email text,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'rejected')),
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_sites_updated_at on public.sites;
create trigger set_sites_updated_at
before update on public.sites
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.domains enable row level security;
alter table public.deployments enable row level security;
alter table public.deployment_files enable row level security;
alter table public.upload_sessions enable row level security;
alter table public.audit_events enable row level security;
alter table public.abuse_reports enable row level security;

create policy "profiles_read_own"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "sites_read_own"
  on public.sites for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "sites_insert_own"
  on public.sites for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "sites_update_own"
  on public.sites for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "domains_read_own"
  on public.domains for select
  to authenticated
  using (
    exists (
      select 1 from public.sites
      where sites.id = domains.site_id and sites.user_id = (select auth.uid())
    )
  );

create policy "domains_insert_own"
  on public.domains for insert
  to authenticated
  with check (
    exists (
      select 1 from public.sites
      where sites.id = domains.site_id and sites.user_id = (select auth.uid())
    )
  );

create policy "deployments_read_own"
  on public.deployments for select
  to authenticated
  using (
    exists (
      select 1 from public.sites
      where sites.id = deployments.site_id and sites.user_id = (select auth.uid())
    )
  );

create policy "deployments_insert_own"
  on public.deployments for insert
  to authenticated
  with check (
    exists (
      select 1 from public.sites
      where sites.id = deployments.site_id and sites.user_id = (select auth.uid())
    )
  );

create policy "deployments_update_own"
  on public.deployments for update
  to authenticated
  using (
    exists (
      select 1 from public.sites
      where sites.id = deployments.site_id and sites.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.sites
      where sites.id = deployments.site_id and sites.user_id = (select auth.uid())
    )
  );

create policy "deployment_files_read_own"
  on public.deployment_files for select
  to authenticated
  using (
    exists (
      select 1
      from public.deployments
      join public.sites on sites.id = deployments.site_id
      where deployments.id = deployment_files.deployment_id
        and sites.user_id = (select auth.uid())
    )
  );

create policy "deployment_files_insert_own"
  on public.deployment_files for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.deployments
      join public.sites on sites.id = deployments.site_id
      where deployments.id = deployment_files.deployment_id
        and sites.user_id = (select auth.uid())
    )
  );

create policy "upload_sessions_read_own"
  on public.upload_sessions for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "upload_sessions_insert_own"
  on public.upload_sessions for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "upload_sessions_update_own"
  on public.upload_sessions for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "audit_events_read_own"
  on public.audit_events for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "abuse_reports_insert_public"
  on public.abuse_reports for insert
  to anon, authenticated
  with check (true);

grant usage on schema public to anon, authenticated, service_role;

grant select, update on table public.profiles to authenticated;
grant select, insert, update on table public.sites to authenticated;
grant select, insert on table public.domains to authenticated;
grant select, insert, update on table public.deployments to authenticated;
grant select, insert on table public.deployment_files to authenticated;
grant select, insert, update on table public.upload_sessions to authenticated;
grant select on table public.audit_events to authenticated;
grant insert on table public.abuse_reports to anon, authenticated;

grant select, insert, update, delete on table
  public.profiles,
  public.sites,
  public.domains,
  public.deployments,
  public.deployment_files,
  public.upload_sessions,
  public.audit_events,
  public.abuse_reports
to service_role;

create index if not exists domains_hostname_idx on public.domains(hostname);
create index if not exists sites_user_status_idx on public.sites(user_id, status);
create index if not exists sites_active_deployment_id_idx on public.sites(active_deployment_id);
create index if not exists domains_site_id_idx on public.domains(site_id);
create index if not exists deployments_site_status_idx on public.deployments(site_id, status);
create index if not exists deployments_active_site_idx on public.deployments(site_id, activated_at desc)
  where status = 'active';
create index if not exists deployment_files_deployment_path_idx on public.deployment_files(deployment_id, path);
create index if not exists upload_sessions_site_id_idx on public.upload_sessions(site_id);
create index if not exists upload_sessions_user_created_idx on public.upload_sessions(user_id, created_at desc);
create index if not exists audit_events_user_created_idx on public.audit_events(user_id, created_at desc);
create index if not exists audit_events_site_created_idx on public.audit_events(site_id, created_at desc);
