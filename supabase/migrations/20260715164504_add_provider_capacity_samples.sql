alter table public.infrastructure_usage_monthly
  add column if not exists worker_requests bigint,
  add column if not exists kv_reads bigint,
  add column if not exists kv_writes bigint,
  add column if not exists r2_storage_bytes bigint,
  add column if not exists r2_class_a bigint,
  add column if not exists r2_class_b bigint,
  add column if not exists provider_sampled_at timestamptz,
  add column if not exists provider_sample_error text;

comment on column public.infrastructure_usage_monthly.provider_sampled_at is
  'Last successful Cloudflare GraphQL capacity sample. Null means provider analytics are unavailable.';

comment on column public.infrastructure_usage_monthly.provider_sample_error is
  'Sanitized error from the latest Cloudflare GraphQL sample attempt.';
