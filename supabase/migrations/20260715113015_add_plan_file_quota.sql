alter table public.plan_catalog
  add column if not exists max_files integer not null default 1000
  check (max_files > 0 and max_files <= 20000);

update public.plan_catalog
set max_files = case key
  when 'free' then 1000
  when 'starter' then 3000
  when 'pro' then 10000
  when 'business' then 20000
  else max_files
end;
