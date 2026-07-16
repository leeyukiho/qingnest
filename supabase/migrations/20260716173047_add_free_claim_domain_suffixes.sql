alter table public.domain_pricing
  add column if not exists free_claim_enabled boolean not null default false;

update public.domain_pricing
set free_claim_enabled = true, updated_at = now()
where lower(hostname_suffix) = '985201314.xyz'
  and enabled = true and setup_status = 'active';

create or replace function public.claim_free_platform_domain(
  p_user_id uuid,
  p_hostname text,
  p_hostname_suffix text,
  p_status text,
  p_site_id uuid default null
) returns public.domains
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_domain public.domains%rowtype;
  v_allowed integer;
begin
  if p_status not in ('active', 'pending_review') then raise exception '域名状态无效'; end if;
  if lower(p_hostname) = lower(p_hostname_suffix)
     or right(lower(p_hostname), char_length(p_hostname_suffix) + 1) <> '.' || lower(p_hostname_suffix) then
    raise exception '域名与后缀不匹配';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('free-domain-user:' || p_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(lower(p_hostname), 0));

  if not exists (
    select 1 from public.domain_pricing
    where lower(hostname_suffix) = lower(p_hostname_suffix)
      and enabled = true and free_claim_enabled = true and setup_status = 'active'
  ) then raise exception '该域名后缀不支持套餐免费领取'; end if;

  select coalesce(pc.max_free_domains, 1) into v_allowed
  from public.profiles p
  left join public.plan_catalog pc on pc.key = case
    when p.plan_expires_at is not null and p.plan_expires_at <= now() then 'free'
    else p.plan end and pc.enabled = true
  where p.id = p_user_id;
  if not found then raise exception '用户资料不存在'; end if;

  if (select count(*) from public.domains
      where user_id = p_user_id and entitlement_source = 'plan_grant'
        and status <> 'deleted') >= v_allowed then
    raise exception '当前套餐的免费域名名额已用完';
  end if;

  if p_site_id is not null and not exists (
    select 1 from public.sites
    where id = p_site_id and user_id = p_user_id and status <> 'deleted'
  ) then raise exception '项目不存在或无权访问'; end if;

  if exists (select 1 from public.domains where lower(hostname) = lower(p_hostname) and status <> 'deleted') then
    raise exception '该域名已被占用';
  end if;

  insert into public.domains (
    user_id, site_id, hostname, type, entitlement_source, status, last_binding_change_at
  ) values (
    p_user_id, p_site_id, lower(p_hostname), 'platform_subdomain',
    'plan_grant', p_status, case when p_site_id is null then null else now() end
  ) returning * into v_domain;
  return v_domain;
end;
$$;

revoke all on function public.claim_free_platform_domain(uuid, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_free_platform_domain(uuid, text, text, text, uuid)
  to service_role;
