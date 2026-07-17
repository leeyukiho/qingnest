create or replace function public.acknowledge_all_user_notifications(p_user_id uuid)
returns timestamptz
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_acknowledged_at timestamptz := now();
begin
  insert into public.notification_receipts (notification_id, user_id, acknowledged_at)
  select n.id, p_user_id, v_acknowledged_at
  from public.notifications n
  where n.audience = 'all' or n.user_id = p_user_id
  on conflict (notification_id, user_id) do update
    set acknowledged_at = excluded.acknowledged_at;
  return v_acknowledged_at;
end;
$$;

revoke execute on function public.acknowledge_all_user_notifications(uuid) from public, anon, authenticated;
grant execute on function public.acknowledge_all_user_notifications(uuid) to service_role;
