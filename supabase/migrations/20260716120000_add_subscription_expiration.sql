alter table public.profiles
  add column if not exists plan_expires_at timestamptz;

comment on column public.profiles.plan_expires_at is
  'When the current paid subscription ends; null means the plan does not expire.';

alter table public.domains
  add column if not exists expires_at timestamptz;

update public.domains
set expires_at = created_at + interval '1 year'
where expires_at is null;

alter table public.domains
  alter column expires_at set default (now() + interval '1 year'),
  alter column expires_at set not null;

alter table public.domains
  drop constraint if exists domains_rental_period_check,
  add constraint domains_rental_period_check
    check (expires_at > created_at and expires_at <= created_at + interval '1 year');

comment on column public.domains.expires_at is
  'Domain access expiration; a rental period cannot exceed one year from creation.';
