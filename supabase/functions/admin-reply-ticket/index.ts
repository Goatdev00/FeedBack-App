// =====================================================================
// FEEDBACK / PartyRate — admin-reply-ticket Edge Function (FASE 2)
// =====================================================================
// Super-admin replies to a support ticket. The reply reaches the user two
// ways:
//   1. EMAIL to the ticket's contact address (Resend), quoting their
//      original message. reply_to is the support inbox so their answer
//      threads back to support.
//   2. PUSH to every device of the ticket's user_id (if the ticket is tied
//      to an account), opening /#/notifications on tap.
//
// SECURITY: authenticates the caller's JWT, then re-checks profiles.is_admin
// with the SERVICE ROLE. A non-admin gets 403. The ticket row (incl. the
// contact email + user_id) is read server-side by id — the client never
// supplies the recipient, so a tampered body can't redirect a reply to a
// third party.
//
// VAPID signing is inlined (WebCrypto, same as send-push / admin-broadcast —
// NEVER setVapidDetails, which breaks iOS) because Dashboard-deployed
// functions can't import ../_shared.
//
// Required secrets (already set for send-push / admin-broadcast /
// notify-support-ticket):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
//   RESEND_API_KEY, SUPPORT_FROM, SUPPORT_NOTIFY_TO (reply-to; optional)
//
// Body: { ticketId, message }
// =====================================================================

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUB = (Deno.env.get('VAPID_SUBJECT') ?? '').trim();
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const SUPPORT_FROM = Deno.env.get('SUPPORT_FROM') ?? '';
const SUPPORT_NOTIFY_TO = (Deno.env.get('SUPPORT_NOTIFY_TO') ?? '').trim();

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-client',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------- VAPID signing (inlined WebCrypto) ----------------
function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function bytesToB64url(b: Uint8Array): string {
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
let _vapidKey: CryptoKey | null = null;
async function vapidSignKey(): Promise<CryptoKey> {
  if (_vapidKey) return _vapidKey;
  const pub = b64urlToBytes(VAPID_PUBLIC_KEY);
  _vapidKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33, 65)), d: VAPID_PRIVATE_KEY, ext: true } as JsonWebKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  return _vapidKey;
}
async function vapidAuthHeader(endpoint: string): Promise<string> {
  const header = bytesToB64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64url(new TextEncoder().encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: VAPID_SUB,
  })));
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, await vapidSignKey(),
    new TextEncoder().encode(`${header}.${claims}`),
  ));
  return `vapid t=${header}.${claims}.${bytesToB64url(sig)}, k=${VAPID_PUBLIC_KEY}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  console.log('[admin-reply-ticket] hit', req.method);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  try {
    // ---------------- AuthN ----------------
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.toLowerCase().startsWith('bearer ')) return json(401, { error: 'unauthorized' });
    const authed = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: userErr } = await authed.auth.getUser();
    if (userErr || !user) return json(401, { error: 'unauthorized' });

    const admin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ---------------- AuthZ: must be admin ----------------
    const { data: me } = await admin.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
    if (!me?.is_admin) return json(403, { error: 'forbidden' });

    // ---------------- Body ----------------
    let body: { ticketId?: string; message?: string };
    try { body = await req.json(); } catch { return json(400, { error: 'invalid_json' }); }
    const ticketId = (body.ticketId ?? '').toString();
    const message = (body.message ?? '').toString().trim().slice(0, 2000);
    if (!UUID_RE.test(ticketId)) return json(400, { error: 'invalid_uuid' });
    if (!message) return json(400, { error: 'missing_message' });

    // ---------------- Load the ticket (server-side recipient) ----------------
    const { data: ticket, error: tErr } = await admin
      .from('support_tickets')
      .select('id, user_id, name, email, message')
      .eq('id', ticketId)
      .maybeSingle();
    if (tErr) { console.error('[admin-reply-ticket] load failed', tErr); return json(500, { error: 'ticket_load_failed' }); }
    if (!ticket) return json(404, { error: 'ticket_not_found' });

    // ---------------- Send EMAIL (Resend) ----------------
    let emailSent = false;
    const emailAttempted = !!(RESEND_API_KEY && SUPPORT_FROM && ticket.email);
    if (emailAttempted) {
      const html = `
        <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;">
          <h2 style="margin:0 0 12px;">Respuesta de soporte · PartyRate</h2>
          <p style="font-size:14px;color:#333;">Hola ${esc(ticket.name || '')}, respondimos a tu mensaje:</p>
          <div style="margin:12px 0;padding:16px;background:#f6f6f6;border-radius:8px;white-space:pre-wrap;font-size:14px;line-height:1.5;color:#111;">${esc(message)}</div>
          <p style="font-size:12px;color:#999;margin:20px 0 4px;">Tu mensaje original:</p>
          <div style="padding:12px;border-left:3px solid #ddd;white-space:pre-wrap;font-size:13px;line-height:1.5;color:#666;">${esc(ticket.message || '')}</div>
          <p style="margin:20px 0 0;font-size:12px;color:#999;">PartyRate</p>
        </div>`;
      try {
        const payload: Record<string, unknown> = {
          from: SUPPORT_FROM,
          to: [ticket.email],
          subject: 'Respuesta de soporte · PartyRate',
          html,
        };
        // Always thread the user's reply to a monitored address: the support
        // inbox if configured, otherwise the support sender (which is itself
        // the monitored soporte@ address). Never leave reply_to unset.
        payload.reply_to = SUPPORT_NOTIFY_TO || SUPPORT_FROM;
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        emailSent = resp.ok;
        if (!resp.ok) console.warn('[admin-reply-ticket] resend failed', resp.status, await resp.text());
      } catch (e) { console.warn('[admin-reply-ticket] resend threw', e); }
    }

    // ---------------- Send PUSH (if the ticket has an account) ----------------
    let pushSent = 0, pushRemoved = 0;
    if (ticket.user_id) {
      const { data: subs } = await admin.from('push_subscriptions')
        .select('endpoint, subscription').eq('user_id', ticket.user_id);
      const pushPayload = JSON.stringify({ title: 'Soporte te respondió 💬', body: message.slice(0, 180), url: '/#/notifications' });
      for (const row of (subs ?? []) as { endpoint: string; subscription: unknown }[]) {
        try {
          await webpush.sendNotification(row.subscription as unknown as webpush.PushSubscription, pushPayload, {
            headers: { Authorization: await vapidAuthHeader((row.subscription as { endpoint: string }).endpoint) },
            TTL: 12 * 60 * 60,
            contentEncoding: 'aes128gcm',
          });
          pushSent++;
        } catch (err) {
          const code = (err as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) {
            await admin.from('push_subscriptions').delete().eq('endpoint', row.endpoint);
            pushRemoved++;
          } else {
            console.warn('[admin-reply-ticket] push failed', code);
          }
        }
      }
    }

    return json(200, { emailSent, emailAttempted, pushSent, pushRemoved, hasUser: !!ticket.user_id });
  } catch (e) {
    const detail = String((e as { message?: string })?.message || e);
    console.error('[admin-reply-ticket] unhandled', detail, e);
    return json(500, { error: `internal: ${detail}` });
  }
});
