-- =====================================================================
-- FEEDBACK — Production hardening (pre-launch)
-- =====================================================================
-- BEFORE this migration, two `dev_mock_*` RPCs were callable by ANY
-- authenticated user and let them self-grant tier 'vip' or 'back' for
-- free, bypassing the (future) Bold payment flow entirely:
--
--   public.dev_mock_activate_membership(tier, cycle)
--   public.dev_mock_cancel_membership()
--
-- This is fine in development, catastrophic in production: any user who
-- discovers the RPC name in the JS bundle (which they will — it's there
-- as `payments.js → supabase.rpc('dev_mock_activate_membership', ...)`)
-- can call it via the browser console.
--
-- This migration removes them entirely. Phase 4 will replace them with
-- the real Bold flow: edge function `create-bold-checkout` redirects
-- the user to Bold, Bold's webhook calls `activate_membership(...)` via
-- service_role on settlement — no user-callable RPC granting tier.
-- =====================================================================

drop function if exists public.dev_mock_activate_membership(public.membership_tier, public.billing_cycle);
drop function if exists public.dev_mock_cancel_membership();

-- Defense in depth: keep `activate_membership` reachable only by the
-- service_role (it's the real activation entry point used by the Bold
-- webhook edge function). This was already true in migration 0002,
-- restated here so production reviewers see it explicitly.
revoke execute on function public.activate_membership(uuid, public.membership_tier, public.billing_cycle, integer, text) from public, anon, authenticated;
grant execute on function public.activate_membership(uuid, public.membership_tier, public.billing_cycle, integer, text) to service_role;
