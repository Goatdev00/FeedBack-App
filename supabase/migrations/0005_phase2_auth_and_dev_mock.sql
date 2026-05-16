-- =====================================================================
-- FEEDBACK — Phase 2: onboarding flag + Bold-less dev mock activation
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Onboarding flag on profiles.
--    auth.users → handle_new_user creates a row with defaults; we need
--    to know whether the user has completed the role/city/bio step.
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists onboarding_complete boolean not null default false;

-- ---------------------------------------------------------------------
-- 2. dev_mock_activate_membership
--    Callable from the browser to simulate a successful Bold payment.
--    REMOVE OR REVOKE this function before going to production.
-- ---------------------------------------------------------------------
create or replace function public.dev_mock_activate_membership(
  p_tier          membership_tier,
  p_billing_cycle billing_cycle
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id       uuid;
  v_price         integer;
  v_order_id      text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;
  if p_tier = 'general' then
    raise exception 'cannot mock general tier';
  end if;

  v_price := case
    when p_tier = 'vip'  and p_billing_cycle = 'monthly' then 14900
    when p_tier = 'vip'  and p_billing_cycle = 'yearly'  then 149000
    when p_tier = 'back' and p_billing_cycle = 'monthly' then 29900
    when p_tier = 'back' and p_billing_cycle = 'yearly'  then 299000
  end;
  if v_price is null then
    raise exception 'price_unknown for tier %, cycle %', p_tier, p_billing_cycle;
  end if;

  v_order_id := 'mock-' || replace(gen_random_uuid()::text, '-', '');

  insert into public.membership_transactions
    (user_id, tier, billing_cycle, amount_cop, bold_order_id, status, payment_method)
  values
    (v_user_id, p_tier, p_billing_cycle, v_price, v_order_id, 'pending', 'mock');

  return public.activate_membership(v_user_id, p_tier, p_billing_cycle, v_price, v_order_id);
end;
$$;

grant execute on function public.dev_mock_activate_membership(membership_tier, billing_cycle) to authenticated;

-- Convenience companion: revert to general tier for testing.
create or replace function public.dev_mock_cancel_membership()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update public.memberships
     set status = 'cancelled', cancelled_at = now(), renews_at = now()
   where user_id = auth.uid() and status = 'active';
  update public.profiles
     set membership_tier = 'general', membership_active_until = null
   where id = auth.uid();
end;
$$;

grant execute on function public.dev_mock_cancel_membership() to authenticated;
