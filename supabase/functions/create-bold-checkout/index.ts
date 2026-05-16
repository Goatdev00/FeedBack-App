// =====================================================================
// FEEDBACK — Edge Function: create-bold-checkout
//
// Called by the frontend when the user clicks "Pagar" in /membership/checkout.
// Responsibilities:
//   1. Verify the caller is a signed-in user.
//   2. Idempotently create a `membership_transactions` row (pending).
//   3. Build a Bold Botón de Pagos integrity hash and return the params
//      the client needs to redirect the browser to Bold's checkout.
//
// Bold "Botón de Pagos" integrity hash (per Bold's docs):
//   sha256( orderId + amount + currency + secretKey )
//
// Env vars (set via `supabase secrets set`):
//   BOLD_API_KEY            public identity key (goes to the browser)
//   BOLD_SECRET_KEY         server-only secret used for HMAC
//   BOLD_REDIRECT_BASE_URL  e.g. https://feedback.app/membership/success
//   SUPABASE_URL            injected by the runtime
//   SUPABASE_SERVICE_ROLE_KEY injected by the runtime
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// Prices live in code (single source of truth alongside the frontend).
// Keep these in sync with src/config/membership-benefits.js.
const PRICE_TABLE: Record<string, Record<string, number>> = {
  vip:  { monthly: 14_900,  yearly: 149_000 },
  back: { monthly: 29_900,  yearly: 299_000 },
};

interface CheckoutRequest {
  tier: 'vip' | 'back';
  billingCycle: 'monthly' | 'yearly';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return jsonError(401, 'missing_token');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const boldApiKey  = Deno.env.get('BOLD_API_KEY')!;
    const boldSecret  = Deno.env.get('BOLD_SECRET_KEY')!;
    const redirectBase = Deno.env.get('BOLD_REDIRECT_BASE_URL')!;

    if (!boldApiKey || !boldSecret || !redirectBase) return jsonError(500, 'bold_not_configured');

    // Authenticated client (validates the JWT and exposes auth.uid()).
    const supabase = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData.user) return jsonError(401, 'invalid_token');
    const userId = userData.user.id;

    const body = (await req.json()) as CheckoutRequest;
    const tier  = body.tier;
    const cycle = body.billingCycle;
    if (!['vip','back'].includes(tier) || !['monthly','yearly'].includes(cycle)) {
      return jsonError(400, 'invalid_payload');
    }
    const amount = PRICE_TABLE[tier]?.[cycle];
    if (!amount) return jsonError(400, 'price_unknown');

    // Idempotency: stable orderId per (user, tier, cycle, day). Re-clicking
    // "Pagar" doesn't create dozens of pending rows.
    const dayBucket = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const orderId = `fb-${userId.slice(0, 8)}-${tier}-${cycle}-${dayBucket}`;

    const { error: upsertErr } = await supabase
      .from('membership_transactions')
      .upsert({
        user_id: userId,
        tier,
        billing_cycle: cycle,
        amount_cop: amount,
        bold_order_id: orderId,
        status: 'pending',
      }, { onConflict: 'bold_order_id' });
    if (upsertErr) return jsonError(500, 'tx_persist_failed', upsertErr.message);

    // Integrity hash per Bold spec.
    const currency = 'COP';
    const integrity = await sha256(`${orderId}${amount}${currency}${boldSecret}`);
    const redirectionUrl = `${redirectBase}?order_id=${encodeURIComponent(orderId)}`;

    return new Response(JSON.stringify({
      provider: 'bold',
      orderId,
      amount,
      currency,
      apiKey: boldApiKey,
      integritySignature: integrity,
      redirectionUrl,
      description: `FEEDBACK ${tier.toUpperCase()} — ${cycle === 'yearly' ? 'Anual' : 'Mensual'}`,
    }), { headers: { ...corsHeaders, 'content-type': 'application/json' } });

  } catch (err) {
    return jsonError(500, 'unexpected', err instanceof Error ? err.message : String(err));
  }
});

function jsonError(status: number, code: string, detail?: string) {
  return new Response(JSON.stringify({ error: code, detail }), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
