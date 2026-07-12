// =====================================================================
// FEEDBACK — Cloud state sync (Phase 2.5)
// Mirror the legacy localStorage `store.state` into Supabase as a JSONB
// blob per user so actions survive across devices, browsers and PWA
// installs.
//
// API:
//   loadCloudState()              → Promise<state | null>
//   queueCloudSave(state)         → schedule a debounced upsert
//   flushCloudSave()              → upload immediately (use before logout)
//
// Boot order:
//   1. Restore session (auth.js)
//   2. syncProfileIntoStore() → currentUser
//   3. loadCloudState() → merge into store
//   4. App renders. Every subsequent setState triggers queueCloudSave().
// =====================================================================

import { supabase, isSupabaseConfigured } from './supabase.js';
import { registerCloudSave } from './mock-data.js';

// Fields we deliberately DO NOT sync via the cloud blob. Three buckets:
//   1. Volatile / session-only state (currentUser, viewingX, isLoggedIn)
//   2. Entities already normalized in Supabase tables (posts, parties,
//      follows, users) — these are shared across users via api.js, the
//      cloud blob would silo them per-user and overwrite the shared data.
//   3. (none yet — Phase 4 will move chat/ratings/questions here too)
const EXCLUDED_FROM_CLOUD = new Set([
  // Bucket 1: volatile
  'isLoggedIn',
  'onboardingComplete',
  'currentUser',
  'currentPage',
  'viewingUserId',
  'viewingPartyId',
  // Bucket 2: normalized in Supabase tables — the source of truth is
  // public.posts / public.parties / public.follows / public.profiles /
  // public.questions. If we round-trip them through the cloud blob,
  // User B sees their own old localStorage state instead of the shared
  // feed. `questions` joined this bucket in migration 0017 (was local-
  // only before).
  'posts',
  'parties',
  'follows',
  'users',
  'questions',
  // Built from public.party_attendees on every hydrate (see
  // hydration.js). Persisting per-user would let User B's stale RSVPs
  // overwrite the shared ground truth.
  'attendanceLog',
  // Mensajería privada (0038): normalizada en conversations/
  // conversation_members/conversation_messages y además CONTENIDO PRIVADO
  // con fotos base64 — jamás al blob.
  'conversations',
  // Se deriva del servidor en CADA hidratación (listConversations →
  // some(unread && !muted)). Si viajara en el blob, el boolean rancio de
  // otro dispositivo puede llegar DESPUÉS de la derivación fresca (pCloud
  // y pConversations corren en paralelo bajo el mismo allSettled) y
  // pisarla: badge apagado con DMs sin leer, o badge fantasma. Esta misma
  // lista filtra también la DESCARGA (stripCloudExclusions), así que un
  // blob viejo que aún traiga la clave tampoco puede sobreescribirla.
  // localStorage ya conserva el flag entre recargas del mismo dispositivo.
  'hasUnreadConversations',
  // Derivado por hidratación en cada boot (¿corrió ya la 0038?); un blob
  // rancio de otro dispositivo no debe decidir si el inbox "existe".
  'conversationsUnavailable',
  // La ciudad "principal" la manda el perfil (profiles.city), sembrada en
  // selectedCity en cada apertura por syncProfileIntoStore. Si viajara en
  // el blob, un valor rancio de otro dispositivo podría llegar DESPUÉS de
  // esa siembra (pCloud y pProfile corren en paralelo) y pisar la ciudad
  // del perfil. Queda como filtro local del dispositivo; el perfil es la
  // fuente de verdad al abrir.
  'selectedCity',
]);

const DEBOUNCE_MS = 1500;     // wait this long after the last change
const MAX_DELAY_MS = 10_000;  // but never let an unsaved change sit longer

let pendingTimer = null;
let firstQueueAt = 0;
let lastSerialized = '';      // skip uploads when nothing actually changed
let inflight = null;          // dedupe concurrent uploads

// Register the queue function with mock-data.js so saveState() can call
// back into cloud-sync without importing this module directly (the
// reverse import would create a real cycle).
registerCloudSave((state) => queueCloudSave(state));

function projectSyncable(state) {
  const out = {};
  for (const [k, v] of Object.entries(state)) {
    if (!EXCLUDED_FROM_CLOUD.has(k)) out[k] = v;
  }
  return out;
}

// Stripped on download too — defensive: a blob persisted before this
// migration may still contain posts/parties/follows. We MUST NOT let
// those overwrite the freshly-hydrated Supabase data.
export function stripCloudExclusions(cloud) {
  if (!cloud || typeof cloud !== 'object') return cloud;
  const out = {};
  for (const [k, v] of Object.entries(cloud)) {
    if (!EXCLUDED_FROM_CLOUD.has(k)) out[k] = v;
  }
  return out;
}

/**
 * Pull the cloud blob for the signed-in user. Returns null on no row,
 * no config, no session, or any read error.
 */
export async function loadCloudState(knownSession) {
  if (!isSupabaseConfigured()) return null;
  // Reuse the boot session when available — see syncProfileIntoStore for
  // why we avoid redundant getSession() calls during startup.
  let user = knownSession?.user;
  if (!user) {
    const { data: { session } } = await supabase.auth.getSession();
    user = session?.user;
  }
  if (!user) return null;

  const { data, error } = await supabase
    .from('user_app_state')
    .select('state')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.warn('[cloud-state] load failed', error);
    return null;
  }
  return data?.state || null;
}

/**
 * Debounced upsert. Safe to call on every store.setState — only the
 * final state within DEBOUNCE_MS goes over the wire. Force-uploads after
 * MAX_DELAY_MS so a constantly-changing state still gets persisted.
 */
export function queueCloudSave(state) {
  if (!isSupabaseConfigured()) return;
  if (!firstQueueAt) firstQueueAt = Date.now();

  const elapsedSinceFirst = Date.now() - firstQueueAt;
  if (elapsedSinceFirst >= MAX_DELAY_MS) {
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    firstQueueAt = 0;
    fireUpload(state);
    return;
  }

  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    firstQueueAt = 0;
    fireUpload(state);
  }, DEBOUNCE_MS);
}

/**
 * Immediate upload — call this from sign-out / page-unload paths so the
 * last in-memory mutations don't get lost in the debounce window.
 */
export async function flushCloudSave(state) {
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
  firstQueueAt = 0;
  await fireUpload(state);
}

async function fireUpload(state) {
  if (!isSupabaseConfigured()) return;
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return;

  const projected = projectSyncable(state);
  const serialized = stableStringify(projected);
  if (serialized === lastSerialized) return;   // nothing changed

  // Coalesce concurrent uploads: if one is already in flight, wait for
  // it to finish so we don't write out-of-order versions.
  if (inflight) {
    try { await inflight; } catch { /* swallow */ }
  }
  inflight = doUpload(user.id, projected, serialized);
  try { await inflight; } finally { inflight = null; }
}

async function doUpload(userId, state, serialized) {
  const { error } = await supabase
    .from('user_app_state')
    .upsert({ user_id: userId, state }, { onConflict: 'user_id' });

  if (error) {
    console.warn('[cloud-state] save failed', error);
    return;
  }
  lastSerialized = serialized;
}

// JSON.stringify with sorted keys: makes the equality check robust
// against key-insertion-order differences between consecutive renders.
function stableStringify(value) {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted = {};
      for (const k of Object.keys(v).sort()) sorted[k] = v[k];
      return sorted;
    }
    return v;
  });
}
