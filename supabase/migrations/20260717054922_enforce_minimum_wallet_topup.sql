alter table public.wallet_topups
  drop constraint wallet_topups_amount_cents_check,
  add constraint wallet_topups_amount_cents_check check (amount_cents >= 500) not valid;

create or replace function public.create_wallet_topup(
  p_user_id uuid, p_order_no text, p_amount_cents integer, p_expires_at timestamptz
) returns public.wallet_topups language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_topup public.wallet_topups%rowtype;
begin
  if p_amount_cents < 500 or p_amount_cents > 100000000 then raise exception '充值金额必须在 5 元至 100 万元之间'; end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '10 minutes 30 seconds' then raise exception '充值支付期限必须为 10 分钟'; end if;
  insert into public.wallet_accounts(user_id) values (p_user_id) on conflict (user_id) do nothing;
  insert into public.wallet_topups(order_no, user_id, amount_cents, expires_at)
    values (p_order_no, p_user_id, p_amount_cents, p_expires_at) returning * into v_topup;
  return v_topup;
end; $$;
