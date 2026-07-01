// =====================================================================
// FEEDBACK / PartyRate — admin-broadcast Edge Function (FASE 2)
// =====================================================================
// Super-admin mass notifications: push and/or email to a targeted set of
// users (all / by role / by city / by party attendees / a single user).
//
// SECURITY: authenticates the caller's JWT, then re-checks
// profiles.is_admin with the SERVICE ROLE (never trusts the client). A
// non-admin gets 403. Recipients are resolved SERVER-SIDE from the target
// spec — the client never sends a recipient list. This intentionally does
// NOT reuse send-push (whose relationship gate + anti-harassment rate caps
// would block a legitimate broadcast); admin sends bypass those caps but
// are admin-only.
//
// VAPID signing is inlined (WebCrypto, same as send-push — NEVER
// setVapidDetails, which breaks iOS) because Dashboard-deployed functions
// can't import ../_shared.
//
// Required secrets (already set for send-push / notify-support-ticket):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
//   RESEND_API_KEY, SUPPORT_FROM (reused as the broadcast sender)
//
// Body:
//   { title, body, url?, channels:{push?,email?},
//     target:{ type:'all'|'role'|'city'|'party'|'user', value? },
//     dryRun? }
// dryRun returns the recipient/push/email counts WITHOUT sending.
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
const BROADCAST_FROM = Deno.env.get('SUPPORT_FROM') ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
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

// ---------------- Recipient resolution (server-side) ----------------
async function resolveRecipientIds(
  admin: SupabaseClient,
  target: { type: string; value?: string },
): Promise<string[]> {
  // Surface query errors (e.g. a bad enum/uuid that slipped validation)
  // instead of swallowing them into a fake empty audience.
  switch (target.type) {
    case 'all': {
      const { data, error } = await admin.from('profiles').select('id');
      if (error) throw error;
      return (data ?? []).map((r) => r.id as string);
    }
    case 'role': {
      const { data, error } = await admin.from('profiles').select('id').eq('role', target.value);
      if (error) throw error;
      return (data ?? []).map((r) => r.id as string);
    }
    case 'city': {
      const { data, error } = await admin.from('profiles').select('id').eq('city', target.value);
      if (error) throw error;
      return (data ?? []).map((r) => r.id as string);
    }
    case 'party': {
      const { data, error } = await admin.from('party_attendees').select('user_id').eq('party_id', target.value);
      if (error) throw error;
      return (data ?? []).map((r) => r.user_id as string);
    }
    case 'user': {
      return target.value ? [target.value] : [];
    }
    default:
      return [];
  }
}

// Build an id -> email map for EXACTLY the resolved recipients via the
// admin_emails_for_ids RPC (filtered by id), instead of paging the whole
// auth.users table (which capped at 50k). service_role bypasses the RPC's
// revoked grants.
async function buildEmailMap(admin: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const { data, error } = await admin.rpc('admin_emails_for_ids', { p_ids: chunk });
    if (error) { console.warn('[admin-broadcast] admin_emails_for_ids failed', error); break; }
    for (const r of (data ?? []) as { id: string; email: string }[]) map.set(r.id, r.email);
  }
  return map;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // ---------------- AuthN ----------------
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return json(401, { error: 'unauthorized' });
  const authed = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userErr } = await authed.auth.getUser();
  if (userErr || !user) return json(401, { error: 'unauthorized' });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---------------- AuthZ: must be admin (server-checked) ----------------
  const { data: me } = await admin.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
  if (!me?.is_admin) return json(403, { error: 'forbidden' });

  // ---------------- Body ----------------
  let body: {
    title?: string; body?: string; url?: string;
    channels?: { push?: boolean; email?: boolean };
    target?: { type?: string; value?: string };
    dryRun?: boolean;
  };
  try { body = await req.json(); } catch { return json(400, { error: 'invalid_json' }); }

  const title = (body.title ?? '').toString().trim().slice(0, 120);
  const text = (body.body ?? '').toString().trim().slice(0, 500);
  let url = (body.url ?? '').toString().trim();
  if (url && !url.startsWith('/#/')) return json(400, { error: 'invalid_url' }); // deep links only
  if (!url) url = '/#/notifications';
  const wantPush = !!body.channels?.push;
  const wantEmail = !!body.channels?.email;
  const target = { type: body.target?.type ?? '', value: body.target?.value };
  const dryRun = !!body.dryRun;

  if (!title || !text) return json(400, { error: 'missing_title_or_body' });
  if (!wantPush && !wantEmail) return json(400, { error: 'no_channel' });
  if (!['all', 'role', 'city', 'party', 'user'].includes(target.type)) return json(400, { error: 'invalid_target' });
  if (target.type !== 'all' && !target.value) return json(400, { error: 'missing_target_value' });
  // Validate value shape so a typo doesn't error in the query and look like
  // a clean 0-recipient success.
  if (target.type === 'role' && !['raver', 'dj', 'promotor'].includes(target.value ?? '')) {
    return json(400, { error: 'invalid_role' });
  }
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if ((target.type === 'party' || target.type === 'user') && !UUID_RE.test(target.value ?? '')) {
    return json(400, { error: 'invalid_uuid' });
  }

  // ---------------- Resolve recipients ----------------
  let ids: string[];
  try {
    ids = Array.from(new Set(await resolveRecipientIds(admin, target)));
  } catch (e) {
    console.error('[admin-broadcast] recipient resolution failed', e);
    return json(500, { error: 'recipient_resolution_failed' });
  }
  if (ids.length === 0) return json(200, { recipients: 0, push: { sent: 0, removed: 0 }, email: { sent: 0 } });

  // Count push subscriptions for these recipients (chunked .in()).
  let subRows: { user_id: string; endpoint: string; subscription: unknown }[] = [];
  if (wantPush) {
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data } = await admin.from('push_subscriptions')
        .select('user_id, endpoint, subscription').in('user_id', chunk);
      if (data) subRows = subRows.concat(data as typeof subRows);
    }
  }
  const emailMap = wantEmail ? await buildEmailMap(admin, ids) : new Map<string, string>();

  if (dryRun) {
    return json(200, {
      recipients: ids.length,
      push: { subscriptions: subRows.length },
      email: { addresses: emailMap.size },
      dryRun: true,
    });
  }

  // ---------------- Send PUSH ----------------
  let pushSent = 0, pushRemoved = 0;
  if (wantPush) {
    const payload = JSON.stringify({ title, body: text, url });
    const MAX = 5000; // safety cap per invocation
    for (const row of subRows.slice(0, MAX)) {
      try {
        const sub = row.subscription as unknown as webpush.PushSubscription;
        await webpush.sendNotification(sub, payload, {
          headers: { Authorization: await vapidAuthHeader(sub.endpoint) },
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
          console.warn('[admin-broadcast] push failed', code);
        }
      }
    }
  }

  // ---------------- Send EMAIL (Resend, BCC batches) ----------------
  let emailSent = 0;
  if (wantEmail && RESEND_API_KEY && BROADCAST_FROM) {
    const addresses = Array.from(emailMap.values());
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;">
        <h2 style="margin:0 0 12px;">${esc(title)}</h2>
        <div style="white-space:pre-wrap;font-size:14px;line-height:1.5;color:#333;">${esc(text)}</div>
        <p style="margin:20px 0 0;font-size:12px;color:#999;">PartyRate</p>
      </div>`;
    for (let i = 0; i < addresses.length; i += 50) {
      const batch = addresses.slice(i, i + 50);
      try {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: BROADCAST_FROM, to: [BROADCAST_FROM], bcc: batch, subject: title, html }),
        });
        if (resp.ok) emailSent += batch.length;
        else console.warn('[admin-broadcast] resend batch failed', resp.status, await resp.text());
      } catch (e) {
        console.warn('[admin-broadcast] resend threw', e);
      }
    }
  }

  return json(200, {
    recipients: ids.length,
    push: { sent: pushSent, removed: pushRemoved },
    email: { sent: emailSent },
  });
});
