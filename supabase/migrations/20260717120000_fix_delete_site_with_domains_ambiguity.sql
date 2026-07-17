create or replace function public.delete_site_with_domains(
  p_site_id uuid,
  p_actor_user_id uuid,
  p_owner_user_id uuid default null
)
returns table(site_id uuid, site_name text, hostnames text[])
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_site_id uuid;
  v_site_name text;
  v_hostnames text[];
begin
  update public.sites as s
  set status = 'deleted', active_deployment_id = null, updated_at = now()
  where s.id = p_site_id
    and s.status <> 'deleted'
    and (p_owner_user_id is null or s.user_id = p_owner_user_id)
  returning s.id, s.name into v_site_id, v_site_name;

  if v_site_id is null then
    raise exception 'Project does not exist or access is denied';
  end if;

  with unbound as (
    update public.domains as d
    set site_id = null, last_binding_change_at = now()
    where d.site_id = p_site_id and d.status <> 'deleted'
    returning d.hostname
  )
  select coalesce(array_agg(hostname), '{}'::text[])
  into v_hostnames
  from unbound;

  insert into public.audit_events (user_id, site_id, event_type, message)
  values (
    p_actor_user_id,
    p_site_id,
    case when p_owner_user_id is null then 'admin.site.deleted' else 'site.deleted' end,
    case
      when p_owner_user_id is null then 'Admin deleted project: ' || v_site_name
      else 'User deleted project: ' || v_site_name
    end
  );

  return query select v_site_id, v_site_name, v_hostnames;
end;
$$;

revoke all on function public.delete_site_with_domains(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_site_with_domains(uuid, uuid, uuid)
  to service_role;
