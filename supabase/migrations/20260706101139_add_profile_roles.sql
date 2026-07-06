alter table public.profiles
  add column if not exists role text not null default 'user';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_check check (role in ('user', 'admin'));
  end if;
end;
$$;

revoke update on table public.profiles from authenticated;
grant update (email) on table public.profiles to authenticated;

create index if not exists profiles_role_idx on public.profiles(role);
