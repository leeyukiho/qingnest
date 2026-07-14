alter table public.domain_pricing
  drop constraint if exists domain_pricing_domain_type_check;

alter table public.domain_pricing
  add column if not exists hostname_suffix text;

update public.domain_pricing
set hostname_suffix = case
  when domain_type = 'platform_subdomain' then '985201314.xyz'
  else null
end
where hostname_suffix is null;

delete from public.domain_pricing
where domain_type = 'custom_domain';

alter table public.domain_pricing
  alter column hostname_suffix set not null;

create unique index if not exists domain_pricing_hostname_suffix_key
  on public.domain_pricing (lower(hostname_suffix));

comment on table public.domain_pricing is
  'Platform-owned domain suffixes available for users to rent; custom user domains are intentionally unsupported.';
