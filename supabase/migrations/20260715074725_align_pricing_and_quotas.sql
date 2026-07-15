insert into public.plan_catalog
  (key, label, enabled, monthly_price_cents, renewal_price_cents, max_sites, max_public_sites, max_storage_bytes, max_deployments_per_day, max_domains_per_site, custom_domain, password_protection, access_analytics, remove_branding, rollback, source_build)
values
  ('free', '免费版', true, 0, 0, 2, 1, 104857600, 5, 1, false, false, false, false, true, false),
  ('starter', '入门版', true, 1500, 1500, 5, 3, 524288000, 20, 1, false, true, true, true, true, false),
  ('pro', '专业版', true, 4900, 4900, 20, 10, 5368709120, 100, 5, true, true, true, true, true, true),
  ('business', '商务版', true, 12900, 12900, 50, 30, 21474836480, 300, 20, true, true, true, true, true, true)
on conflict (key) do update set
  label = excluded.label,
  enabled = excluded.enabled,
  monthly_price_cents = excluded.monthly_price_cents,
  renewal_price_cents = excluded.renewal_price_cents,
  max_sites = excluded.max_sites,
  max_public_sites = excluded.max_public_sites,
  max_storage_bytes = excluded.max_storage_bytes,
  max_deployments_per_day = excluded.max_deployments_per_day,
  max_domains_per_site = excluded.max_domains_per_site,
  custom_domain = excluded.custom_domain,
  password_protection = excluded.password_protection,
  access_analytics = excluded.access_analytics,
  remove_branding = excluded.remove_branding,
  rollback = excluded.rollback,
  source_build = excluded.source_build,
  updated_at = now();
