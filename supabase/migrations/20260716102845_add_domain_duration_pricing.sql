alter table public.domain_pricing
  add column if not exists monthly_price_cents integer not null default 0 check (monthly_price_cents >= 0),
  add column if not exists quarterly_price_cents integer not null default 0 check (quarterly_price_cents >= 0),
  add column if not exists semiannual_price_cents integer not null default 0 check (semiannual_price_cents >= 0),
  add column if not exists annual_price_cents integer not null default 0 check (annual_price_cents >= 0);

update public.domain_pricing
set
  monthly_price_cents = case when billing_period = 'month' then price_cents else round(price_cents / 12.0)::integer end,
  quarterly_price_cents = case when billing_period = 'month' then price_cents * 3 else round(price_cents / 4.0)::integer end,
  semiannual_price_cents = case when billing_period = 'month' then price_cents * 6 else round(price_cents / 2.0)::integer end,
  annual_price_cents = case when billing_period = 'year' then price_cents else price_cents * 12 end
where monthly_price_cents = 0
  and quarterly_price_cents = 0
  and semiannual_price_cents = 0
  and annual_price_cents = 0;
