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

// =====================================================================
// PARTIES
// =====================================================================
export async function listParties() {
  if (!isSupabaseConfigured()) return [];
  // After migration 0009 there is no synthetic global-chat party to
  // filter out — the global chat lives on a chat_rooms row with
  // party_id IS NULL.
  const { data, error } = await supabase
    .from('parties')
    .select('*')
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
  const { data, error } = await supabase.from('parties').insert(row).select('*').single();
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

export async function listPosts() {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase
    .from('posts')
    .select(`
      id, user_id, party_id, content, image_url, type, created_at, expires_at,
      hidden_at, hidden_reason,
      author:profiles!posts_user_id_fkey(id, name, username, role, city, avatar_url, membership_tier, points),
      post_likes(user_id),
      post_comments(id, user_id, content, created_at)
    `)
    .order('created_at', { ascending: false })
    .limit(POSTS_INITIAL_LIMIT);
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
    }))
    .sort((a, b) => a.createdAt - b.createdAt);

  return {
    id: p.id,
    userId: p.user_id,
    partyId: p.party_id,
    content: p.content,
    image: p.image_url,
    type: p.type,
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

export async function createPost({ partyId, content, image }) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('not_authenticated');
  const { data, error } = await supabase
    .from('posts')
    .insert({
      user_id: user.id,
      party_id: partyId,
      content,
      image_url: image || null,
      type: image ? 'photo' : 'text',
    })
    .select(`
      id, user_id, party_id, content, image_url, type, created_at, expires_at,
      author:profiles!posts_user_id_fkey(id, name, username, role, city, avatar_url, membership_tier, points)
    `)
    .single();
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

export async function listChatMessages(roomKey, limit = 100) {
  if (!isSupabaseConfigured()) return [];
  const roomId = await resolveChatRoomId(roomKey);
  if (!roomId) return [];
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, room_id, user_id, content, author_tier, author_role, is_host, status, created_at')
    .eq('room_id', roomId)
    .eq('status', 'visible')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(chatMsgFromRow);
}

function chatMsgFromRow(m) {
  return {
    id: m.id,
    userId: m.user_id,
    content: m.content,
    authorTier: m.author_tier,
    authorRole: m.author_role,
    isHost: !!m.is_host,
    createdAt: new Date(m.created_at),
  };
}

export async function sendChatMessageDB(roomKey, content) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const text = (content || '').trim();
  if (!text) return null;
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('not_authenticated');
  const roomId = await resolveChatRoomId(roomKey);
  if (!roomId) throw new Error('room_not_found');

  // author_tier / author_role / is_host are snapshotted by the
  // snapshot_message_meta() BEFORE INSERT trigger — we only send the
  // raw content + ids.
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ room_id: roomId, user_id: user.id, content: text })
    .select('id, room_id, user_id, content, author_tier, author_role, is_host, status, created_at')
    .single();
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
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(questionFromRow);
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
        const { data, error } = await supabase
          .from('posts')
          .select(`
            id, user_id, party_id, content, image_url, type, created_at, expires_at,
            author:profiles!posts_user_id_fkey(id, name, username, role, city, avatar_url, membership_tier, points)
          `)
          .eq('id', id)
          .single();
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
    // Party attendance: someone confirmed they're going (INSERT) or
    // cancelled (DELETE). Folded into BOTH party.attendees[] (cheap
    // lookups) and state.attendanceLog (timestamped feed used by the
    // promoter's notification derivation). Skip the echo of OUR own
    // insert since toggleAttendance already updated local state
    // optimistically — without the skip we'd push the same uid twice.
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'party_attendees' },
      (payload) => {
        const a = payload.new;
        if (!a) return;
        const state = store.getState();
        if (state.currentUser && a.user_id === state.currentUser.id) return;

        const parties = state.parties.map(p => {
          if (p.id !== a.party_id) return p;
          if (p.attendees.includes(a.user_id)) return p;
          return { ...p, attendees: [...p.attendees, a.user_id] };
        });
        const logKey = `${a.party_id}:${a.user_id}`;
        const log = (state.attendanceLog || []).some(x => `${x.partyId}:${x.userId}` === logKey)
          ? state.attendanceLog
          : [{ partyId: a.party_id, userId: a.user_id, attendedAt: new Date(a.attended_at) },
             ...(state.attendanceLog || [])];
        store.setState({ parties, attendanceLog: log });

        const route = router.getCurrentRoute();
        if (route === 'wall' || route === 'parties' || route === 'party-detail'
            || route === 'notifications') {
          router.refreshCurrentRoute();
        }
      })
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'party_attendees' },
      (payload) => {
        const a = payload.old;
        if (!a) return;
        const state = store.getState();
        if (state.currentUser && a.user_id === state.currentUser.id) return;

        const parties = state.parties.map(p => {
          if (p.id !== a.party_id) return p;
          return { ...p, attendees: p.attendees.filter(u => u !== a.user_id) };
        });
        const log = (state.attendanceLog || []).filter(
          x => !(x.partyId === a.party_id && x.userId === a.user_id)
        );
        store.setState({ parties, attendanceLog: log });

        const route = router.getCurrentRoute();
        if (route === 'parties' || route === 'party-detail' || route === 'notifications') {
          router.refreshCurrentRoute();
        }
      })
    .subscribe();

  return () => unsubscribeRealtime();
}

export function unsubscribeRealtime() {
  if (!_realtimeChannel) return;
  supabase.removeChannel(_realtimeChannel);
  _realtimeChannel = null;
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
