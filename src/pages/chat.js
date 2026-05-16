// ============================================
// FEEDBACK — Chat Room (reusable for general + per-party)
// Phase 2: localStorage-backed messages, single-tab.
// Phase 4: same UI, swap store calls for Supabase Realtime subscribe/insert.
// ============================================

import { store, ICONS, formatRelative } from '../data/mock-data.js';
import { router } from '../router.js';
import { avatarHTML, roleBadgeClass, roleTitle, sanitize } from '../utils/helpers.js';

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
  const state = store.getState();
  const user = state.currentUser;
  if (!user) { router.navigate('login'); return; }

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

      <div class="chat-messages" id="chat-messages"></div>

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

  let lastRenderedSig = '';

  function paint() {
    const msgs = store.getChatMessages(roomKey);
    // Cheap diffing: avoid rerendering identical lists.
    const sig = msgs.length + ':' + (msgs.at(-1)?.id || '');
    if (sig === lastRenderedSig) return;
    lastRenderedSig = sig;

    const wasNearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;

    messagesEl.innerHTML = msgs.length === 0
      ? `<div class="chat-empty">
           <div class="chat-empty-icon">💬</div>
           <p>Aún nadie ha escrito. ¡Rompe el hielo!</p>
         </div>`
      : msgs.map((m, i) => renderMessage(m, msgs[i - 1], user.id)).join('');

    if (wasNearBottom) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  paint();
  // Subscribe to store changes so other tabs / future realtime updates
  // immediately repaint without manual reload.
  const unsubscribe = store.subscribe(paint);

  // First paint: jump to bottom regardless of scroll position.
  requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    store.sendChatMessage(roomKey, text);
    input.value = '';
    input.focus();
  });

  container.querySelector('#back-btn').addEventListener('click', () => {
    unsubscribe();
    router.navigate(backRoute);
  });
}

function renderMessage(m, prev, currentUserId) {
  const author = store.getUserById(m.userId);
  if (!author) return '';
  const isMine = m.userId === currentUserId;
  // Group consecutive messages from the same author within 5 min: hide
  // the avatar + name on follow-ups so the conversation feels threaded.
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
