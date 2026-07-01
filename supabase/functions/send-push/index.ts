// =====================================================================
// FEEDBACK / PartyRate — send-push Edge Function
// =====================================================================
// Receives a tiny payload from an authenticated client:
//   { type: 'like' | 'comment' | 'follow' | 'chat',
//     toUserId: <uuid>,
//     postId?:  <uuid>,
//     roomId?:  <uuid> }
//
// Authenticates the caller via JWT, derives the sender's username from
// the profiles table (NEVER trusts a name passed in the body — that
// would let any client impersonate someone else), builds the title +
// body server-side, and pushes to every subscription `toUserId` has
// registered. Stale subscriptions (404/410) are pruned in place.
//
// Texts are kept in Spanish to match the rest of the product UI.
// =====================================================================

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? '';

// ---------------------------------------------------------------------
// VAPID JWT signing — WebCrypto, NOT web-push's setVapidDetails.
// ---------------------------------------------------------------------
// web-push signs the VAPID JWT through jws → jwa, which uses Node
// `crypto` + ecdsa-sig-formatter.derToJose(). Under Deno's node:crypto
// shim that path emits an ES256 signature that is structurally valid but
// cryptographically WRONG (right length, wrong bytes). FCM/Mozilla accept
// it; Apple (web.push.apple.com) fully verifies and rejects it with
// 403 {"reason":"BadJwtToken"}. So we sign the VAPID JWT ourselves with
// WebCrypto (crypto.subtle.sign → correct raw r||s), and hand the ready
// Authorization header to web-push, which still does the aes128gcm
// payload encryption + HTTP. setVapidDetails is intentionally NOT called,
// so web-push never adds its own broken Authorization.
//
// The subject MUST be Apple-valid: a clean `mailto:you@realdomain.com`
// (no spaces / angle brackets / @localhost) or a public https: origin.
const VAPID_SUB = VAPID_SUBJECT.trim();

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUB) {
  console.warn('[send-push] missing VAPID secrets — pushes will fail until set');
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function bytesToB64url(b: Uint8Array): string {
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Import the P-256 private key once as a CryptoKey, reconstructed from the
// raw VAPID secrets: public = 65-byte uncompressed point (0x04||X||Y),
// private = 32-byte d scalar (both base64url, as generate-vapid.mjs emits).
let _vapidKey: CryptoKey | null = null;
async function vapidSignKey(): Promise<CryptoKey> {
  if (_vapidKey) return _vapidKey;
  const pub = b64urlToBytes(VAPID_PUBLIC_KEY); // 65 bytes
  _vapidKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToB64url(pub.slice(1, 33)),
      y: bytesToB64url(pub.slice(33, 65)),
      d: VAPID_PRIVATE_KEY,
      ext: true,
    } as JsonWebKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  return _vapidKey;
}

// Build `Authorization: vapid t=<jwt>, k=<pubkey>` for one endpoint.
// aud = the push-service origin (e.g. https://web.push.apple.com);
// exp = now + 12h (RFC 8292 requires <= 24h).
async function vapidAuthHeader(endpoint: string): Promise<string> {
  const header = bytesToB64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64url(new TextEncoder().encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: VAPID_SUB,
  })));
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await vapidSignKey(),
    new TextEncoder().encode(`${header}.${claims}`),
  ));
  return `vapid t=${header}.${claims}.${bytesToB64url(sig)}, k=${VAPID_PUBLIC_KEY}`;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-client',
};

type PushType = 'like' | 'comment' | 'follow' | 'chat' | 'question-answered' | 'question-received' | 'party-attendance';

interface RequestBody {
  type: PushType;
  toUserId: string;
  postId?: string;
  roomId?: string;
  questionId?: string;
  partyId?: string;
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// URLs use the SPA's hash-routing format (#/...) introduced in Fase 1 —
// GitHub Pages serves no rewrites, so a path like /posts/x would 404;
// /#/wall?post=x always loads index.html and the router resolves it.
// `ctx.senderId` builds profile links (stable, unlike the display
// username) and `ctx.chatPath` is resolved from the room row upstream.
function buildMessage(
  type: PushType,
  fromUsername: string,
  body: RequestBody,
  ctx: { senderId: string; chatPath?: string },
): { title: string; body: string; url: string } {
  switch (type) {
    case 'like':
      return {
        title: 'Nuevo like',
        body: `A ${fromUsername} le gustó tu publicación`,
        url: `/#/wall?post=${body.postId}`,
      };
    case 'comment':
      return {
        title: 'Nuevo comentario',
        body: `${fromUsername} comentó tu publicación`,
        url: `/#/wall?post=${body.postId}`,
      };
    case 'follow':
      return {
        title: 'Nuevo seguidor',
        body: `${fromUsername} empezó a seguirte`,
        url: `/#/u/${ctx.senderId}`,
      };
    case 'chat':
      return {
        title: 'Nuevo mensaje',
        body: `${fromUsername} te envió un mensaje`,
        url: ctx.chatPath || '/#/chats',
      };
    case 'question-answered':
      // The asker chose who to ask, so we can name them openly here —
      // anonymity only protects the asker, never the answerer. Deep-link
      // to the answerer's profile, Questions tab, where the answered Q&A
      // is public.
      return {
        title: 'Respondieron tu pregunta',
        body: `${fromUsername} respondió tu pregunta anónima`,
        url: `/#/u/${ctx.senderId}?tab=questions`,
      };
    case 'question-received':
      // Anonymity: NEVER name the asker (fromUsername) — the asker IS the
      // sender and their identity must stay hidden. Land on the recipient's
      // OWN profile, Questions tab, so they can answer in one tap.
      return {
        title: 'Nueva pregunta',
        body: 'Alguien te hizo una pregunta anónima',
        url: '/#/profile?tab=questions',
      };
    case 'party-attendance':
      // Fired toward the promoter when a guest confirms attendance —
      // social proof + actionable feedback (they can prepare capacity).
      return {
        title: 'Nuevo asistente',
        body: `${fromUsername} confirmó que va a tu fiesta`,
        url: `/#/party/${body.partyId}`,
      };
  }
}

// ---------------------------------------------------------------------
// verifyRelationship — the caller may only trigger a push that matches
// something that REALLY happened between them and the recipient. This
// closes the old TODO: without it, any authenticated user could bombard
// any other user with system notifications at will.
// Bad/forged UUIDs make the queries error → data null → { ok: false }.
// ---------------------------------------------------------------------
async function verifyRelationship(
  admin: SupabaseClient,
  body: RequestBody,
  senderId: string,
): Promise<{ ok: boolean; chatPath?: string }> {
  switch (body.type) {
    case 'like': {
      const { data: post } = await admin
        .from('posts').select('user_id').eq('id', body.postId!).maybeSingle();
      if (!post || post.user_id !== body.toUserId) return { ok: false };
      const { data: like } = await admin
        .from('post_likes').select('post_id')
        .eq('post_id', body.postId!).eq('user_id', senderId).maybeSingle();
      return { ok: !!like };
    }
    case 'comment': {
      const { data: post } = await admin
        .from('posts').select('user_id').eq('id', body.postId!).maybeSingle();
      if (!post || post.user_id !== body.toUserId) return { ok: false };
      const { data: comment } = await admin
        .from('post_comments').select('id')
        .eq('post_id', body.postId!).eq('user_id', senderId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      return { ok: !!comment };
    }
    case 'follow': {
      const { data: f } = await admin
        .from('follows').select('follower_id')
        .eq('follower_id', senderId).eq('following_id', body.toUserId).maybeSingle();
      return { ok: !!f };
    }
    case 'chat': {
      const { data: room } = await admin
        .from('chat_rooms').select('id, party_id').eq('id', body.roomId!).maybeSingle();
      if (!room) return { ok: false };
      // The sender must have actually written in that room recently AND
      // the recipient must be a participant of the conversation (wrote
      // there within the last 7 days). Without the second check, one
      // message in the public global room let a caller notify ANY user
      // on the platform.
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [{ data: msg }, { data: rcpt }] = await Promise.all([
        admin.from('chat_messages').select('id')
          .eq('room_id', body.roomId!).eq('user_id', senderId)
          .gte('created_at', tenMinAgo).limit(1).maybeSingle(),
        admin.from('chat_messages').select('id')
          .eq('room_id', body.roomId!).eq('user_id', body.toUserId)
          .gte('created_at', sevenDaysAgo).limit(1).maybeSingle(),
      ]);
      if (!msg || !rcpt) return { ok: false };
      return {
        ok: true,
        chatPath: room.party_id ? `/#/chat/party/${room.party_id}` : '/#/chat/general',
      };
    }
    case 'question-answered': {
      // Sender must be the answerer (target) and recipient the asker.
      const { data: q } = await admin
        .from('questions').select('id')
        .eq('id', body.questionId!).eq('target_id', senderId)
        .eq('asker_id', body.toUserId).not('answer', 'is', null).maybeSingle();
      return { ok: !!q };
    }
    case 'question-received': {
      // Sender must be the asker and recipient the target of this question.
      const { data: q } = await admin
        .from('questions').select('id')
        .eq('id', body.questionId!).eq('asker_id', senderId)
        .eq('target_id', body.toUserId).maybeSingle();
      return { ok: !!q };
    }
    case 'party-attendance': {
      const { data: party } = await admin
        .from('parties').select('promoter_id').eq('id', body.partyId!).maybeSingle();
      if (!party || party.promoter_id !== body.toUserId) return { ok: false };
      const { data: att } = await admin
        .from('party_attendees').select('party_id')
        .eq('party_id', body.partyId!).eq('user_id', senderId).maybeSingle();
      return { ok: !!att };
    }
  }
  return { ok: false };
}

async function resolveSenderUsername(admin: SupabaseClient, senderId: string): Promise<string> {
  const { data, error } = await admin
    .from('profiles')
    .select('username, name')
    .eq('id', senderId)
    .maybeSingle();
  if (error) {
    console.warn('[send-push] failed to resolve sender profile', error);
    return 'Alguien';
  }
  return data?.username || data?.name || 'Alguien';
}

Deno.serve(async (req: Request) => {
  // ---------------- CORS preflight ----------------
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // ---------------- Method gate ----------------
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  // ---------------- AuthN ----------------
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return json(401, { error: 'unauthorized' });
  }

  const authedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error: userErr } = await authedClient.auth.getUser();
  if (userErr || !user) {
    return json(401, { error: 'unauthorized' });
  }

  // ---------------- Body parse + validate ----------------
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const validTypes: PushType[] = ['like', 'comment', 'follow', 'chat', 'question-answered', 'question-received', 'party-attendance'];
  if (!body || !validTypes.includes(body.type) || !body.toUserId) {
    return json(400, { error: 'invalid_payload' });
  }
  if ((body.type === 'like' || body.type === 'comment') && !body.postId) {
    return json(400, { error: 'missing_postId' });
  }
  if (body.type === 'chat' && !body.roomId) {
    return json(400, { error: 'missing_roomId' });
  }
  if ((body.type === 'question-answered' || body.type === 'question-received') && !body.questionId) {
    return json(400, { error: 'missing_questionId' });
  }
  if (body.type === 'party-attendance' && !body.partyId) {
    return json(400, { error: 'missing_partyId' });
  }

  // ---------------- Service-role client ----------------
  // Used for two privileged reads/writes:
  //   1. read the sender's username from profiles (RLS would block other
  //      profiles for the caller in some setups).
  //   2. read every push_subscription the recipient owns and prune the
  //      ones that come back 404/410.
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---------------- Self-notification guard ----------------
  if (body.toUserId === user.id) {
    return json(200, { sent: 0, removed: 0, reason: 'self' });
  }

  // ---------------- Rate limit ----------------
  // Two caps against push_events (0029, service_role only):
  //   * 30 sends / 5 min per sender (global — organic activity never
  //     hits it, scripts do).
  //   * 5 sends / 5 min per (sender → recipient). This is the
  //     anti-harassment cap: like/unlike or follow/unfollow loops
  //     re-create a valid relationship on every iteration, so the
  //     relationship gate alone can't stop directed spam.
  const WINDOW_MS = 5 * 60 * 1000;
  const MAX_PER_WINDOW = 30;
  const MAX_PER_RECIPIENT = 5;
  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();
  const [{ count: sentInWindow, error: rlErr }, { count: sentToRecipient, error: rrErr }] = await Promise.all([
    admin.from('push_events')
      .select('*', { count: 'exact', head: true })
      .eq('sender_id', user.id)
      .gte('created_at', windowStart),
    admin.from('push_events')
      .select('*', { count: 'exact', head: true })
      .eq('sender_id', user.id)
      .eq('recipient_id', body.toUserId)
      .gte('created_at', windowStart),
  ]);
  if (rlErr || rrErr) {
    // Infra hiccup on the counter: log and continue (fail-open) — the
    // relationship check below is the harder gate.
    console.warn('[send-push] rate-limit count failed', rlErr ?? rrErr);
  } else if ((sentInWindow ?? 0) >= MAX_PER_WINDOW
          || (sentToRecipient ?? 0) >= MAX_PER_RECIPIENT) {
    return json(429, { error: 'rate_limited' });
  }

  // ---------------- Relationship validation ----------------
  const rel = await verifyRelationship(admin, body, user.id);
  if (!rel.ok) {
    return json(403, { error: 'relationship_not_verified' });
  }

  // Record the accepted send + prune this sender's stale ledger rows so
  // push_events stays tiny without a scheduled job.
  await admin.from('push_events').insert({ sender_id: user.id, recipient_id: body.toUserId });
  await admin.from('push_events').delete()
    .eq('sender_id', user.id)
    .lt('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());

  const fromUsername = await resolveSenderUsername(admin, user.id);

  const { title, body: pushBody, url } = buildMessage(
    body.type, fromUsername, body,
    { senderId: user.id, chatPath: rel.chatPath },
  );

  // ---------------- Fetch subscriptions ----------------
  const { data: subs, error: subsErr } = await admin
    .from('push_subscriptions')
    .select('endpoint, subscription')
    .eq('user_id', body.toUserId);

  if (subsErr) {
    console.warn('[send-push] failed to read subscriptions', subsErr);
    return json(500, { error: 'subscriptions_read_failed' });
  }

  if (!subs || subs.length === 0) {
    return json(200, { sent: 0, removed: 0, reason: 'no_subscriptions' });
  }

  // ---------------- Dispatch ----------------
  const payload = JSON.stringify({ title, body: pushBody, url });
  let sent = 0;
  let removed = 0;

  for (const row of subs) {
    try {
      // web-push accepts the full PushSubscription shape (endpoint +
      // keys.{p256dh, auth}). Our `subscription` jsonb is exactly that.
      // Inject our own WebCrypto-signed VAPID Authorization header; with
      // no setVapidDetails, web-push keeps our header and only does the
      // aes128gcm encryption + HTTP send.
      const sub = row.subscription as unknown as webpush.PushSubscription;
      await webpush.sendNotification(sub, payload, {
        headers: { Authorization: await vapidAuthHeader(sub.endpoint) },
        TTL: 12 * 60 * 60,
        contentEncoding: 'aes128gcm', // matches the `vapid t=, k=` header form
      });
      sent++;
    } catch (err) {
      const e = err as { statusCode?: number; body?: unknown };
      const code = e?.statusCode;
      if (code === 404 || code === 410) {
        // Gone / Not Found → the push service forgot this endpoint.
        // Prune it so we don't keep paying the round-trip every send.
        const { error: delErr } = await admin
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', row.endpoint);
        if (delErr) console.warn('[send-push] failed to prune stale subscription', delErr);
        else removed++;
      } else {
        console.warn('[send-push] sendNotification failed', code, e?.body);
      }
      // Never abort the loop on a single failure — other devices still
      // need to receive the push.
    }
  }

  return json(200, { sent, removed });
});
