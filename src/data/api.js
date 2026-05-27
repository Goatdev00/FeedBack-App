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
    .select('party_id, user_id');
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
  return data.id;
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
  patchProfileTheme,
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
          return;
        }

        // Foreign new post → prepend + make sure the author is in state.users
        // so wall.js can render their name (otherwise it filters silently).
        const next = { posts: [fresh, ...state.posts] };
        if (fresh.author && !state.users.some(u => u.id === fresh.author.id)) {
          next.users = [fresh.author, ...state.users];
        }
        store.setState(next);
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
        if (state.parties.some(x => x.id === p.id)) return;
        store.setState({ parties: [partyFromRow(p), ...state.parties] });
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
export async function listProfiles() {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, username, role, city, bio, avatar_url, social, membership_tier, points, created_at')
    .order('created_at', { ascending: false });
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
