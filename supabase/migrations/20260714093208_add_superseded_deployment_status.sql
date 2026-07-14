alter table public.deployments
  drop constraint if exists deployments_status_check;

alter table public.deployments
  add constraint deployments_status_check
  check (status in ('uploading', 'scanning', 'active', 'failed', 'blocked', 'pending_review', 'superseded'));
