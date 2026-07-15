alter table public.plan_catalog
  add column if not exists max_upload_sessions_per_hour integer not null default 5
  check (max_upload_sessions_per_hour > 0 and max_upload_sessions_per_hour <= 10000);

update public.plan_catalog
set max_upload_sessions_per_hour = case key
  when 'free' then 5
  when 'starter' then 20
  when 'pro' then 100
  when 'business' then 200
  else max_upload_sessions_per_hour
end;
