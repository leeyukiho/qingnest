alter table public.plan_catalog
  add column if not exists renewal_price_cents integer not null default 0
  check (renewal_price_cents >= 0);

update public.plan_catalog
set renewal_price_cents = monthly_price_cents
where renewal_price_cents = 0
  and monthly_price_cents > 0;
