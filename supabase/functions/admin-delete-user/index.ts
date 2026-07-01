// =====================================================================
// FEEDBACK / PartyRate — admin-delete-user Edge Function (FASE 2)
// =====================================================================
// HARD delete: snapshot the profile to moderation_log, then
// auth.admin.deleteUser() which cascades (profiles FK is ON DELETE
// CASCADE from auth.users, and every content table cascades from
// profiles) — wiping the account and all its content irreversibly.
//
// This is the nuclear option; the GDPR-friendly default in the UI is
// admin_anonymize_user (keeps threads, strips PII). Requires auth.admin,
// so it can't be a pure-SQL RPC.
//
// SECURITY: JWT auth + service-role is_admin re-check. Cannot target an
// admin or the caller. Requires confirm:true in the body.
//
// Body: { userId, confirm:true }
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

  const { data: me } = await admin.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
  if (!me?.is_admin) return json(403, { error: 'forbidden' });

  let body: { userId?: string; confirm?: boolean };
  try { body = await req.json(); } catch { return json(400, { error: 'invalid_json' }); }

  const userId = (body.userId ?? '').toString();
  if (!userId) return json(400, { error: 'missing_userId' });
  if (body.confirm !== true) return json(400, { error: 'confirmation_required' });
  if (userId === user.id) return json(400, { error: 'cannot_target_self' });

  const { data: target } = await admin.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (!target) return json(404, { error: 'user_not_found' });
  if (target.is_admin) return json(400, { error: 'cannot_target_admin' });

  // Audit BEFORE the cascade wipes the row. before_state holds the full
  // profile snapshot (this is a hard delete — there is no restore).
  const { data: logRow } = await admin.from('moderation_log').insert({
    actor_id: user.id, action: 'hard_delete', target_type: 'user', target_id: userId,
    reason: null, before_state: target,
  }).select('id').single();

  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    console.error('[admin-delete-user] deleteUser failed', delErr);
    // Compensate: drop the audit row so the ledger never claims a delete
    // that didn't happen.
    if (logRow?.id) await admin.from('moderation_log').delete().eq('id', logRow.id);
    return json(500, { error: 'delete_failed' });
  }

  return json(200, { ok: true, deleted: userId });
});
