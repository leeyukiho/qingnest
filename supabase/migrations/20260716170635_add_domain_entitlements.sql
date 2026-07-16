alter table public.plan_catalog
  add column if not exists max_free_domains integer not null default 1
    check (max_free_domains >= 0);

update public.plan_catalog set max_free_domains = case key
  when 'free' then 1 when 'starter' then 1 when 'pro' then 3
  when 'business' then 10 else 1 end;

alter table public.domains
  add column if not exists entitlement_source text not null default 'plan_grant'
    check (entitlement_source in ('plan_grant', 'paid_rental')),
  add column if not exists grace_expires_at timestamptz;

update public.domains d
set entitlement_source = 'paid_rental'
where exists (
  select 1 from public.orders o
  where o.user_id = d.user_id
    and o.type in ('domain_rental', 'domain_renewal')
    and o.status in ('fulfilled', 'refund_pending')
    and lower(o.product_snapshot->>'hostname') = lower(d.hostname)
);

update public.domains
set expires_at = 'infinity'::timestamptz
where entitlement_source = 'plan_grant' and type = 'platform_subdomain';

create or replace function public.set_domain_entitlement()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if exists (
    select 1 from public.orders o
    where o.user_id = new.user_id and o.type = 'domain_rental'
      and o.status in ('paid', 'fulfilling', 'fulfilled')
      and lower(o.product_snapshot->>'hostname') = lower(new.hostname)
  ) then
    new.entitlement_source = 'paid_rental';
  elsif new.entitlement_source = 'plan_grant' then
    new.expires_at = 'infinity'::timestamptz;
  end if;
  return new;
end;
$$;

create or replace function public.convert_renewed_domain_to_rental()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if new.expires_at > old.expires_at then
    new.entitlement_source = 'paid_rental';
    new.grace_expires_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists set_domain_entitlement on public.domains;
create trigger set_domain_entitlement before insert on public.domains
for each row execute function public.set_domain_entitlement();

drop trigger if exists convert_renewed_domain_to_rental on public.domains;
create trigger convert_renewed_domain_to_rental before update of expires_at on public.domains
for each row execute function public.convert_renewed_domain_to_rental();

create or replace function public.reconcile_domain_entitlements()
returns table(hostname text)
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  return query
  with ranked as (
    select d.id, row_number() over (
      partition by d.user_id order by d.created_at asc, d.id asc
    ) as position, coalesce(pc.max_free_domains, 1) as allowed
    from public.domains d
    join public.profiles p on p.id = d.user_id
    left join public.plan_catalog pc on pc.key = p.plan and pc.enabled = true
    where d.type = 'platform_subdomain' and d.entitlement_source = 'plan_grant'
      and d.status <> 'deleted'
  ), restored as (
    update public.domains d set grace_expires_at = null
    from ranked r where d.id = r.id and r.position <= r.allowed
      and d.grace_expires_at is not null
  ), unbound as (
    update public.domains d
    set site_id = null, last_binding_change_at = null,
      grace_expires_at = coalesce(d.grace_expires_at, now() + interval '12 hours')
    from ranked r where d.id = r.id and r.position > r.allowed
      and (d.site_id is not null or d.grace_expires_at is null)
    returning d.hostname
  ) select u.hostname from unbound u;

  return query
  with expired_rentals as (
    update public.domains d
    set site_id = null, last_binding_change_at = null,
      grace_expires_at = coalesce(d.grace_expires_at, now() + interval '12 hours')
    where d.entitlement_source = 'paid_rental' and d.status <> 'deleted'
      and d.expires_at <= now() and (d.site_id is not null or d.grace_expires_at is null)
    returning d.hostname
  ) select e.hostname from expired_rentals e;

  return query
  with released as (
    update public.domains d
    set status = 'deleted', site_id = null, last_binding_change_at = null
    where d.status <> 'deleted' and d.grace_expires_at <= now()
    returning d.hostname
  ) select r.hostname from released r;
end;
$$;

revoke all on function public.set_domain_entitlement() from public, anon, authenticated;
revoke all on function public.convert_renewed_domain_to_rental() from public, anon, authenticated;
revoke all on function public.reconcile_domain_entitlements() from public, anon, authenticated;
grant execute on function public.reconcile_domain_entitlements() to service_role;
