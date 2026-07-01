// =====================================================================
// FEEDBACK / PartyRate — admin-moderate Edge Function (FASE 2)
// =====================================================================
// Ban / unban a user with a REAL login block (auth.admin.updateUserById
// ban_duration), which pure SQL can't do. Also mirrors the moderation
// status into public.profiles and writes a moderation_log entry, so the
// DB state (write-blocking via the block_if_muted trigger) and the auth
// state (login-blocking) stay in sync from a single client call.
//
// Mute / unmute (no login block) goes through the admin_set_moderation
// RPC directly — only ban/unban needs this function.
//
// SECURITY: JWT auth + service-role is_admin re-check. Cannot target an
// admin or the caller themselves.
//
// Body: { userId, action:'ban'|'unban', reason?, durationDays? }
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-client',
};
function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

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

  // AuthZ: caller must be admin.
  const { data: me } = await admin.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
  if (!me?.is_admin) return json(403, { error: 'forbidden' });

  let body: { userId?: string; action?: string; reason?: string; durationDays?: number };
  try { body = await req.json(); } catch { return json(400, { error: 'invalid_json' }); }

  const userId = (body.userId ?? '').toString();
  const action = (body.action ?? '').toString();
  const reason = body.reason ? String(body.reason).slice(0, 200) : null;
  // Coerce first: Number.isFinite does NOT coerce strings, so a JSON
  // "30" would otherwise fall through to a permanent ban. null = permanent.
  const nDays = Number(body.durationDays);
  const durationDays = Number.isFinite(nDays) && nDays > 0 ? Math.max(1, Math.floor(nDays)) : null;

  if (!userId) return json(400, { error: 'missing_userId' });
  if (!['ban', 'unban'].includes(action)) return json(400, { error: 'invalid_action' });
  if (userId === user.id) return json(400, { error: 'cannot_target_self' });

  // Cannot target another admin.
  const { data: target } = await admin.from('profiles').select('is_admin').eq('id', userId).maybeSingle();
  if (!target) return json(404, { error: 'user_not_found' });
  if (target.is_admin) return json(400, { error: 'cannot_target_admin' });

  if (action === 'ban') {
    // Login block: a finite ban_duration when durationDays given, else a
    // ~100-year block (Supabase has no literal "forever"; 876000h = 100y).
    const ban_duration = durationDays ? `${durationDays * 24}h` : '876000h';
    const until = durationDays ? new Date(Date.now() + durationDays * 86400000).toISOString() : null;

    // DB write-block FIRST — this is the state block_if_muted relies on and
    // must be in place before we report success. If it fails, no auth change
    // has happened yet, so the states can't diverge in the dangerous
    // direction (login-blocked but still write-enabled).
    const { error: mirrorErr } = await admin.from('profiles').update({
      moderation_status: 'banned', moderation_reason: reason, moderation_until: until, moderation_by: user.id,
    }).eq('id', userId);
    if (mirrorErr) { console.error('[admin-moderate] ban mirror failed', mirrorErr); return json(500, { error: 'mirror_failed' }); }

    const { error: authErr } = await admin.auth.admin.updateUserById(userId, { ban_duration });
    if (authErr) { console.error('[admin-moderate] ban auth failed', authErr); return json(500, { error: 'ban_failed' }); }

    const { error: logErr } = await admin.from('moderation_log').insert({
      actor_id: user.id, action: 'ban', target_type: 'user', target_id: userId, reason: reason,
    });
    if (logErr) { console.error('[admin-moderate] ban log failed', logErr); return json(500, { error: 'log_failed' }); }

    return json(200, { ok: true, status: 'banned', until });
  }

  // action === 'unban'
  const { error: authErr } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
  if (authErr) { console.error('[admin-moderate] unban auth failed', authErr); return json(500, { error: 'unban_failed' }); }

  const { error: mirrorErr } = await admin.from('profiles').update({
    moderation_status: 'active', moderation_reason: null, moderation_until: null, moderation_by: null,
  }).eq('id', userId);
  if (mirrorErr) { console.error('[admin-moderate] unban mirror failed', mirrorErr); return json(500, { error: 'mirror_failed' }); }

  const { error: logErr } = await admin.from('moderation_log').insert({
    actor_id: user.id, action: 'unban', target_type: 'user', target_id: userId, reason: null,
  });
  if (logErr) { console.error('[admin-moderate] unban log failed', logErr); return json(500, { error: 'log_failed' }); }

  return json(200, { ok: true, status: 'active' });
});
