alter table public.pages_accelerations
  add column if not exists source_deployment_id uuid
  references public.deployments(id) on delete set null;

create index if not exists pages_accelerations_source_deployment_idx
  on public.pages_accelerations (source_deployment_id)
  where source_deployment_id is not null;
