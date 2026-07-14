alter table public.domains
  add column if not exists user_id uuid references public.profiles(id) on delete cascade;

update public.domains as domains
set user_id = sites.user_id
from public.sites as sites
where sites.id = domains.site_id
  and domains.user_id is null;

alter table public.domains
  alter column user_id set not null,
  alter column site_id drop not null;

drop policy if exists "domains_read_own" on public.domains;
drop policy if exists "domains_insert_own" on public.domains;

create policy "domains_read_own"
  on public.domains for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "domains_insert_own"
  on public.domains for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "domains_update_own"
  on public.domains for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant update on table public.domains to authenticated;

create index if not exists domains_user_status_idx on public.domains(user_id, status);
