alter table public.infrastructure_capacity_settings
  drop constraint if exists infrastructure_capacity_settings_stage_check;

alter table public.infrastructure_capacity_settings
  add constraint infrastructure_capacity_settings_stage_check
  check (stage in ('free', 'workers_paid', 'workers_paid_stable', 'pages_pro'));

alter table public.infrastructure_capacity_settings
  add column if not exists thresholds jsonb;

update public.infrastructure_capacity_settings
set thresholds = jsonb_build_object(
  'workerRequests', jsonb_build_object('warningPercent', warning_percent, 'criticalPercent', critical_percent),
  'kvReads', jsonb_build_object('warningPercent', warning_percent, 'criticalPercent', critical_percent),
  'kvWrites', jsonb_build_object('warningPercent', warning_percent, 'criticalPercent', critical_percent),
  'r2StorageBytes', jsonb_build_object('warningPercent', warning_percent, 'criticalPercent', critical_percent),
  'r2ClassA', jsonb_build_object('warningPercent', warning_percent, 'criticalPercent', critical_percent),
  'r2ClassB', jsonb_build_object('warningPercent', warning_percent, 'criticalPercent', critical_percent),
  'pagesDeployments', jsonb_build_object('warningPercent', warning_percent, 'criticalPercent', critical_percent),
  'pagesProjects', jsonb_build_object('warningPercent', warning_percent, 'criticalPercent', critical_percent),
  'resendEmailsDaily', jsonb_build_object('warningPercent', warning_percent, 'criticalPercent', critical_percent),
  'resendEmailsMonthly', jsonb_build_object('warningPercent', warning_percent, 'criticalPercent', critical_percent)
)
where thresholds is null;

alter table public.infrastructure_capacity_settings
  alter column thresholds set not null;
