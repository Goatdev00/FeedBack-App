// =====================================================================
// FEEDBACK — Supabase data API (Phase 3 — normalized tables)
// =====================================================================
// One module per entity is overkill at this stage. We collect all the
// network-touching helpers here, grouped by concept. Each function:
//   * Maps DB rows (snake_case) → frontend shape (camelCase + Date).
//   * Throws on auth/permission errors so callers can show UI feedback.
//   * Returns the persisted row so the caller can replace optimistic
//     local state with the real server data.
//
// Conventions:
//   - All ids are UUIDs from now on (parties: hardcoded seeds; posts/
//     comments/etc: server-generated).
//   - Timestamps come back as Date instances ready for formatRelative.
//   - Author info is joined inline via PostgREST nested selects.
// =====================================================================

import { supabase, isSupabaseConfigured } from './supabase.js';
import { registerApi } from './mock-data.js';
import { router } from '../router.js';
// Push de conversaciones: notify.js solo importa supabase.js, así que
// este import no crea ciclo (mock-data.js ya lo importa igual).
import { notifyConversationMessage } from '../notifications/notify.js';

// ---------------------------------------------------------------------
// Profile shape adapter (matches profile-sync.js so consumers can pass
// either shape downstream).
// ---------------------------------------------------------------------
function authorFromRow(p) {
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    username: p.username?.startsWith('@') ? p.username : `@${p.username}`,
    role: p.role,
    city: p.city,
    avatar: p.avatar_url || null,
    premium: p.membership_tier && p.membership_tier !== 'general',
    tier: p.membership_tier || 'general',
    points: p.points ?? 0,
  };
}

// ---------------------------------------------------------------------
// Deploy-before-migrate: el frontend se despliega ANTES de que el usuario
// corra las migraciones 0037/0038/0039 a mano en el SQL editor. Cuando
// una query nombra una columna/tabla que el servidor aún no conoce,
// PostgREST responde PGRST204/PGRST205 ("not in schema cache") y Postgres
// crudo 42703/42P01. Estos helpers permiten degradar con elegancia
// (reintentar con el shape viejo, devolver lista vacía) en vez de romper
// el muro o la hidratación completa — mismo patrón ya probado del
// fallback PGRST200 de listPosts (post_comment_likes, 0036).
// ---------------------------------------------------------------------
function isMissingColumnError(error, cols = []) {
  if (!error) return false;
  if (error.code === 'PGRST204' || error.code === '42703') return true;
  const msg = error.message || '';
  return /column|schema cache/i.test(msg) && cols.some((c) => msg.includes(c));
}

export function isMissingTableError(error) {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  return /could not find the table|relation .+ does not exist/i.test(error.message || '');
}

// =====================================================================
// PARTIES
// =====================================================================
export async function listParties() {
  if (!isSupabaseConfigured()) return [];
  // After migration 0009 there is no synthetic global-chat party to
  // filter out — the global chat lives on a chat_rooms row with
  // party_id IS NULL.
  // Exclude admin-soft-deleted parties. The admin's is_admin() RLS
  // override returns deleted rows too (so the trash works), so the
  // *browsing* views must filter deleted_at explicitly or a moderated
  // party would reappear on the admin's own /parties after re-hydration.
  const { data, error } = await supabase
    .from('parties')
    .select('*')
    .is('deleted_at', null)
    .order('party_date', { ascending: true });
  if (error) throw error;
  return (data || []).map(partyFromRow);
}

function partyFromRow(p) {
  return {
    id: p.id,
    name: p.name,
    venue: p.venue,
    city: p.city,
    date: p.party_date,
    startTime: typeof p.start_time === 'string' ? p.start_time.slice(0, 5) : p.start_time,
    endTime:   typeof p.end_time   === 'string' ? p.end_time.slice(0, 5)   : p.end_time,
    genres: p.genres || [],
    promotor: p.promoter_id,
    djs: [],
    flyer: p.flyer_url,
    description: p.description || '',
    sponsored: !!p.sponsored,
    status: p.status,
    // Migración 0037: los selects de parties son `*`, así que si la
    // migración no corrió estas claves simplemente no vienen — default a
    // fiesta normal y sin boletería (filas viejas también carecen de kind).
    kind: p.kind === 'remate' ? 'remate' : 'party',
    ticketContactUrl: p.ticket_contact_url || null,
    attendees: [],    // filled by listAttendees()
    reports: {},      // legacy field, populated by ratings rollup later
    rating: {},
  };
}

export async function createParty(input) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('not_authenticated');
  const row = {
    name: input.name,
    venue: input.venue,
    city: input.city,
    party_date: input.date,
    start_time: input.startTime,
    end_time: input.endTime,
    genres: input.genres || [],
    promoter_id: user.id,
    flyer_url: input.flyer || null,
    description: input.description || null,
  };
  // Columnas de la migración 0037 — solo se incluyen cuando difieren del
  // default del servidor, para que un insert "clásico" (fiesta normal sin
  // boletería) nunca dependa de la migración.
  const newCols = {};
  if (input.kind === 'remate') newCols.kind = 'remate';
  if (input.ticketContactUrl) newCols.ticket_contact_url = input.ticketContactUrl;

  const { data, error } = await supabase
    .from('parties')
    .insert({ ...row, ...newCols })
    .select('*')
    .single();
  // Deploy-before-migrate (0037 pendiente): aquí NO hay strip-and-retry,
  // a propósito. Reintentar sin `kind` publicaría el remate como fiesta
  // normal — y de forma IRREVERSIBLE: al correr 0037, freeze_party_kind
  // pina kind a OLD para no-admins, así que ni el dueño podría
  // reclasificarlo. El mismo reintento tiraría ticket_contact_url en
  // silencio. Como newCols solo se puebla en esos dos casos, el error
  // debe SUBIR y verse ("Función aún no disponible…" vía describeApiError
  // en store.addParty) — el mismo criterio que createPost aplica al
  // video: mejor un error visible que un evento fantasma con el kind
  // equivocado.
  if (error) throw error;
  return partyFromRow(data);
}

// Update / delete are guarded server-side by parties_update_owner /
// parties_delete_owner (RLS in 0003): only `promoter_id = auth.uid()`
// rows are affected. The extra `.eq('promoter_id', user.id)` below is
// belt-and-suspenders so a UI bug can't accidentally send a
// PATCH/DELETE to someone else's row.
export async function updateParty(partyId, patch) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('not_authenticated');

  // Frontend keys → DB columns. Only fields actually present in the
  // patch get mapped — partial updates leave other columns untouched.
  const row = {};
  if (patch.name        !== undefined) row.name         = patch.name;
  if (patch.venue       !== undefined) row.venue        = patch.venue;
  if (patch.city        !== undefined) row.city         = patch.city;
  if (patch.date        !== undefined) row.party_date   = patch.date;
  if (patch.startTime   !== undefined) row.start_time   = patch.startTime;
  if (patch.endTime     !== undefined) row.end_time     = patch.endTime;
  if (patch.genres      !== undefined) row.genres       = patch.genres;
  if (patch.flyer       !== undefined) row.flyer_url    = patch.flyer;
  if (patch.description !== undefined) row.description  = patch.description;
  // Migración 0037. kind se mapea pero el trigger freeze_party_kind lo
  // pina a OLD para no-admins, así que enviarlo no reabre el gate de
  // promotor; ticket_contact_url es editable por el owner normalmente.
  if (patch.ticketContactUrl !== undefined) row.ticket_contact_url = patch.ticketContactUrl;
  if (patch.kind             !== undefined) row.kind               = patch.kind;

  const { data, error } = await supabase
    .from('parties')
    .update(row)
    .eq('id', partyId)
    .eq('promoter_id', user.id)
    .select('*')
    .single();
  if (error) throw error;
  return partyFromRow(data);
}

export async function deleteParty(partyId) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('not_authenticated');
  const { error } = await supabase
    .from('parties')
    .delete()
    .eq('id', partyId)
    .eq('promoter_id', user.id);
  if (error) throw error;
}

// =====================================================================
// POSTS
// =====================================================================
// Hard cap on the initial post hydration. Boot pulls just enough to
// fill the visible feed; older posts can be paginated in later.
const POSTS_INITIAL_LIMIT = 50;

// Comments embed WITH their likes (migration 0036). If that table isn't in
// the schema yet, PostgREST can't resolve the nested embed and rejects the
// WHOLE query — which would blank the feed (and, since base64 images are
// pruned from localStorage, drop every image until re-hydration succeeds).
// So we keep a likes-free fallback and retry with it on that specific error.
const POST_COMMENTS_WITH_LIKES = 'post_comments(id, user_id, content, created_at, post_comment_likes(user_id))';
const POST_COMMENTS_NO_LIKES   = 'post_comments(id, user_id, content, created_at)';

// Columnas de las migraciones 0037 (wall) y 0039 (video_url). Se degradan
// POR COLUMNA, no como bundle todo-o-nada: las migraciones se corren a
// mano una por una, así que existe una ventana real con `wall` ya viva y
// `video_url` aún ausente — quitar las dos porque falta UNA re-etiquetaría
// los posts de remates como fiestas (postFromRow defaultea wall a
// 'fiestas' cuando el select no la trae).
const POSTS_NEW_COL_NAMES = ['wall', 'video_url'];

// Fragmento de select con solo las columnas nuevas aún disponibles.
// `cols` = { wall: bool, video_url: bool } (disponibilidad, no contenido).
function postsNewColsFragment(cols) {
  const present = POSTS_NEW_COL_NAMES.filter((c) => cols[c]);
  return present.length ? `${present.join(', ')},` : '';
}

// ¿Qué columna señala el error como inexistente? PostgREST/Postgres la
// nombran en el mensaje (PGRST204: "Could not find the 'video_url' column
// of 'posts' in the schema cache"; 42703: «column "video_url" does not
// exist»). null si el mensaje no permite identificarla — los callers
// tratan ese caso de forma conservadora.
function missingColumnName(error, candidates) {
  const msg = error?.message || '';
  return candidates.find((c) => msg.includes(c)) || null;
}

function postsSelect(commentsEmbed, cols) {
  return `
    id, user_id, party_id, content, image_url, type, created_at, expires_at,
    hidden_at, hidden_reason, ${postsNewColsFragment(cols)}
    author:profiles!posts_user_id_fkey(id, name, username, role, city, avatar_url, membership_tier, points),
    post_likes(user_id),
    ${commentsEmbed}
  `;
}

export async function listPosts() {
  if (!isSupabaseConfigured()) return [];
  // Disponibilidad POR COLUMNA (0037: wall / 0039: video_url) — ver la
  // nota de POSTS_NEW_COL_NAMES. `run` cierra sobre `cols`, que el bucle
  // de fallback va degradando.
  const cols = { wall: true, video_url: true };
  const run = (commentsEmbed) => supabase
    .from('posts')
    .select(postsSelect(commentsEmbed, cols))
    // Exclude admin-soft-deleted posts AND deleted comments nested under
    // live posts. The admin's is_admin() RLS override returns deleted rows,
    // so the browsing feed must filter them or moderated content reappears
    // on the admin's own wall after re-hydration. (PostgREST embedded-
    // resource filter uses the embed name as the column prefix.)
    .is('deleted_at', null)
    .is('post_comments.deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(POSTS_INITIAL_LIMIT);

  // Fallbacks INDEPENDIENTES de deploy-before-migrate: el embed de
  // comment-likes (0036, PGRST200) y CADA columna 0037/0039 por separado
  // (42703/PGRST204). Cada error identifica UNA carencia y el bucle
  // reintenta quitando solo esa, así cualquier combinación de migraciones
  // pendientes sigue pintando el muro — y la ventana 0037-aplicada/
  // 0039-pendiente conserva `wall`, que es lo que mantiene los posts de
  // remates en su pestaña. Máx 3 reintentos: video_url + wall + likes, la
  // combinación completa.
  let withLikes = true;
  let { data, error } = await run(POST_COMMENTS_WITH_LIKES);
  for (let attempt = 0; error && attempt < 3; attempt++) {
    if ((cols.wall || cols.video_url) && isMissingColumnError(error, POSTS_NEW_COL_NAMES)) {
      const missing = missingColumnName(error, POSTS_NEW_COL_NAMES.filter((c) => cols[c]));
      console.warn(`[api] posts: columna ${missing || 'wall/video_url'} no disponible (¿migración 0037/0039 pendiente?) — fallback`, error);
      if (missing) {
        cols[missing] = false;
      } else {
        // Mensaje sin nombre de columna: en un READ degradar de más es
        // aceptable (el muro tiene que pintar) — se quitan las dos.
        cols.wall = false;
        cols.video_url = false;
      }
    } else if (withLikes && (error.code === 'PGRST200' || /post_comment_likes/i.test(error.message || ''))) {
      console.warn('[api] post_comment_likes embed unavailable (migration 0036 not applied?) — falling back', error);
      withLikes = false;
    } else {
      break;
    }
    ({ data, error } = await run(withLikes ? POST_COMMENTS_WITH_LIKES : POST_COMMENTS_NO_LIKES));
  }
  if (error) throw error;
  return (data || []).map(postFromRow);
}

function postFromRow(p) {
  const comments = (p.post_comments || [])
    .map(c => ({
      id: c.id,
      userId: c.user_id,
      text: c.content,
      createdAt: new Date(c.created_at),
      likedBy: (c.post_comment_likes || []).map(l => l.user_id),
      likes: (c.post_comment_likes || []).length,
    }))
    .sort((a, b) => a.createdAt - b.createdAt);

  return {
    id: p.id,
    userId: p.user_id,
    partyId: p.party_id,
    content: p.content,
    image: p.image_url,
    type: p.type,
    // Migraciones 0037/0039: filas o selects viejos no traen wall ni
    // video_url — default a la pestaña fiestas y sin video.
    wall: p.wall === 'remates' ? 'remates' : 'fiestas',
    videoUrl: p.video_url || null,
    likedBy: (p.post_likes || []).map(l => l.user_id),
    likes: (p.post_likes || []).length,
    comments,
    replies: comments.length,
    createdAt: new Date(p.created_at),
    expiresAt: new Date(p.expires_at),
    hiddenAt: p.hidden_at ? new Date(p.hidden_at) : null,
    hiddenReason: p.hidden_reason || null,
    author: p.author ? authorFromRow(p.author) : null,
  };
}

// Select de retorno del insert de posts (y del re-fetch de realtime): el
// autor va joineado para que la tarjeta pinte sin esperar a listProfiles.
// `cols` = disponibilidad por columna, como en postsSelect.
function postReturningSelect(cols) {
  return `
    id, user_id, party_id, content, image_url, type, created_at, expires_at, ${postsNewColsFragment(cols)}
    author:profiles!posts_user_id_fkey(id, name, username, role, city, avatar_url, membership_tier, points)
  `;
}

export async function createPost({ partyId, content, image, wall, videoUrl, type } = {}) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('not_authenticated');

  const baseRow = {
    user_id: user.id,
    // Posts libres (solo pestaña remates, 0037): party_id null.
    party_id: partyId || null,
    content,
    image_url: image || null,
    // 'video' gana si hay video; el resto conserva la heurística clásica.
    type: type || (videoUrl ? 'video' : (image ? 'photo' : 'text')),
  };
  // Columnas 0037/0039 — solo cuando difieren del default del servidor.
  const newCols = {};
  if (wall === 'remates') newCols.wall = 'remates';
  if (videoUrl) newCols.video_url = videoUrl;

  // Disponibilidad POR COLUMNA (0037: wall / 0039: video_url). El
  // RETURNING select también las nombra, así que incluso un post que no
  // ENVÍA una columna nueva puede fallar porque el select la pide — la
  // ventana real 0037-aplicada/0039-pendiente rompía así el posteo de
  // texto/foto a remates.
  const cols = { wall: true, video_url: true };
  const run = () => {
    const row = { ...baseRow };
    if (cols.wall && newCols.wall) row.wall = newCols.wall;
    if (cols.video_url && newCols.video_url) row.video_url = newCols.video_url;
    return supabase
      .from('posts')
      .insert(row)
      .select(postReturningSelect(cols))
      .single();
  };

  let { data, error } = await run();
  // Fallback deploy-before-migrate POR COLUMNA. Regla: una columna solo se
  // quita del reintento cuando NO cambia el significado de ESTE post; si
  // lo cambia, el error sube claro y visible. Concretamente:
  //   * Falta video_url y el post lleva video → sin reintento: quitarla
  //     publicaría un cascarón sin su video ("Función aún no disponible…"
  //     vía describeApiError).
  //   * Falta wall y el post va a remates → sin reintento y mensaje
  //     propio: JAMÁS publicar un post de remates como fiesta en silencio
  //     (y con 0037 a medias el reintento moriría igualmente en el trigger
  //     check_post_party_kind con un error críptico).
  //   * La columna que falta no afecta a este post (p.ej. falta video_url
  //     en un post de texto a remates, o falta wall en un post de fiestas)
  //     → se quita SOLO esa columna y se reintenta (máx 2 reintentos:
  //     peor caso, faltan las dos y el post no usa ninguna).
  //   * Mensaje sin nombre de columna identificable → conservador: solo
  //     reintenta un post clásico de fiestas sin video; remates/video no
  //     se degradan nunca a ciegas.
  // Un post libre (party_id null) pre-0037 sigue fallando visiblemente:
  // choca con el NOT NULL de party_id.
  for (let attempt = 0; error && attempt < 2 && isMissingColumnError(error, POSTS_NEW_COL_NAMES); attempt++) {
    const missing = missingColumnName(error, POSTS_NEW_COL_NAMES.filter((c) => cols[c]));
    if (missing === 'video_url' && videoUrl) break;
    if (missing === 'wall' && wall === 'remates') {
      throw new Error('Los remates se están activando (actualización del servidor pendiente).');
    }
    if (missing) {
      cols[missing] = false;
    } else if (!videoUrl && wall !== 'remates') {
      cols.wall = false;
      cols.video_url = false;
    } else {
      break;
    }
    console.warn(`[api] createPost: columna ${missing || 'wall/video_url'} no disponible (¿migración 0037/0039 pendiente?) — reintentando sin ella`, error);
    ({ data, error } = await run());
  }
  if (error) throw error;
  return postFromRow({ ...data, post_likes: [], post_comments: [] });
}

// =====================================================================
// REPORTS — abuse / spam, with auto-hide at threshold
// =====================================================================
// Calls the SECURITY DEFINER report_post() RPC, which is the ONLY way a
// client can write to post_reports or flip posts.hidden_at. Returns the
// post-rpc shape: { count, hidden, threshold }.
export async function reportPost(postId, reason) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data, error } = await supabase.rpc('report_post', {
    p_post_id: postId,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
}

// =====================================================================
// ADMIN MODERATION — super-admin ("FeedBack") soft-delete + restore
// =====================================================================
// Thin wrappers over the SECURITY DEFINER admin_* RPCs (migration 0033).
// Each RPC re-checks public.is_admin() server-side and raises 'forbidden'
// for non-admins, so these are safe to expose to the authenticated client;
// the UI gate (currentUser.isAdmin) is cosmetic. Each returns the new
// moderation_log id (soft-deletes) or void (restore).
export async function adminSoftDeletePost(postId, reason) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data, error } = await supabase.rpc('admin_soft_delete_post', {
    p_post_id: postId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data;
}

export async function adminSoftDeleteComment(commentId, reason) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data, error } = await supabase.rpc('admin_soft_delete_comment', {
    p_comment_id: commentId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data;
}

export async function adminSoftDeleteChatMessage(messageId, reason) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data, error } = await supabase.rpc('admin_soft_delete_chat_message', {
    p_message_id: messageId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data;
}

export async function adminSoftDeleteQuestion(questionId, reason) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data, error } = await supabase.rpc('admin_soft_delete_question', {
    p_question_id: questionId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data;
}

export async function adminSoftDeleteParty(partyId, reason) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data, error } = await supabase.rpc('admin_soft_delete_party', {
    p_party_id: partyId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data;
}

export async function adminRestore(logId) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { error } = await supabase.rpc('admin_restore', { p_log_id: logId });
  if (error) throw error;
}

// =====================================================================
// ADMIN — user management + broadcast + moderation queues (FASE 2)
// =====================================================================
// RPCs are SECURITY DEFINER + is_admin-gated (0034); Edge Functions
// JWT-auth + service-role is_admin re-check. UI gate stays cosmetic.
export async function adminListUsers({ search = null, role = null, status = null, limit = 50, offset = 0 } = {}) {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase.rpc('admin_list_users', {
    p_search: search, p_role: role, p_status: status, p_limit: limit, p_offset: offset,
  });
  if (error) throw error;
  return data || [];
}

export async function adminSetRole(userId, role) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { error } = await supabase.rpc('admin_set_role', { p_user: userId, p_role: role });
  if (error) throw error;
}

export async function adminSetModeration(userId, status, reason = null, until = null) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { error } = await supabase.rpc('admin_set_moderation', {
    p_user: userId, p_status: status, p_reason: reason, p_until: until,
  });
  if (error) throw error;
}

export async function adminAnonymizeUser(userId) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { error } = await supabase.rpc('admin_anonymize_user', { p_user: userId });
  if (error) throw error;
}

// Edge functions (need auth.admin / push / email).
// supabase.functions.invoke yields a FunctionsHttpError whose .message is a
// generic "non-2xx status code" — the real { error } reason lives in the
// response body. Unwrap it so the UI can show/match the actual reason.
async function invokeError(error) {
  let detail = '';
  try { detail = (await error?.context?.json())?.error || ''; } catch { /* body not JSON */ }
  return new Error(detail || error?.message || 'edge_error');
}

export async function adminBroadcast(payload) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data, error } = await supabase.functions.invoke('admin-broadcast', { body: payload });
  if (error) throw await invokeError(error);
  return data;
}

export async function adminModerateUser(userId, action, { reason = null, durationDays = null } = {}) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data, error } = await supabase.functions.invoke('admin-moderate', {
    body: { userId, action, reason, durationDays },
  });
  if (error) throw await invokeError(error);
  return data;
}

export async function adminDeleteUser(userId) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data, error } = await supabase.functions.invoke('admin-delete-user', {
    body: { userId, confirm: true },
  });
  if (error) throw await invokeError(error);
  return data;
}

// Reply to a support ticket → email to the ticket's contact address + push
// to the user's devices (if the ticket is tied to an account). The recipient
// is resolved server-side from the ticket id. Returns
// { emailSent, pushSent, pushRemoved, hasUser }.
export async function adminReplyTicket(ticketId, message) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data, error } = await supabase.functions.invoke('admin-reply-ticket', {
    body: { ticketId, message },
  });
  if (error) throw await invokeError(error);
  return data;
}

// Moderation-queue reads (admin-only via the 0034 RLS policies).
export async function listAdminReports() {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase
    .from('post_reports')
    .select('post_id, reporter_id, reason, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listAdminTickets() {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase
    .from('support_tickets')
    .select('id, user_id, name, email, message, status, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function setTicketStatus(ticketId, status) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { error } = await supabase.from('support_tickets').update({ status }).eq('id', ticketId);
  if (error) throw error;
}

// Resolve display names for a set of user ids (for the admin Q&A "Para: X").
export async function getProfileNames(ids) {
  if (!isSupabaseConfigured() || !ids.length) return {};
  const unique = [...new Set(ids.filter(Boolean))];
  const map = {};
  // Chunk the .in() list so a big id set can't blow the request-URI length
  // limit; a failed chunk warns + continues instead of blanking every name.
  for (let i = 0; i < unique.length; i += 150) {
    const chunk = unique.slice(i, i + 150);
    const { data, error } = await supabase.from('profiles').select('id, name, username').in('id', chunk);
    if (error) { console.warn('[api] getProfileNames chunk failed', error); continue; }
    for (const p of data || []) map[p.id] = p.name || p.username || 'Usuario';
  }
  return map;
}

// Recipient resolvers for the admin "ask a question to many" flow.
// profiles_read is open (using(true)); attendees_read gives the admin every
// attendee via the is_admin override. PAGINATED: an unbounded PostgREST
// select is capped at max_rows (1000), which would silently truncate a
// "to everyone" audience — loop by range until a short page. The explicit
// stable order prevents skipped/duplicated rows across page seams.
export async function listAllUserIds() {
  if (!isSupabaseConfigured()) return [];
  const ids = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('profiles').select('id').order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = data || [];
    for (const r of batch) ids.push(r.id);
    if (batch.length < PAGE) break;
  }
  return ids;
}

export async function listPartyAttendeeIds(partyId) {
  if (!isSupabaseConfigured()) return [];
  const ids = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('party_attendees').select('user_id').eq('party_id', partyId)
      .order('user_id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = data || [];
    for (const r of batch) ids.push(r.user_id);
    if (batch.length < PAGE) break;
  }
  return ids;
}

// Admin asks one question to many users at once. Inserts one questions row
// per recipient (asker = the admin, so the target sees an anonymous
// question they can answer). Excludes the admin themselves (questions_create
// forbids target = asker) and de-dupes. Chunked to keep inserts small.
export async function adminAskQuestion(questionText, recipientIds) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data: { session } } = await supabase.auth.getSession();
  const me = session?.user?.id;
  if (!me) throw new Error('not_authenticated');
  const rows = [...new Set(recipientIds)]
    .filter((id) => id && id !== me)
    .map((id) => ({ target_id: id, asker_id: me, question: questionText }));
  if (!rows.length) return { inserted: 0 };
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase.from('questions').insert(chunk);
    if (error) throw error;
    inserted += chunk.length;
  }
  return { inserted };
}

// =====================================================================
// POINTS — atomic, server-side persisted award
// =====================================================================
// The store bumps points optimistically in memory; this persists the
// delta to profiles.points via the award_points() RPC (migration 0020)
// and returns the NEW total so the store can reconcile. Without this the
// optimistic bump lived only on currentUser/users[], both excluded from
// the cloud blob, so syncProfileIntoStore() reset points to the profile
// default on every reload. Atomic increment server-side means two quick
// awards can't clobber each other.
export async function awardPoints(amount, reason) {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await supabase.rpc('award_points', {
    p_amount: amount,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data; // new total (integer)
}

// =====================================================================
// SUPPORT — "Habla con soporte"
// =====================================================================
// Files one row into support_tickets (migration 0022). Write-only: we do
// NOT chain .select() because the table has no SELECT policy for
// authenticated users, so reading the row back would fail RLS. We only
// need to know the insert landed (error === null).
export async function createSupportTicket({ name, email, message }) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('not_authenticated');
  const { error } = await supabase
    .from('support_tickets')
    .insert({ user_id: user.id, name, email, message });
  if (error) throw error;

  // Best-effort email notification to the support inbox via Resend (edge
  // function notify-support-ticket). The ticket is already saved, so an
  // email failure must NOT surface to the user — just log it. If the
  // function/secrets aren't deployed yet, this quietly no-ops.
  try {
    await supabase.functions.invoke('notify-support-ticket', {
      body: { name, email, message },
    });
  } catch (e) {
    console.warn('[support] email notification failed (ticket still saved)', e);
  }
}

// =====================================================================
// LIKES
// =====================================================================
export async function toggleLike(postId) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('not_authenticated');

  // Check if already liked. cheap because of the (post_id,user_id) PK.
  const { data: existing } = await supabase
    .from('post_likes')
    .select('post_id')
    .eq('post_id', postId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('post_likes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', user.id);
    if (error) throw error;
    return { liked: false };
  } else {
    const { error } = await supabase
      .from('post_likes')
      .insert({ post_id: postId, user_id: user.id });
    if (error) throw error;
    return { liked: true };
  }
}

// Like / unlike a COMMENT (mirror of toggleLike). Toggles the caller's row
// in post_comment_likes (migration 0036).
export async function toggleCommentLike(commentId) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('not_authenticated');

  const { data: existing } = await supabase
    .from('post_comment_likes')
    .select('comment_id')
    .eq('comment_id', commentId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('post_comment_likes')
      .delete()
      .eq('comment_id', commentId)
      .eq('user_id', user.id);
    if (error) throw error;
    return { liked: false };
  } else {
    const { error } = await supabase
      .from('post_comment_likes')
      .insert({ comment_id: commentId, user_id: user.id });
    if (error) throw error;
    return { liked: true };
  }
}

// =====================================================================
// COMMENTS
// =====================================================================
export async function addComment(postId, text) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('not_authenticated');
  const { data, error } = await supabase
    .from('post_comments')
    .insert({ post_id: postId, user_id: user.id, content: text })
    .select('id, user_id, content, created_at')
    .single();
  if (error) throw error;
  return {
    id: data.id,
    userId: data.user_id,
    text: data.content,
    createdAt: new Date(data.created_at),
    likedBy: [],
    likes: 0,
  };
}

// =====================================================================
// FOLLOWS (mutual connection = +10 each, server-side check is RLS-free)
// =====================================================================
export async function listFollows() {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase.from('follows').select('*');
  if (error) throw error;
  return (data || []).map(f => ({
    followerId: f.follower_id,
    followingId: f.following_id,
    createdAt: new Date(f.created_at),
  }));
}

export async function toggleFollow(targetId) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('not_authenticated');
  if (user.id === targetId) return { changed: false };

  const { data: existing } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('follower_id', user.id)
    .eq('following_id', targetId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('follower_id', user.id)
      .eq('following_id', targetId);
    if (error) throw error;
    return { changed: true, nowFollowing: false };
  } else {
    const { error } = await supabase
      .from('follows')
      .insert({ follower_id: user.id, following_id: targetId });
    if (error) throw error;
    return { changed: true, nowFollowing: true };
  }
}

// =====================================================================
// ATTENDANCE
// =====================================================================
export async function listAttendees() {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase
    .from('party_attendees')
    .select('party_id, user_id, attended_at');
  if (error) throw error;
  return data || [];
}

export async function toggleAttendance(partyId) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('not_authenticated');

  const { data: existing } = await supabase
    .from('party_attendees')
    .select('party_id')
    .eq('party_id', partyId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('party_attendees')
      .delete()
      .eq('party_id', partyId)
      .eq('user_id', user.id);
    if (error) throw error;
    return { attending: false };
  } else {
    const { error } = await supabase
      .from('party_attendees')
      .insert({ party_id: partyId, user_id: user.id });
    if (error) throw error;
    return { attending: true };
  }
}

// =====================================================================
// LIVE CHAT — chat_rooms + chat_messages over Supabase Realtime
// =====================================================================
// Frontend "room keys":
//   'general'              → the global chat: chat_rooms row with
//                            party_id IS NULL and type='public'.
//   'party:<uuid>'         → per-party public chat (auto-created by the
//                            create_party_chat_rooms() trigger).
//
// Each helper resolves the room id (uuid) lazily and caches it.
// =====================================================================
const _roomIdCache = new Map();

// Reverse lookup: room uuid → { type, partyId? } where type is
// 'general' | 'party' and partyId is set only for party rooms. Used by
// the global chat-messages realtime listener to decide which unread
// flag to flip (hasUnreadChatGeneral vs hasUnreadChatParty) AND, for
// party rooms, which specific partyId to mark in state.unreadChatRooms
// so chat-parties can paint a dot on that row. Filled lazily — by
// resolveChatRoomId() whenever a page reads a known room, and by an
// on-demand fetch in the realtime handler for rooms the user hasn't
// visited yet.
const _roomMetaById = new Map();

export async function resolveChatRoomId(roomKey) {
  if (_roomIdCache.has(roomKey)) return _roomIdCache.get(roomKey);

  let query;
  if (roomKey === 'general') {
    // Global room: no party, type=public, exactly one row exists
    // thanks to the partial unique index in migration 0009.
    query = supabase
      .from('chat_rooms')
      .select('id')
      .is('party_id', null)
      .eq('type', 'public')
      .maybeSingle();
  } else if (roomKey.startsWith('party:')) {
    const partyId = roomKey.slice('party:'.length);
    query = supabase
      .from('chat_rooms')
      .select('id')
      .eq('party_id', partyId)
      .eq('type', 'public')
      .maybeSingle();
  } else {
    return null;
  }

  const { data, error } = await query;
  if (error || !data) return null;
  _roomIdCache.set(roomKey, data.id);
  if (roomKey === 'general') {
    _roomMetaById.set(data.id, { type: 'general' });
  } else {
    _roomMetaById.set(data.id, { type: 'party', partyId: roomKey.slice('party:'.length) });
  }
  return data.id;
}

// Resolve room metadata by uuid (used by the realtime listener). Returns
// { type, partyId? } or null. Falls back to a single-row chat_rooms
// query when the cache misses (first message in a room the user hasn't
// visited).
async function resolveRoomMetaById(roomId) {
  if (_roomMetaById.has(roomId)) return _roomMetaById.get(roomId);
  const { data, error } = await supabase
    .from('chat_rooms')
    .select('party_id')
    .eq('id', roomId)
    .maybeSingle();
  if (error || !data) return null;
  const meta = data.party_id == null
    ? { type: 'general' }
    : { type: 'party', partyId: data.party_id };
  _roomMetaById.set(roomId, meta);
  return meta;
}

// video_url llegó en 0039 — se pide aparte para poder degradar el select
// mientras la migración no corra (deploy-before-migrate).
const CHAT_MSG_COLS_OLD = 'id, room_id, user_id, content, author_tier, author_role, is_host, status, created_at';
const CHAT_MSG_COLS_NEW = CHAT_MSG_COLS_OLD + ', video_url';

export async function listChatMessages(roomKey, limit = 100) {
  if (!isSupabaseConfigured()) return [];
  const roomId = await resolveChatRoomId(roomKey);
  if (!roomId) return [];
  // Order DESC + limit fetches the LATEST `limit` messages (the previous
  // ASC + limit returned the 100 OLDEST rows of the room's history, so
  // any room past 100 messages looked frozen in the past forever). The
  // reverse() below restores chronological order for rendering. Backed
  // by the chat_messages_room_idx (room_id, created_at desc) index.
  const run = (cols) => supabase
    .from('chat_messages')
    .select(cols)
    .eq('room_id', roomId)
    .eq('status', 'visible')
    // admin_soft_delete_chat_message sets deleted_at (not status), and the
    // admin's RLS override returns deleted rows — filter explicitly so a
    // moderated message doesn't reappear when the admin re-enters the room.
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  let { data, error } = await run(CHAT_MSG_COLS_NEW);
  if (error && isMissingColumnError(error, ['video_url'])) {
    console.warn('[api] chat_messages.video_url no disponible (¿migración 0039 pendiente?) — fallback', error);
    ({ data, error } = await run(CHAT_MSG_COLS_OLD));
  }
  if (error) throw error;
  return (data || []).map(chatMsgFromRow).reverse();
}

function chatMsgFromRow(m) {
  return {
    id: m.id,
    userId: m.user_id,
    content: m.content,
    // 0039: mensajes con video adjunto. Selects/filas viejos → null.
    videoUrl: m.video_url || null,
    authorTier: m.author_tier,
    authorRole: m.author_role,
    isHost: !!m.is_host,
    createdAt: new Date(m.created_at),
  };
}

// Firma extendida y retrocompatible (0039): `content` puede ser null en
// mensajes solo-video; los callers existentes (roomKey, text) no cambian.
export async function sendChatMessageDB(roomKey, content, { videoUrl } = {}) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const text = (content || '').trim();
  if (!text && !videoUrl) return null;
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('not_authenticated');
  const roomId = await resolveChatRoomId(roomKey);
  if (!roomId) throw new Error('room_not_found');

  // author_tier / author_role / is_host are snapshotted by the
  // snapshot_message_meta() BEFORE INSERT trigger — we only send the
  // raw content + ids.
  const row = { room_id: roomId, user_id: user.id, content: text || null };
  if (videoUrl) row.video_url = videoUrl;

  const run = (cols) => supabase
    .from('chat_messages')
    .insert(row)
    .select(cols)
    .single();

  let { data, error } = await run(CHAT_MSG_COLS_NEW);
  // Sin video adjunto el select degrada tranquilo (0039 pendiente); CON
  // video NO se reintenta — perder el adjunto en silencio sería mentirle
  // al que envía. Ese error sube y la página lo muestra.
  if (error && !videoUrl && isMissingColumnError(error, ['video_url'])) {
    ({ data, error } = await run(CHAT_MSG_COLS_OLD));
  }
  if (error) throw error;
  return chatMsgFromRow(data);
}

/**
 * Subscribe to new chat_messages in a room. Returns an unsubscribe fn.
 * The page passes a callback that receives the new message object —
 * the page is responsible for deciding when to repaint.
 */
export function subscribeChatRoom(roomKey, onMessage) {
  let channel = null;
  let cancelled = false;

  (async () => {
    const roomId = await resolveChatRoomId(roomKey);
    if (!roomId || cancelled || !isSupabaseConfigured()) return;
    channel = supabase
      .channel(`chat-room:${roomId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          if (!payload.new) return;
          onMessage(chatMsgFromRow(payload.new));
        })
      .subscribe();
  })();

  return () => {
    cancelled = true;
    if (channel) supabase.removeChannel(channel);
  };
}

// =====================================================================
// CONVERSACIONES — mensajería privada: DMs + grupos (migración 0038)
// =====================================================================
// Tablas dedicadas (conversations / conversation_members /
// conversation_messages), NUNCA chat_rooms: las salas públicas y los
// hilos privados tienen reglas de visibilidad opuestas. La creación va
// por RPCs SECURITY DEFINER (create_dm / create_group) porque insertar
// cabecera + member rows bajo RLS es un huevo-y-gallina.
//
// El shape cliente de una conversación (el que vive en
// store.state.conversations) se deriva aquí con el uid propio:
//   { id, kind:'dm'|'group', title, photo, createdBy, dmKey,
//     otherUserId (solo DM), members:[{userId, role, muted, lastReadAt}],
//     myRole, muted (MI flag), lastReadAt (MÍO), lastMessage|null,
//     lastMessageAt:Date, createdAt:Date, unread:bool }
// =====================================================================

// UNA query trae cabecera + miembros + último mensaje visible por hilo.
// El embed de mensajes va DESC + limit 1 (foreignTable) — el inbox solo
// necesita el preview; el hilo completo lo pagina la página con
// listConversationMessages.
const CONVERSATIONS_SELECT = `
  id, kind, title, photo_url, created_by, dm_key, last_message_at, created_at,
  conversation_members(user_id, role, muted, last_read_at),
  conversation_messages(id, conversation_id, user_id, content, image_url, video_url, created_at)
`;

function convMessageFromRow(m) {
  return {
    id: m.id,
    conversationId: m.conversation_id,
    userId: m.user_id,
    content: m.content,
    image: m.image_url || null,
    videoUrl: m.video_url || null,
    createdAt: new Date(m.created_at),
  };
}

function conversationFromRow(c, meId) {
  const members = (c.conversation_members || []).map((m) => ({
    userId: m.user_id,
    role: m.role,
    muted: !!m.muted,
    lastReadAt: m.last_read_at ? new Date(m.last_read_at) : null,
  }));
  const mine = members.find((m) => m.userId === meId) || null;
  // En un DM el "otro" define avatar y nombre del hilo (title es null).
  const other = c.kind === 'dm' ? members.find((m) => m.userId !== meId) : null;
  // El embed viene DESC + limit 1 → [0] es el último mensaje visible.
  const lastRow = (c.conversation_messages || [])[0] || null;
  const lastMessage = lastRow
    ? convMessageFromRow({ ...lastRow, conversation_id: lastRow.conversation_id || c.id })
    : null;
  return {
    id: c.id,
    kind: c.kind === 'group' ? 'group' : 'dm',
    title: c.title || null,
    photo: c.photo_url || null,
    createdBy: c.created_by || null,
    dmKey: c.dm_key || null,
    otherUserId: other?.userId || null,
    members,
    myRole: mine?.role || 'member',
    muted: !!mine?.muted,
    lastReadAt: mine?.lastReadAt || null,
    lastMessage,
    lastMessageAt: c.last_message_at ? new Date(c.last_message_at) : new Date(c.created_at),
    createdAt: new Date(c.created_at),
    // Unread = último mensaje ajeno posterior a mi last_read_at. Solo se
    // deriva aquí (hidratación); el realtime lo va marcando en vivo.
    unread: !!(lastMessage && meId && lastMessage.userId !== meId
      && (!mine?.lastReadAt || lastMessage.createdAt > mine.lastReadAt)),
  };
}

// Acepta knownSession por lo mismo que loadCloudState: en boot un
// getSession() extra puede serializar detrás de un token-refresh lento
// (navigator.locks) y congelar el resto de queries.
export async function listConversations(knownSession) {
  if (!isSupabaseConfigured()) return [];
  let user = knownSession?.user;
  if (!user) {
    const { data: { session } } = await supabase.auth.getSession();
    user = session?.user;
  }
  if (!user) return [];
  const { data, error } = await supabase
    .from('conversations')
    .select(CONVERSATIONS_SELECT)
    // Soft-delete (0031/0038): un mensaje moderado no puede ser el preview.
    .is('conversation_messages.deleted_at', null)
    .order('created_at', { foreignTable: 'conversation_messages', ascending: false })
    .limit(1, { foreignTable: 'conversation_messages' })
    // RLS ya filtra a "mis" conversaciones; orden = actividad (bump del
    // trigger de 0038), estilo inbox de WhatsApp.
    .order('last_message_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((c) => conversationFromRow(c, user.id));
}

// Re-fetch de UNA conversación (realtime de un hilo que no está en el
// store, post-create_dm/create_group). null si RLS no me deja verla.
export async function getConversation(conversationId) {
  if (!isSupabaseConfigured()) return null;
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return null;
  const { data, error } = await supabase
    .from('conversations')
    .select(CONVERSATIONS_SELECT)
    .eq('id', conversationId)
    .is('conversation_messages.deleted_at', null)
    .order('created_at', { foreignTable: 'conversation_messages', ascending: false })
    .limit(1, { foreignTable: 'conversation_messages' })
    .maybeSingle();
  if (error) throw error;
  return data ? conversationFromRow(data, user.id) : null;
}

// Historial de un hilo — plantilla listChatMessages: DESC + limit +
// reverse() para traer los ÚLTIMOS `limit` en orden cronológico.
export async function listConversationMessages(conversationId, limit = 100) {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase
    .from('conversation_messages')
    .select('id, conversation_id, user_id, content, image_url, video_url, created_at')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(convMessageFromRow).reverse();
}

// Enviar mensaje a un hilo. El push (send-push tipo 'conversation') se
// dispara AQUÍ y no en el store, para que tanto la página del hilo (que
// llama a la api directo, buffer page-scoped como chat.js) como el store
// generen exactamente UN push por mensaje. El fan-out a los miembros no
// silenciados es 100% server-side.
export async function sendConversationMessage(conversationId, { content, image, videoUrl } = {}) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const text = (content || '').trim();
  if (!text && !image && !videoUrl) return null;
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('not_authenticated');
  const { data, error } = await supabase
    .from('conversation_messages')
    .insert({
      conversation_id: conversationId,
      user_id: user.id,
      content: text || null,
      image_url: image || null,
      video_url: videoUrl || null,
    })
    .select('id, conversation_id, user_id, content, image_url, video_url, created_at')
    .single();
  if (error) throw error;
  const msg = convMessageFromRow(data);
  // Fire-and-forget (notify.js se traga sus propios errores): el mensaje
  // ya está persistido y el realtime lo entrega aunque el push falle.
  notifyConversationMessage(conversationId, msg.id);
  return msg;
}

// --- Creación (RPCs SECURITY DEFINER de 0038) ---
export async function createDM(otherUserId) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data, error } = await supabase.rpc('create_dm', { p_other: otherUserId });
  if (error) throw error;
  return data; // uuid del hilo (existente o recién creado — dedupe por dm_key)
}

export async function createGroup({ title, photo, memberIds } = {}) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data, error } = await supabase.rpc('create_group', {
    p_title: title,
    p_photo: photo || null,
    p_members: memberIds || [],
  });
  if (error) throw error;
  return data; // uuid del grupo
}

export async function addGroupMembers(conversationId, memberIds) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { error } = await supabase.rpc('add_group_members', {
    p_conv: conversationId,
    p_members: memberIds || [],
  });
  if (error) throw error;
}

// --- Mi fila de miembro (mute / read) ---
// RLS conversation_members_update_self limita el UPDATE a user_id =
// auth.uid(); el .eq() extra es el mismo cinturón-y-tirantes de siempre.
export async function setConversationMuted(conversationId, muted) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('not_authenticated');
  const { error } = await supabase
    .from('conversation_members')
    .update({ muted: !!muted })
    .eq('conversation_id', conversationId)
    .eq('user_id', user.id);
  if (error) throw error;
}

export async function markConversationRead(conversationId) {
  if (!isSupabaseConfigured()) return;
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return;
  const { error } = await supabase
    .from('conversation_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', user.id);
  if (error) throw error;
}

// Renombrar / cambiar foto del grupo — RLS: solo owner y solo grupos.
export async function updateGroupMeta(conversationId, { title, photo } = {}) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const row = {};
  if (title !== undefined) row.title = title;
  if (photo !== undefined) row.photo_url = photo;
  if (!Object.keys(row).length) return null;
  const { data, error } = await supabase
    .from('conversations')
    .update(row)
    .eq('id', conversationId)
    .select('id, title, photo_url')
    .single();
  if (error) throw error;
  return { id: data.id, title: data.title || null, photo: data.photo_url || null };
}

// Salir del hilo (RLS: borrar MI fila; el owner puede expulsar, pero esa
// UI no existe todavía).
export async function leaveConversation(conversationId) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('not_authenticated');
  const { error } = await supabase
    .from('conversation_members')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('user_id', user.id);
  if (error) throw error;
}

// --- Conversación activa ---
// La página del hilo registra qué conversación tiene abierta para que el
// handler global de 'conversations-feed' NO la marque como no-leída (el
// usuario la está mirando; el canal por-hilo pinta el mensaje).
let _activeConversationId = null;
export function setActiveConversation(conversationId) {
  _activeConversationId = conversationId || null;
}
export function getActiveConversation() {
  return _activeConversationId;
}

/**
 * Canal filtrado POR HILO para la página de conversación (clon de
 * subscribeChatRoom, sin resolución async porque el id ya es la clave).
 * Devuelve la función de unsubscribe.
 */
export function subscribeConversation(conversationId, onMessage) {
  if (!isSupabaseConfigured()) return () => {};
  const channel = supabase
    .channel(`conversation:${conversationId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'conversation_messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => {
        if (!payload.new) return;
        onMessage(convMessageFromRow(payload.new));
      })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

// =====================================================================
// QUESTIONS (anonymous Q&A) — see migration 0017
// =====================================================================
// Asker identity stays in the DB (asker_id) so the asker can find their
// own questions back; the UI on every other surface treats the question
// as anonymous. RLS prevents non-askers from learning asker_id.
// =====================================================================

function questionFromRow(q) {
  return {
    id: q.id,
    targetUserId: q.target_id,
    askerId: q.asker_id,
    question: q.question,
    answer: q.answer || null,
    anonymous: true,
    createdAt: new Date(q.created_at),
    answeredAt: q.answered_at ? new Date(q.answered_at) : null,
  };
}

export async function listQuestions() {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase
    .from('questions')
    .select('id, target_id, asker_id, question, answer, created_at, answered_at')
    // Exclude admin-soft-deleted questions (admin RLS override returns them).
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(questionFromRow);
}

// ---------------------------------------------------------------------
// moderation_log — the admin trash / audit ledger (migration 0031).
// RLS exposes it to admins only; a non-admin gets an empty list (no rows
// pass the policy), so this is safe to call unconditionally from the
// admin page (which is itself gated). Returns newest-first.
// ---------------------------------------------------------------------
function moderationLogFromRow(r) {
  return {
    id: r.id,
    actorId: r.actor_id,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    reason: r.reason || null,
    beforeState: r.before_state || null,
    manifest: r.manifest || null,
    createdAt: new Date(r.created_at),
    restoredAt: r.restored_at ? new Date(r.restored_at) : null,
  };
}

export async function listModerationLog() {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase
    .from('moderation_log')
    .select('id, actor_id, action, target_type, target_id, reason, before_state, manifest, created_at, restored_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(moderationLogFromRow);
}

// ---------------------------------------------------------------------
// admin_broadcasts — the sent-notification history (migration 0035).
// Written by the admin-broadcast Edge Function (service role) after each
// real send; RLS exposes it to admins only. Returns newest-first.
// ---------------------------------------------------------------------
function broadcastFromRow(r) {
  return {
    id: r.id,
    actorId: r.actor_id,
    title: r.title,
    body: r.body,
    url: r.url || null,
    channels: r.channels || {},
    targetType: r.target_type,
    recipients: r.target_count ?? 0,
    pushSent: r.push_sent ?? 0,
    emailSent: r.email_sent ?? 0,
    createdAt: new Date(r.created_at),
  };
}

export async function listAdminBroadcasts(limit = 50) {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase
    .from('admin_broadcasts')
    .select('id, actor_id, title, body, url, channels, target_type, target_count, push_sent, email_sent, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(broadcastFromRow);
}

export async function createQuestion(targetUserId, questionText) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('not_authenticated');
  const { data, error } = await supabase
    .from('questions')
    .insert({
      target_id: targetUserId,
      asker_id: user.id,
      question: questionText,
    })
    .select('id, target_id, asker_id, question, answer, created_at, answered_at')
    .single();
  if (error) throw error;
  return questionFromRow(data);
}

export async function answerQuestion(questionId, answerText) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('not_authenticated');
  const { data, error } = await supabase
    .from('questions')
    .update({
      answer: answerText,
      answered_at: new Date().toISOString(),
    })
    .eq('id', questionId)
    .eq('target_id', user.id)        // belt + suspenders next to RLS
    .select('id, target_id, asker_id, question, answer, created_at, answered_at')
    .single();
  if (error) throw error;
  return questionFromRow(data);
}

// The target can remove a harassing question. RLS (questions_delete in
// 0017) already restricts the DELETE to target_id = auth.uid(); the
// extra .eq() is the same belt-and-suspenders used everywhere else.
// Without Supabase (demo mode) this resolves as a no-op so the store's
// optimistic local removal stands instead of being rolled back.
export async function deleteQuestion(questionId) {
  if (!isSupabaseConfigured()) return;
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('not_authenticated');
  const { error } = await supabase
    .from('questions')
    .delete()
    .eq('id', questionId)
    .eq('target_id', user.id);
  if (error) throw error;
}

// =====================================================================
// PROFILE PATCH (theme, etc) — small partial updates
// =====================================================================
export async function patchProfileTheme(theme) {
  if (!isSupabaseConfigured()) return;
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return;
  const { error } = await supabase
    .from('profiles')
    .update({ theme: theme === 'light' ? 'light' : 'dark' })
    .eq('id', user.id);
  if (error) throw error;
}

// Register write-side helpers with the store so it can persist through
// to Supabase. Reads are still triggered from main.js via hydrateAll().
registerApi({
  createPost,
  toggleLike,
  toggleCommentLike,
  addComment,
  toggleFollow,
  toggleAttendance,
  createParty,
  updateParty,
  deleteParty,
  patchProfileTheme,
  reportPost,
  awardPoints,
  createQuestion,
  answerQuestion,
  deleteQuestion,
  // Mensajería privada (0038)
  sendConversationMessage,
  createDM,
  createGroup,
  addGroupMembers,
  setConversationMuted,
  markConversationRead,
  updateGroupMeta,
  leaveConversation,
  getConversation,
});

// =====================================================================
// REALTIME — subscribe to live changes so OTHER users' posts / likes /
// comments appear in the wall without a refresh.
// =====================================================================
let _realtimeChannel = null;

export function subscribeRealtime(store) {
  if (!isSupabaseConfigured()) return () => {};
  if (_realtimeChannel) {
    // Already subscribed; cheap idempotency.
    return () => unsubscribeRealtime();
  }

  _realtimeChannel = supabase
    .channel('public-feed')
    // New post anywhere → re-fetch the single post with its author and
    // prepend to the store. Cheaper than re-listing everything.
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'posts' },
      async (payload) => {
        const id = payload.new?.id;
        if (!id) return;
        // Re-fetch con wall/video_url (0037/0039), degradando POR COLUMNA
        // mientras las migraciones no corran: quitar las dos porque falta
        // una (0037 aplicada, 0039 pendiente) re-etiquetaría un post de
        // remates como fiesta al prepend. Es un READ, así que si el
        // mensaje no nombra la columna se quitan las que queden.
        const cols = { wall: true, video_url: true };
        const fetchOne = () => supabase
          .from('posts')
          .select(postReturningSelect(cols))
          .eq('id', id)
          .single();
        let { data, error } = await fetchOne();
        for (let attempt = 0; error && attempt < 2 && isMissingColumnError(error, POSTS_NEW_COL_NAMES); attempt++) {
          const missing = missingColumnName(error, POSTS_NEW_COL_NAMES.filter((c) => cols[c]));
          if (missing) {
            cols[missing] = false;
          } else {
            cols.wall = false;
            cols.video_url = false;
          }
          ({ data, error } = await fetchOne());
        }
        if (error || !data) return;
        const fresh = postFromRow({ ...data, post_likes: [], post_comments: [] });
        const state = store.getState();

        // Skip the canonical row if it's already in the list.
        if (state.posts.some(p => p.id === fresh.id)) return;

        // If this is the realtime echo of OUR own optimistic insert,
        // replace the pending row in place instead of duplicating. We
        // match by (userId + content) since createPost may not have
        // replied yet with the server id.
        const pendingIdx = state.posts.findIndex(
          p => p._pending && p.userId === fresh.userId && p.content === fresh.content
        );
        if (pendingIdx !== -1) {
          const replaced = [...state.posts];
          replaced[pendingIdx] = fresh;
          store.setState({ posts: replaced });
          // Wall isn't store-subscribed; without a repaint the
          // .post-card-pending class lingers in the DOM.
          if (router.getCurrentRoute() === 'wall') router.refreshCurrentRoute();
          return;
        }

        // Foreign new post → prepend + make sure the author is in state.users
        // so wall.js can render their name (otherwise it filters silently).
        const next = { posts: [fresh, ...state.posts] };
        if (fresh.author && !state.users.some(u => u.id === fresh.author.id)) {
          next.users = [fresh.author, ...state.users];
        }
        store.setState(next);
        if (router.getCurrentRoute() === 'wall') router.refreshCurrentRoute();
      })
    // Post updates (most importantly: hidden_at flipping when a post
    // crosses the report threshold). RLS prevents non-author clients
    // from receiving the row at all once it's hidden; the author still
    // gets it and can render the "blocked by reports" overlay.
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'posts' },
      (payload) => {
        const p = payload.new;
        if (!p) return;
        const state = store.getState();
        const idx = state.posts.findIndex(x => x.id === p.id);
        if (idx === -1) return;
        const merged = {
          ...state.posts[idx],
          hiddenAt: p.hidden_at ? new Date(p.hidden_at) : null,
          hiddenReason: p.hidden_reason || null,
        };
        const next = [...state.posts];
        next[idx] = merged;
        store.setState({ posts: next });
        if (router.getCurrentRoute() === 'wall') router.refreshCurrentRoute();
      })
    // Likes: increment/decrement the corresponding post's like array.
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'post_likes' },
      (payload) => {
        const { post_id, user_id } = payload.new || {};
        const state = store.getState();
        const post = state.posts.find(p => p.id === post_id);
        if (!post) return;
        if (!post.likedBy.includes(user_id)) {
          post.likedBy.push(user_id);
          post.likes++;
          store.setState({ posts: [...state.posts] });
        }
      })
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'post_likes' },
      (payload) => {
        const { post_id, user_id } = payload.old || {};
        const state = store.getState();
        const post = state.posts.find(p => p.id === post_id);
        if (!post) return;
        if (post.likedBy.includes(user_id)) {
          post.likedBy = post.likedBy.filter(id => id !== user_id);
          post.likes = Math.max(0, post.likes - 1);
          store.setState({ posts: [...state.posts] });
        }
      })
    // Comments: append to the matching post.
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'post_comments' },
      async (payload) => {
        const c = payload.new;
        if (!c) return;
        const state = store.getState();
        const post = state.posts.find(p => p.id === c.post_id);
        if (!post) return;
        if (!post.comments) post.comments = [];
        if (post.comments.some(x => x.id === c.id)) return; // dedupe with optimistic
        post.comments.push({
          id: c.id,
          userId: c.user_id,
          text: c.content,
          createdAt: new Date(c.created_at),
          likedBy: [],
          likes: 0,
        });
        post.replies = post.comments.length;

        // Ensure the commenter is in state.users so wall.js can render
        // their name. If we don't have them locally, fetch lazily.
        const next = { posts: [...state.posts] };
        if (!state.users.some(u => u.id === c.user_id)) {
          const { data } = await supabase
            .from('profiles')
            .select('id, name, username, role, city, avatar_url, membership_tier, points')
            .eq('id', c.user_id)
            .maybeSingle();
          if (data) next.users = [authorFromRow(data), ...state.users];
        }
        store.setState(next);
      })
    // New party (e.g. a promoter just created one) → prepend to list.
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'parties' },
      (payload) => {
        const p = payload.new;
        if (!p) return;
        const state = store.getState();
        // Already in the list (real id) → ignore echo.
        if (state.parties.some(x => x.id === p.id)) return;

        const fresh = partyFromRow(p);
        // If this is the realtime echo of OUR own optimistic insert, the
        // local entry still has a temp id (pending_<ts>) and _pending=true.
        // Replace it in place instead of appending a second copy. Without
        // this, the creator sees their party twice (one temp, one real)
        // until the next reload.
        const pendingIdx = state.parties.findIndex(
          x => x._pending && x.promotor === fresh.promotor && x.name === fresh.name
        );
        if (pendingIdx !== -1) {
          const replaced = [...state.parties];
          replaced[pendingIdx] = fresh;
          store.setState({ parties: replaced });
          return;
        }

        store.setState({ parties: [fresh, ...state.parties] });
      })
    // Party edits (creator changed name/venue/time/etc) → replace the
    // row in place. We preserve attendees because that join lives in a
    // separate table and isn't part of the parties row.
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'parties' },
      (payload) => {
        const p = payload.new;
        if (!p) return;
        const state = store.getState();
        const idx = state.parties.findIndex(x => x.id === p.id);
        if (idx === -1) return;
        const fresh = partyFromRow(p);
        const merged = { ...fresh, attendees: state.parties[idx].attendees || [] };
        const next = [...state.parties];
        next[idx] = merged;
        store.setState({ parties: next });
        const route = router.getCurrentRoute();
        if (route === 'parties' || route === 'party-detail' || route === 'wall') {
          router.refreshCurrentRoute();
        }
      })
    // Party deletes (creator removed the event) → drop from the local
    // list and bounce back to /parties if the user was viewing the
    // detail page of the deleted party.
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'parties' },
      (payload) => {
        const p = payload.old;
        if (!p) return;
        const state = store.getState();
        if (!state.parties.some(x => x.id === p.id)) return;
        store.setState({ parties: state.parties.filter(x => x.id !== p.id) });
        if (router.getCurrentRoute() === 'party-detail'
            && state.viewingPartyId === p.id) {
          router.navigate('parties');
        } else {
          const route = router.getCurrentRoute();
          if (route === 'parties' || route === 'wall') router.refreshCurrentRoute();
        }
      })
    // Any new chat message anywhere → flip the unread flag for its room
    // TYPE (general or party). The wall lights up if either is set; the
    // chat-hub page shows a dot on the specific card. We listen across
    // ALL rooms here (no filter) so messages in either side trigger the
    // indicator; the per-room subscription in chat.js still handles the
    // in-room paint. Room type is resolved from the cache populated by
    // resolveChatRoomId(), falling back to a one-shot chat_rooms query
    // for rooms the user hasn't entered yet (so the dot still appears).
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages' },
      async (payload) => {
        const m = payload.new;
        if (!m) return;
        const state = store.getState();
        // Skip our own messages.
        if (state.currentUser && m.user_id === state.currentUser.id) return;
        const meta = await resolveRoomMetaById(m.room_id);
        if (!meta) return;

        if (meta.type === 'general') {
          // Rolled-up flag drives wall + chat-hub general card. Skip if
          // already on to avoid pointless setState/repaint churn.
          if (!store.getState().hasUnreadChatGeneral) {
            store.setState({ hasUnreadChatGeneral: true });
          }
        } else {
          // Party room: set BOTH the rolled-up flag (drives the wall and
          // the chat-hub "Chat por fiesta" card) AND the per-party
          // entry in unreadChatRooms (drives the green dot on the
          // specific row in chat-parties). Bail out early if both are
          // already on for this party so we don't repaint pointlessly.
          const cur = store.getState();
          const partyId = meta.partyId;
          const alreadyFlagged = cur.hasUnreadChatParty && cur.unreadChatRooms?.[partyId];
          if (!alreadyFlagged) {
            store.setState({
              hasUnreadChatParty: true,
              unreadChatRooms: { ...(cur.unreadChatRooms || {}), [partyId]: true },
            });
          }
        }

        // Repaint only on the routes that consume these signals.
        // chat-parties is new in this set — it now shows a per-row
        // dot driven by state.unreadChatRooms.
        const route = router.getCurrentRoute();
        if (route === 'wall' || route === 'chat-hub' || route === 'chat-parties') {
          router.refreshCurrentRoute();
        }
      })
    // Questions: new INSERTs mean someone asked the target a question →
    // surface as a notification on the target's device. UPDATEs are the
    // answer landing → asker's view of their own question (and any other
    // visitor on the profile) refreshes to show the answer.
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'questions' },
      (payload) => {
        const q = payload.new;
        if (!q) return;
        const state = store.getState();
        // Already in the list (e.g. realtime echo of our own optimistic
        // ask, or a duplicate event). The asker also receives the event
        // for their own row — we don't drop it; we just dedupe by id.
        if (state.questions.some(x => x.id === q.id)) return;
        // Replace any pending optimistic row from the same asker with the
        // same text — happens when the asker is the local user.
        const fresh = questionFromRow(q);
        const pendingIdx = state.questions.findIndex(
          x => x._pending && x.askerId === fresh.askerId && x.question === fresh.question && x.targetUserId === fresh.targetUserId
        );
        if (pendingIdx !== -1) {
          const next = [...state.questions];
          next[pendingIdx] = fresh;
          store.setState({ questions: next });
        } else {
          store.setState({ questions: [fresh, ...state.questions] });
        }
        // Repaint the wall (notification dot) + notifications/profile if
        // visible.
        const route = router.getCurrentRoute();
        if (route === 'wall' || route === 'notifications' || route === 'profile' || route === 'profile-other') {
          router.refreshCurrentRoute();
        }
      })
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'questions' },
      (payload) => {
        const q = payload.new;
        if (!q) return;
        const state = store.getState();
        const idx = state.questions.findIndex(x => x.id === q.id);
        if (idx === -1) {
          // The asker's local copy might be missing if RLS only just
          // started letting them see this row (answered ⇒ public). Just
          // append.
          store.setState({ questions: [questionFromRow(q), ...state.questions] });
        } else {
          const next = [...state.questions];
          next[idx] = questionFromRow(q);
          store.setState({ questions: next });
        }
        const route = router.getCurrentRoute();
        if (route === 'profile' || route === 'profile-other' || route === 'notifications') {
          router.refreshCurrentRoute();
        }
      })
    // NOTE (jun-2026 security hardening): party_attendees was REMOVED
    // from the supabase_realtime publication (migration 0025). The old
    // INSERT/DELETE listeners here broadcast "who just confirmed going
    // to which party" — venue + date + time — live to EVERY connected
    // client, a stalking vector for a nightlife app. Attendance still
    // hydrates on boot via listAttendees() and the user's own toggles
    // update local state optimistically; others' changes now appear on
    // the next hydration instead of in realtime. Do not re-add these
    // listeners without a per-party, relationship-scoped channel.
    .subscribe();

  return () => unsubscribeRealtime();
}

export function unsubscribeRealtime() {
  if (!_realtimeChannel) return;
  supabase.removeChannel(_realtimeChannel);
  _realtimeChannel = null;
}

// =====================================================================
// REALTIME PRIVADO — canal 'conversations-feed' (mensajería 0038)
// =====================================================================
// SEPARADO de 'public-feed' A PROPÓSITO: ese canal es la manguera pública
// sin filtro y los mensajes privados jamás deben viajar por él (mismo
// precedente de privacidad por el que party_attendees salió de la
// publicación — ver la nota de arriba). Aquí WALRUS evalúa la policy de
// SELECT de conversation_messages POR SUSCRIPTOR, así que cada cliente
// solo recibe mensajes de conversaciones donde es miembro.
//
// El handler NO pinta hilos: actualiza la METADATA del inbox en el store
// (lastMessage/orden/unread) — el hilo abierto tiene su propio canal
// filtrado (subscribeConversation) y su buffer page-scoped, como chat.js.
// =====================================================================
let _convFeedChannel = null;
// Warn de CHANNEL_ERROR transitorio UNA sola vez por caída (el rejoin
// automático de supabase-js dispara el callback en cada reintento y sin
// flag la consola se llenaría en bucle). Se rearma al re-suscribir.
let _convFeedWarned = false;
// Coalescing de getConversation() por hilo: dos INSERTs seguidos de una
// conversación que aún no está en el store (el clásico "hola" + pregunta
// de un primer DM) dispararían dos fetches paralelos — y dos prepends.
const _convFetchInflight = new Map();

export function subscribeConversationsFeed(store) {
  if (!isSupabaseConfigured()) return () => {};
  if (_convFeedChannel) {
    // Ya suscrito; idempotencia barata (igual que subscribeRealtime).
    return () => unsubscribeConversationsFeed();
  }

  _convFeedChannel = supabase
    .channel('conversations-feed')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'conversation_messages' },
      async (payload) => {
        const row = payload.new;
        if (!row) return;
        const msg = convMessageFromRow(row);
        const state = store.getState();
        const meId = state.currentUser?.id;

        // Conversación que aún no está en el store (p.ej. el primer DM
        // que alguien me abre): re-fetch de esa única cabecera. Si RLS no
        // me la muestra (carrera rara), la próxima hidratación la trae.
        let conv = (state.conversations || []).find((c) => c.id === msg.conversationId);
        if (!conv) {
          // Un solo fetch en vuelo por conversación: sin esto, dos
          // mensajes rápidos duplicarían la fila en el inbox y la copia
          // extra dejaría un badge imborrable (markConversationRead /
          // touchConversation mutan solo la PRIMERA coincidencia por id).
          let fetching = _convFetchInflight.get(msg.conversationId);
          if (!fetching) {
            fetching = getConversation(msg.conversationId)
              .catch(() => null)
              .finally(() => _convFetchInflight.delete(msg.conversationId));
            _convFetchInflight.set(msg.conversationId, fetching);
          }
          conv = await fetching;
          if (!conv) return;
          // Dedupe por id contra el estado FRESCO tras el await: la
          // hidratación (o el otro handler coalescido) pudo haberla metido
          // mientras tanto — si ya está, NO se prepende otra copia; el
          // touchConversation de abajo actualiza preview/orden/unread
          // sobre la existente. Mismo patrón que _ensureConversationInStore.
          const current = store.getState().conversations || [];
          if (!current.some((c) => c.id === conv.id)) {
            store.setState({ conversations: [conv, ...current] });
          }
        }

        const own = !!meId && msg.userId === meId;
        // El hilo abierto no genera unread: el usuario lo está mirando
        // (su canal por-hilo pinta el mensaje y la página marca leído).
        const active = _activeConversationId === msg.conversationId;
        // touchConversation actualiza preview + reorden y, con unread,
        // marca el hilo y enciende hasUnreadConversations (si no está
        // silenciado). Toda la mutación vive en el store.
        store.touchConversation(msg.conversationId, msg, { unread: !own && !active });

        // Repaint solo en rutas que consumen estas señales (el inbox, el
        // hub y el badge del muro). El hilo abierto se repinta solo.
        const route = router.getCurrentRoute();
        if (route === 'chats-private' || route === 'chat-hub' || route === 'wall') {
          router.refreshCurrentRoute();
        }
      })
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        // Canal arriba: rearma el warn para la próxima caída real.
        _convFeedWarned = false;
        return;
      }
      if (status !== 'CHANNEL_ERROR' || !_convFeedChannel) return;
      // Deploy-before-migrate: si conversation_messages no existe todavía
      // (0038 pendiente) el join del canal falla SIEMPRE; ahí sí se cierra
      // el canal para no reintentar en bucle (la próxima hidratación,
      // post-migración, vuelve a intentarlo). PERO realtime-js también
      // reporta CHANNEL_ERROR por causas transitorias (socket caído,
      // cambio WiFi→datos, heartbeat perdido) — desmontar ahí dejaría el
      // inbox congelado hasta la próxima hidratación, mientras el rejoin
      // automático con backoff lo habría recuperado solo. Solo se desmonta
      // con señal REAL de tabla inexistente: el flag que la hidratación ya
      // derivó de listConversations, o un error del join que nombra la
      // relación.
      const msg = err?.message || String(err || '');
      const migrationPending = store.getState().conversationsUnavailable
        || isMissingTableError({ message: msg })
        || /conversation_messages/i.test(msg);
      if (migrationPending) {
        console.warn('[realtime] conversations-feed no disponible (¿migración 0038 pendiente?)');
        const ch = _convFeedChannel;
        _convFeedChannel = null;
        supabase.removeChannel(ch);
      } else if (!_convFeedWarned) {
        _convFeedWarned = true;
        console.warn('[realtime] conversations-feed CHANNEL_ERROR transitorio — se deja el rejoin automático', err);
      }
    });

  return () => unsubscribeConversationsFeed();
}

export function unsubscribeConversationsFeed() {
  if (!_convFeedChannel) return;
  supabase.removeChannel(_convFeedChannel);
  _convFeedChannel = null;
}

// =====================================================================
// HYDRATION — pull everything for the current user's view on boot
// =====================================================================
export async function hydrateAll() {
  if (!isSupabaseConfigured()) return null;
  const [parties, posts, follows, attendees, profiles] = await Promise.all([
    listParties(),
    listPosts(),
    listFollows(),
    listAttendees(),
    listProfiles(),
  ]);

  // Fold the attendees join into each party's attendees[].
  const byParty = new Map(parties.map(p => [p.id, p]));
  for (const a of attendees) {
    const p = byParty.get(a.party_id);
    if (p) p.attendees.push(a.user_id);
  }

  return { parties, posts, follows, profiles };
}

// =====================================================================
// PROFILES (for users[] in the legacy store)
// =====================================================================
// Cap on the profiles pulled into users[] on boot. These power lookups
// (comment author names, other-profile pages) — not the wall feed, which
// gets authors inline. 500 is plenty for the foreseeable user base; if we
// outgrow it, lookups should move to on-demand single-row fetches.
const PROFILES_LIMIT = 500;

export async function listProfiles() {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, username, role, city, bio, avatar_url, social, membership_tier, points, created_at')
    .order('created_at', { ascending: false })
    .limit(PROFILES_LIMIT);
  if (error) throw error;
  return (data || []).map(p => ({
    id: p.id,
    name: p.name,
    username: p.username?.startsWith('@') ? p.username : `@${p.username}`,
    role: p.role,
    city: p.city,
    bio: p.bio || '',
    avatar: p.avatar_url || null,
    social: p.social || { instagram: '', tiktok: '', twitter: '' },
    points: p.points ?? 0,
    badges: [],
    partiesAttended: [],
    postsToday: 0,
    followers: 0,
    following: 0,
    premium: p.membership_tier && p.membership_tier !== 'general',
    tier: p.membership_tier || 'general',
  }));
}
