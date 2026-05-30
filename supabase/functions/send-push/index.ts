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

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
  console.warn('[send-push] missing VAPID secrets — setVapidDetails will throw on send');
} else {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

type PushType = 'like' | 'comment' | 'follow' | 'chat';

interface RequestBody {
  type: PushType;
  toUserId: string;
  postId?: string;
  roomId?: string;
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function buildMessage(
  type: PushType,
  fromUsername: string,
  body: RequestBody,
): { title: string; body: string; url: string } {
  // Strip a leading "@" if the username is stored that way, so URLs
  // don't end up as /u/@foo.
  const handle = fromUsername.replace(/^@+/, '');

  switch (type) {
    case 'like':
      return {
        title: 'Nuevo like',
        body: `A ${fromUsername} le gustó tu publicación`,
        url: `/posts/${body.postId}`,
      };
    case 'comment':
      return {
        title: 'Nuevo comentario',
        body: `${fromUsername} comentó tu publicación`,
        url: `/posts/${body.postId}`,
      };
    case 'follow':
      return {
        title: 'Nuevo seguidor',
        body: `${fromUsername} empezó a seguirte`,
        url: `/u/${handle}`,
      };
    case 'chat':
      return {
        title: 'Nuevo mensaje',
        body: `${fromUsername} te envió un mensaje`,
        url: `/chat/${body.roomId}`,
      };
  }
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

  const validTypes: PushType[] = ['like', 'comment', 'follow', 'chat'];
  if (!body || !validTypes.includes(body.type) || !body.toUserId) {
    return json(400, { error: 'invalid_payload' });
  }
  if ((body.type === 'like' || body.type === 'comment') && !body.postId) {
    return json(400, { error: 'missing_postId' });
  }
  if (body.type === 'chat' && !body.roomId) {
    return json(400, { error: 'missing_roomId' });
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

  const fromUsername = await resolveSenderUsername(admin, user.id);

  // TODO: verificar relación según esquema (que postId pertenezca a
  // toUserId / que la sala incluya a ambos / que el follower sea quien
  // dice ser). Sin esto un cliente autenticado podría disparar pushes
  // por contenido ajeno; el texto del push sigue siendo seguro porque
  // se construye 100% en servidor a partir del JWT, pero la relación
  // remoteId↔contenido no está validada.

  const { title, body: pushBody, url } = buildMessage(body.type, fromUsername, body);

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
      await webpush.sendNotification(row.subscription as unknown as webpush.PushSubscription, payload);
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
