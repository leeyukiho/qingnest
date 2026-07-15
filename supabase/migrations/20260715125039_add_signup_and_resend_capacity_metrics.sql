create table if not exists public.resend_email_usage_daily (
  usage_date date primary key,
  sent_count bigint not null default 0 check (sent_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.infrastructure_capacity_settings
  add column if not exists resend_plan text not null default 'free'
  check (resend_plan in ('free', 'pro', 'scale'));

alter table public.resend_email_usage_daily enable row level security;
revoke all on table public.resend_email_usage_daily from public, anon, authenticated;
grant select, insert, update on table public.resend_email_usage_daily to service_role;

create or replace function public.record_resend_email_send(p_usage_date date)
returns bigint
language sql
volatile
security invoker
set search_path = ''
as $$
  insert into public.resend_email_usage_daily (usage_date, sent_count, updated_at)
  values (p_usage_date, 1, now())
  on conflict (usage_date) do update
    set sent_count = public.resend_email_usage_daily.sent_count + 1,
        updated_at = excluded.updated_at
  returning sent_count;
$$;

revoke execute on function public.record_resend_email_send(date) from public, anon, authenticated;
grant execute on function public.record_resend_email_send(date) to service_role;
