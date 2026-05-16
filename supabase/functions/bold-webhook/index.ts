// =====================================================================
// FEEDBACK — Edge Function: bold-webhook
//
// Server-to-server callback from Bold when a transaction settles.
// Responsibilities:
//   1. Verify the HMAC signature header against BOLD_WEBHOOK_SECRET.
//   2. Idempotently mark the transaction approved / rejected.
//   3. On approval, call public.activate_membership() so RLS + profile
//      denormalization flip in a single transaction.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (injected by runtime)
//   BOLD_WEBHOOK_SECRET                      (set via `supabase secrets`)
//
// Bold sends a `x-bold-signature` header that is the HMAC-SHA256 of the
// raw request body using the merchant secret. We validate constant-time.
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method_not_allowed', { status: 405 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get('x-bold-signature') ?? '';
  const webhookSecret = Deno.env.get('BOLD_WEBHOOK_SECRET');
  if (!webhookSecret) return new Response('webhook_not_configured', { status: 500 });

  const expected = await hmacSha256Hex(webhookSecret, rawBody);
  if (!timingSafeEqual(signature, expected)) {
    return new Response('bad_signature', { status: 401 });
  }

  let payload: BoldWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('bad_json', { status: 400 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const orderId = payload.metadata?.order_id ?? payload.order_id;
  if (!orderId) return new Response('missing_order_id', { status: 400 });

  // Load the pending transaction we created during checkout.
  const { data: tx, error: txErr } = await admin
    .from('membership_transactions')
    .select('user_id, tier, billing_cycle, amount_cop, status')
    .eq('bold_order_id', orderId)
    .maybeSingle();
  if (txErr) return new Response('tx_lookup_failed', { status: 500 });
  if (!tx) return new Response('tx_unknown', { status: 404 });

  // Idempotency: ignore replay attempts for already-settled transactions.
  if (tx.status === 'approved' || tx.status === 'refunded') {
    return new Response('already_processed', { status: 200 });
  }

  // Persist the raw payload for forensic debugging regardless of outcome.
  await admin
    .from('membership_transactions')
    .update({
      bold_payment_id: payload.payment_id ?? null,
      payment_method:  payload.payment_method ?? null,
      raw_payload:     payload,
    })
    .eq('bold_order_id', orderId);

  if (payload.status === 'APPROVED') {
    const { error: rpcErr } = await admin.rpc('activate_membership', {
      p_user_id: tx.user_id,
      p_tier: tx.tier,
      p_billing_cycle: tx.billing_cycle,
      p_price_cop: tx.amount_cop,
      p_bold_order_id: orderId,
    });
    if (rpcErr) return new Response('activate_failed: ' + rpcErr.message, { status: 500 });
    return new Response('ok', { status: 200 });
  }

  // Rejected / failed
  const finalStatus = payload.status === 'REJECTED' ? 'rejected' : 'pending';
  await admin
    .from('membership_transactions')
    .update({ status: finalStatus })
    .eq('bold_order_id', orderId);

  return new Response('ok', { status: 200 });
});

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
interface BoldWebhookPayload {
  status: 'APPROVED' | 'REJECTED' | 'PENDING' | string;
  order_id?: string;
  payment_id?: string;
  payment_method?: string;
  metadata?: { order_id?: string };
  [k: string]: unknown;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
