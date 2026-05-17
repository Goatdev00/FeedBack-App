// =====================================================================
// FEEDBACK — Payments adapter (Bold real + Bold mock)
//
// The frontend never knows whether it's talking to real Bold or to the
// dev mock — it imports `startCheckout({ tier, billingCycle })` and we
// dispatch based on VITE_PAYMENTS_MODE.
//
//   mode === 'mock'   → call public.dev_mock_activate_membership() RPC,
//                       which inserts a fake transaction and flips the
//                       user's tier inline. Returns immediately.
//   mode === 'bold'   → invoke the `create-bold-checkout` Edge Function,
//                       receive {orderId, integritySignature, ...}, then
//                       redirect the browser to Bold's hosted checkout.
//
// To swap from mock to real Bold: set VITE_PAYMENTS_MODE=bold in .env
// once Bold credentials are wired in `supabase secrets`.
// =====================================================================

import { supabase, isSupabaseConfigured } from './supabase.js';

const MODE = (import.meta.env.VITE_PAYMENTS_MODE || 'mock').toLowerCase();

export function paymentsMode() { return MODE; }
export function isMockPayments() { return MODE !== 'bold'; }

/**
 * Kick off a checkout. Resolves with:
 *   { mode: 'mock',  status: 'approved', membershipId }
 *   { mode: 'bold',  status: 'redirect', redirectUrl }
 *
 * Throws on auth / network / RPC errors so callers can show the error UI.
 */
export async function startCheckout({ tier, billingCycle }) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  if (!['vip', 'back'].includes(tier)) throw new Error('invalid_tier');
  if (!['monthly', 'yearly'].includes(billingCycle)) throw new Error('invalid_cycle');

  if (MODE === 'bold') {
    const { data, error } = await supabase.functions.invoke('create-bold-checkout', {
      body: { tier, billingCycle },
    });
    if (error) throw error;
    return { mode: 'bold', status: 'redirect', ...data };
  }

  // Any non-'bold' mode is "disabled" in production. The dev mock RPCs
  // were dropped in migration 0010 because they let users self-grant
  // VIP/Back tier for free — a critical hole. Until Phase 4 wires real
  // Bold credentials, the membership UI must NOT be reachable.
  throw new Error('payments_disabled');
}

/**
 * Reserved for future use. The dev_mock_cancel_membership RPC was
 * removed for production safety. Real cancellation will go through the
 * Bold subscription API in Phase 4.
 */
export async function devCancelMembership() {
  throw new Error('payments_disabled');
}
