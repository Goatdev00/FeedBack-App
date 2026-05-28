// ============================================
// FEEDBACK — Chat Room (reusable for general + per-party)
// Phase 3: Supabase chat_messages + Realtime broadcast. Every message
// goes to public.chat_messages and arrives on every other connected
// client within ~200ms via the supabase_realtime publication.
// ============================================

import { store, ICONS, formatRelative, describeApiError } from '../data/mock-data.js';
import { router } from '../router.js';
import { avatarHTML, roleBadgeClass, roleTitle, sanitize } from '../utils/helpers.js';
import {
  listChatMessages,
  sendChatMessageDB,
  subscribeChatRoom,
  resolveChatRoomId,
} from '../data/api.js';
import { supabase } from '../data/supabase.js';
import { requireCurrentUser } from '../data/profile-sync.js';
import { showToast } from '../utils/toast.js';

const GENERAL_ROOM_KEY = 'general';

export function renderChatGeneral(container) {
  return renderChatRoom(container, {
    roomKey: GENERAL_ROOM_KEY,
    title: 'Chat general',
    subtitle: 'Toda la escena en tiempo real',
    backRoute: 'chat-hub',
  });
}

export function renderChatParty(container, params = {}) {
  const state = store.getState();
  const partyId = params.partyId || state.viewingPartyId;
  const party = store.getPartyById(partyId);
  if (!party) { router.navigate('chat-parties'); return; }

  return renderChatRoom(container, {
    roomKey: `party:${partyId}`,
    title: party.name,
    subtitle: `${party.venue} · ${party.city}`,
    backRoute: 'chat-parties',
  });
}

function renderChatRoom(container, { roomKey, title, subtitle, backRoute }) {
  if (!requireCurrentUser(container)) return;
  const state = store.getState();
  const user = state.currentUser;

  // Entering a live room — user is now seeing chat activity directly, so
  // the wall's unread dot should reset.
  if (state.hasUnreadChat) store.setState({ hasUnreadChat: false });

  container.innerHTML = `
    <div class="page chat-page" id="chat-room-page">
      <div class="chat-header">
        <button class="chat-back" id="back-btn" aria-label="Volver">${ICONS.back}</button>
        <div class="chat-header-info">
          <div class="chat-header-title">${sanitize(title)}</div>
          <div class="chat-header-subtitle">${sanitize(subtitle)}</div>
        </div>
        <span class="chat-live-indicator" title="En vivo">●</span>
      </div>

      <div class="chat-messages" id="chat-messages">
        <div class="chat-empty"><div class="chat-empty-icon">💬</div><p>Cargando mensajes...</p></div>
      </div>

      <form class="chat-input-row" id="chat-form">
        <input type="text" class="chat-input" id="chat-input"
               placeholder="Escribe un mensaje..." maxlength="500"
               autocomplete="off" />
        <button type="submit" class="chat-send" aria-label="Enviar">
          ${ICONS.send}
        </button>
      </form>
    </div>
  `;

  const messagesEl = container.querySelector('#chat-messages');
  const form = container.querySelector('#chat-form');
  const input = container.querySelector('#chat-input');

  // ====== Local in-memory message buffer (this page only) ======
  // We don't push chat into the global store because (a) the volume can
  // grow large and (b) the chat is page-scoped. State here:
  //
  //   messages           — array of {id, userId, content, createdAt, ...}
  //   pendingByContent   — set of contents currently flying to the server,
  //                        used to dedupe the realtime echo from the user's
  //                        own insert.
  //   userCache          — id → user lookup for foreign authors we haven't
  //                        seen in state.users yet (fills lazily).
  let messages = [];
  const pendingByContent = new Map(); // contentKey → tempId
  const userCache = new Map();

  let lastRenderedSig = '';
  function paint() {
    const sig = messages.length + ':' + (messages.at(-1)?.id || '');
    if (sig === lastRenderedSig) return;
    lastRenderedSig = sig;

    const wasNearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;

    messagesEl.innerHTML = messages.length === 0
      ? `<div class="chat-empty">
           <div class="chat-empty-icon">💬</div>
           <p>Aún nadie ha escrito. ¡Rompe el hielo!</p>
         </div>`
      : messages.map((m, i) => renderMessage(m, messages[i - 1], user.id, userCache)).join('');

    if (wasNearBottom) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  // ====== Hydrate history from Supabase + subscribe to new inserts ======
  let unsubscribeRealtime = () => {};
  let roomMissing = false;

  (async () => {
    // Pre-flight: confirm the chat_room exists in Supabase. If not, the
    // most likely cause is migration 0009 not applied yet (no global
    // room with party_id IS NULL). Show a clear inline error instead of
    // letting the user type into a black hole.
    const roomId = await resolveChatRoomId(roomKey);
    if (!roomId) {
      roomMissing = true;
      messagesEl.innerHTML = `
        <div class="chat-empty">
          <div class="chat-empty-icon">⚠️</div>
          <p style="color:var(--orange);font-weight:600;">No se pudo conectar al chat.</p>
          <p style="font-size:var(--text-xs);color:var(--text-tertiary);margin-top:8px;">
            La sala no existe en el servidor. Verifica que las migraciones
            <code>0008</code> y <code>0009</code> estén aplicadas en Supabase.
          </p>
        </div>
      `;
      // Disable input so the user doesn't keep trying.
      input.disabled = true;
      input.placeholder = 'Chat no disponible';
      return;
    }

    try {
      messages = await listChatMessages(roomKey);
    } catch (err) {
      console.warn('[chat] history fetch failed', err);
      messages = [];
    }
    // Fetch any missing author profiles in one batch so renderMessage
    // doesn't render empty bubbles for users not in state.users yet.
    await fillUserCache(messages, userCache);
    paint();
    requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
  })();

  unsubscribeRealtime = subscribeChatRoom(roomKey, async (msg) => {
    // Drop the realtime echo of our own optimistic insert.
    const key = optimisticKey(msg);
    if (pendingByContent.has(key)) {
      const tempId = pendingByContent.get(key);
      // Replace the optimistic row with the canonical server row.
      const idx = messages.findIndex(m => m.id === tempId);
      if (idx !== -1) messages[idx] = msg;
      pendingByContent.delete(key);
    } else {
      // Foreign message — append unless we already have it.
      if (!messages.some(m => m.id === msg.id)) {
        messages.push(msg);
      }
    }
    if (!userCache.has(msg.userId) && !store.getUserById(msg.userId)) {
      await fetchUserInto(msg.userId, userCache);
    }
    paint();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (roomMissing) {
      showToast('Chat no disponible. Aplica migration 0009.', 'error', 5000);
      return;
    }
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.focus();

    // Optimistic local insert: show the message immediately, dedupe the
    // realtime echo by content+timestamp.
    const tempId = 'pending_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const optimistic = {
      id: tempId,
      userId: user.id,
      content: text,
      authorTier: user.tier || 'general',
      authorRole: user.role || 'raver',
      isHost: false,
      createdAt: new Date(),
      _pending: true,
    };
    messages.push(optimistic);
    pendingByContent.set(optimisticKey(optimistic), tempId);
    paint();

    try {
      const real = await sendChatMessageDB(roomKey, text);
      if (real) {
        const idx = messages.findIndex(m => m.id === tempId);
        if (idx !== -1) messages[idx] = real;
        pendingByContent.delete(optimisticKey(optimistic));
        paint();
      }
    } catch (err) {
      console.error('[chat] send failed', {
        code: err?.code, message: err?.message,
        details: err?.details, hint: err?.hint, raw: err,
        roomKey,
      });
      // Keep the message visible, mark it as failed-to-sync. The user
      // can still read what they typed; the toast tells them WHY it
      // didn't reach the server using the same describeApiError used
      // by posts / comments / likes.
      const m = messages.find(x => x.id === tempId);
      if (m) {
        m._pending = false;
        m._syncFailed = true;
      }
      pendingByContent.delete(optimisticKey(optimistic));
      paint();

      // Special-case: the message bubbled up as 'room_not_found' from
      // resolveChatRoomId — that's almost always migration 0009 missing.
      // For anything else, surface the real Supabase error code/message.
      const reason = err?.message === 'room_not_found'
        ? 'Sala de chat no creada en el servidor (aplica migration 0009).'
        : describeApiError(err);
      showToast('No se envió: ' + reason, 'error', 5000);
    }
  });

  container.querySelector('#back-btn').addEventListener('click', () => {
    unsubscribeRealtime();
    router.navigate(backRoute);
  });
}

function optimisticKey(msg) {
  // userId+content is enough to dedupe within a small time window — we
  // delete the entry as soon as the server echo lands so collisions are
  // virtually impossible.
  return `${msg.userId}::${msg.content}`;
}

async function fillUserCache(messages, cache) {
  const missing = new Set();
  for (const m of messages) {
    if (!cache.has(m.userId) && !store.getUserById(m.userId)) missing.add(m.userId);
  }
  if (missing.size === 0) return;
  const { data } = await supabase
    .from('profiles')
    .select('id, name, username, role, avatar_url, membership_tier')
    .in('id', Array.from(missing));
  for (const p of data || []) {
    cache.set(p.id, profileRowToUserShape(p));
  }
}

async function fetchUserInto(userId, cache) {
  const { data } = await supabase
    .from('profiles')
    .select('id, name, username, role, avatar_url, membership_tier')
    .eq('id', userId)
    .maybeSingle();
  if (data) cache.set(userId, profileRowToUserShape(data));
}

function profileRowToUserShape(p) {
  return {
    id: p.id,
    name: p.name,
    username: p.username?.startsWith('@') ? p.username : `@${p.username}`,
    role: p.role,
    avatar: p.avatar_url || null,
    premium: p.membership_tier && p.membership_tier !== 'general',
  };
}

function renderMessage(m, prev, currentUserId, userCache) {
  const author = store.getUserById(m.userId) || userCache.get(m.userId);
  if (!author) return '';
  const isMine = m.userId === currentUserId;
  const sameAsPrev = prev
    && prev.userId === m.userId
    && (m.createdAt.getTime() - prev.createdAt.getTime()) < 5 * 60_000;

  return `
    <div class="chat-msg ${isMine ? 'chat-msg-mine' : ''} ${sameAsPrev ? 'chat-msg-stacked' : ''}">
      ${sameAsPrev ? '<div class="chat-msg-avatar-slot"></div>' : avatarHTML(author, 'avatar-sm chat-msg-avatar-slot')}
      <div class="chat-msg-body">
        ${sameAsPrev ? '' : `
          <div class="chat-msg-meta">
            <span class="chat-msg-author">${sanitize(author.name)}</span>
            <span class="badge ${roleBadgeClass(author.role)} chat-msg-role">${roleTitle(author.role)}</span>
            <span class="chat-msg-time">${formatRelative(m.createdAt)}</span>
          </div>
        `}
        <div class="chat-msg-bubble">${sanitize(m.content)}</div>
      </div>
    </div>
  `;
}
