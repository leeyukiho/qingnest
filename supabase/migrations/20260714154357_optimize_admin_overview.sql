create index if not exists profiles_created_at_idx
  on public.profiles(created_at desc);

create index if not exists sites_admin_recent_idx
  on public.sites(updated_at desc)
  where status <> 'deleted';

create index if not exists deployments_admin_review_idx
  on public.deployments(created_at desc)
  where status in ('pending_review', 'blocked');

create index if not exists audit_events_created_at_idx
  on public.audit_events(created_at desc);

create or replace function public.get_admin_overview(p_admin_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not exists (
    select 1
    from public.profiles
    where id = p_admin_id and role = 'admin'
  ) then
    raise insufficient_privilege using message = '需要管理员权限';
  end if;

  with
  site_stats as (
    select
      count(*) filter (where status <> 'deleted')::integer as sites,
      count(*) filter (where status = 'active')::integer as active_sites,
      count(*) filter (where status = 'pending_review')::integer as pending_review_sites,
      count(*) filter (where status = 'blocked')::integer as blocked_sites
    from public.sites
  ),
  deployment_stats as (
    select
      count(*)::integer as deployments,
      coalesce(sum(total_bytes) filter (where status = 'active'), 0)::bigint as storage_bytes
    from public.deployments
  ),
  recent_users as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'email', p.email,
      'role', p.role,
      'plan', p.plan,
      'createdAt', p.created_at
    ) order by p.created_at desc), '[]'::jsonb) as rows
    from (
      select id, email, role, plan, created_at
      from public.profiles
      order by created_at desc
      limit 25
    ) p
  ),
  recent_sites as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'ownerEmail', coalesce(p.email, '未知用户'),
      'status', s.status,
      'createdAt', s.created_at,
      'updatedAt', s.updated_at
    ) order by s.updated_at desc), '[]'::jsonb) as rows
    from (
      select id, user_id, name, status, created_at, updated_at
      from public.sites
      where status <> 'deleted'
      order by updated_at desc
      limit 25
    ) s
    left join public.profiles p on p.id = s.user_id
  ),
  review_deployments as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id,
      'siteId', d.site_id,
      'siteName', coalesce(s.name, '已删除站点'),
      'version', d.version,
      'status', d.status,
      'riskScore', d.risk_score,
      'fileCount', d.file_count,
      'totalBytes', d.total_bytes,
      'createdAt', d.created_at
    ) order by d.created_at desc), '[]'::jsonb) as rows
    from (
      select id, site_id, version, status, risk_score, file_count, total_bytes, created_at
      from public.deployments
      where status in ('pending_review', 'blocked')
      order by created_at desc
      limit 25
    ) d
    left join public.sites s on s.id = d.site_id
  ),
  recent_audit_events as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id,
      'eventType', a.event_type,
      'message', a.message,
      'riskScore', a.risk_score,
      'createdAt', a.created_at
    ) order by a.created_at desc), '[]'::jsonb) as rows
    from (
      select id, event_type, message, risk_score, created_at
      from public.audit_events
      order by created_at desc
      limit 30
    ) a
  )
  select jsonb_build_object(
    'users', (select count(*)::integer from public.profiles),
    'sites', ss.sites,
    'activeSites', ss.active_sites,
    'pendingReviewSites', ss.pending_review_sites,
    'blockedSites', ss.blocked_sites,
    'deployments', ds.deployments,
    'domains', (select count(*)::integer from public.domains where status <> 'deleted'),
    'storageBytes', ds.storage_bytes,
    'recentUsers', ru.rows,
    'recentSites', rs.rows,
    'reviewDeployments', rd.rows,
    'auditEvents', ra.rows
  )
  into result
  from site_stats ss
  cross join deployment_stats ds
  cross join recent_users ru
  cross join recent_sites rs
  cross join review_deployments rd
  cross join recent_audit_events ra;

  return result;
end;
$$;

revoke execute on function public.get_admin_overview(uuid) from public, anon, authenticated;
grant execute on function public.get_admin_overview(uuid) to service_role;
