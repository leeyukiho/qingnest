create table if not exists public.auth_email_sends (
  email text not null,
  purpose text not null,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (email, purpose),
  constraint auth_email_sends_purpose_check check (purpose in ('signup_confirmation')),
  constraint auth_email_sends_email_normalized_check check (email = lower(trim(email)) and email <> '')
);

alter table public.auth_email_sends enable row level security;

revoke all on table public.auth_email_sends from anon, authenticated;

create index if not exists auth_email_sends_expires_idx
  on public.auth_email_sends(expires_at);

create or replace function public.claim_signup_confirmation_email(
  p_email text,
  p_ttl_seconds integer default 86400
)
returns table (
  claimed boolean,
  sent_at timestamptz,
  expires_at timestamptz
)
language plpgsql
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_now timestamptz := now();
  v_ttl_seconds integer := greatest(3600, least(coalesce(p_ttl_seconds, 86400), 86400));
  v_expires_at timestamptz := v_now + make_interval(secs => v_ttl_seconds);
begin
  if v_email = '' then
    raise exception 'email is required';
  end if;

  insert into public.auth_email_sends (
    email,
    purpose,
    sent_at,
    expires_at,
    created_at,
    updated_at
  )
  values (
    v_email,
    'signup_confirmation',
    v_now,
    v_expires_at,
    v_now,
    v_now
  )
  on conflict (email, purpose) do update
    set sent_at = excluded.sent_at,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    where public.auth_email_sends.expires_at <= v_now
  returning true, public.auth_email_sends.sent_at, public.auth_email_sends.expires_at
    into claimed, sent_at, expires_at;

  if claimed is not null then
    return next;
    return;
  end if;

  select false, sends.sent_at, sends.expires_at
    into claimed, sent_at, expires_at
  from public.auth_email_sends as sends
  where sends.email = v_email
    and sends.purpose = 'signup_confirmation';

  return next;
end;
$$;

revoke all on function public.claim_signup_confirmation_email(text, integer) from public, anon, authenticated;
grant execute on function public.claim_signup_confirmation_email(text, integer) to service_role;
