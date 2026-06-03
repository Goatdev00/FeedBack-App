// ============================================
// FEEDBACK — Chat Parties (party selector for chats)
// ============================================

import { store, ICONS } from '../data/mock-data.js';
import { router } from '../router.js';
import { sanitize } from '../utils/helpers.js';
import { renderBottomNav } from '../components/nav.js';
import { requireCurrentUser } from '../data/profile-sync.js';

export function renderChatParties(container) {
  if (!requireCurrentUser(container)) return;
  const state = store.getState();

  // Don't clear hasUnreadChatParty here — this page is the chooser, not
  // the chat itself. The flag clears only when the user enters a
  // concrete chat-party room (handled in chat.js).

  const todayStr = new Date().toISOString().split('T')[0];
  const todayParties = state.parties.filter(p => p.date === todayStr);
  const otherParties = state.parties.filter(p => p.date !== todayStr);

  container.innerHTML = `
    <div class="page" id="chat-parties-page">
      <button class="back-btn" id="back-btn">
        ${ICONS.back}
        <span>Chats</span>
      </button>

      <h1 class="page-title">Chat por fiesta</h1>
      <p class="page-subtitle" style="margin-bottom:var(--space-lg);">
        Cada fiesta tiene su propia sala
      </p>

      ${todayParties.length > 0 ? `
        <h3 class="chat-section-title chat-section-live">
          <span class="chat-live-pulse"></span> En vivo hoy
        </h3>
        ${todayParties.map(p => renderPartyRow(p, state)).join('')}
      ` : ''}

      ${otherParties.length > 0 ? `
        <h3 class="chat-section-title">Próximamente</h3>
        ${otherParties.map(p => renderPartyRow(p, state)).join('')}
      ` : ''}

      ${state.parties.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state-icon">🎵</div>
          <h3 class="empty-state-title">No hay fiestas</h3>
          <p class="empty-state-text">Cuando haya eventos su sala de chat aparecerá aquí.</p>
        </div>
      ` : ''}
    </div>

    ${renderBottomNav('')}
  `;

  container.querySelector('#back-btn').addEventListener('click', () => router.navigate('chat-hub'));
  container.querySelectorAll('[data-party-id]').forEach(row => {
    row.addEventListener('click', () => {
      router.navigate('chat-party', { partyId: row.dataset.partyId });
    });
  });
}

function renderPartyRow(party, state) {
  const messages = state.chatRooms?.[`party:${party.id}`] || [];
  const attendees = party.attendees.length;
  // Per-room unread flag — flipped by the realtime listener in api.js
  // when a message lands in this party's room. Cleared in chat.js when
  // the user opens the room directly.
  const hasUnread = !!state.unreadChatRooms?.[party.id];
  // Thumbnail: prefer the actual flyer the creator uploaded, fall back
  // to the gradient + music emoji for events without a flyer. `flyer`
  // may be a data: URL (optimistic, pre-upload) or an http(s) URL once
  // it's stored in Supabase; both render the same in <img>.
  const thumbInner = party.flyer
    ? `<img src="${party.flyer}" alt="" loading="lazy" />`
    : '🎵';
  const thumbClasses = ['chat-party-thumb'];
  if (party.flyer) thumbClasses.push('chat-party-thumb-image');
  if (hasUnread) thumbClasses.push('has-unread');

  return `
    <button class="chat-party-row" data-party-id="${party.id}">
      <div class="${thumbClasses.join(' ')}">
        ${thumbInner}
        ${hasUnread ? '<span class="chat-dot chat-party-dot"></span>' : ''}
      </div>
      <div class="chat-party-info">
        <div class="chat-party-name">${sanitize(party.name)}</div>
        <div class="chat-party-meta">
          <span>📍 ${sanitize(party.venue)}</span>
          <span>·</span>
          <span>${party.startTime}</span>
        </div>
        <div class="chat-party-stats">
          💬 ${messages.length} mensaje${messages.length === 1 ? '' : 's'} · 👥 ${attendees} asistente${attendees === 1 ? '' : 's'}
        </div>
      </div>
      <span class="chat-party-arrow">→</span>
    </button>
  `;
}
