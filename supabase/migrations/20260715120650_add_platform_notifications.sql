create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 4000),
  audience text not null check (audience in ('all', 'user')),
  user_id uuid references public.profiles(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint notifications_audience_target_check check (
    (audience = 'all' and user_id is null) or
    (audience = 'user' and user_id is not null)
  )
);

create table public.notification_receipts (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create index notifications_feed_idx on public.notifications(created_at desc);
create index notifications_user_feed_idx on public.notifications(user_id, created_at desc)
  where audience = 'user';
create index notification_receipts_user_idx on public.notification_receipts(user_id, acknowledged_at desc);

alter table public.notifications enable row level security;
alter table public.notification_receipts enable row level security;

revoke all on table public.notifications, public.notification_receipts from anon, authenticated;
grant select, insert, update, delete on table public.notifications, public.notification_receipts to service_role;
