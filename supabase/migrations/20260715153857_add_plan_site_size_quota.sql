alter table public.plan_catalog
  add column if not exists max_site_bytes bigint not null default 52428800
  check (max_site_bytes > 0);

update public.plan_catalog
set max_site_bytes = case key
  when 'free' then 52428800
  when 'starter' then 104857600
  when 'pro' then 524288000
  when 'business' then 1073741824
  else max_site_bytes
end;
