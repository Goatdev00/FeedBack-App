// ============================================
// FEEDBACK — Chat Hub (entry point)
// Two options: global chat or per-party chat.
// ============================================

import { store, ICONS } from '../data/mock-data.js';
import { router } from '../router.js';
import { renderBottomNav } from '../components/nav.js';
import { requireCurrentUser } from '../data/profile-sync.js';

export function renderChatHub(container) {
  if (!requireCurrentUser(container)) return;
  const state = store.getState();
  const user = state.currentUser;

  // Do NOT clear the unread flags here — chat-hub is a chooser, not a
  // read receipt. Each flag clears only when the user enters its own
  // chat room (chat-general for `hasUnreadChatGeneral`, chat-party for
  // `hasUnreadChatParty`). Keeping the dots visible here is the whole
  // point of breaking them down per type.

  // Today's parties count → shown on the per-party card as social proof.
  const todayParties = store.getTodayParties(state.selectedCity);

  container.innerHTML = `
    <div class="page" id="chat-hub-page">
      <button class="back-btn" id="back-btn">
        ${ICONS.back}
        <span>Volver al muro</span>
      </button>

      <h1 class="page-title">Chats en vivo</h1>
      <p class="page-subtitle" style="margin-bottom:var(--space-xl);">
        Conéctate con la escena o únete al chat de una fiesta específica
      </p>

      <button class="chat-option-card chat-option-general" data-route="chat-general">
        <div class="chat-option-icon">🌐</div>
        <div class="chat-option-body">
          <div class="chat-option-title">Chat general</div>
          <p class="chat-option-subtitle">Conversa con toda la escena en tiempo real</p>
        </div>
        ${state.hasUnreadChatGeneral ? `<span class="chat-dot chat-option-dot"></span>` : ''}
        <span class="chat-option-arrow">→</span>
      </button>

      <button class="chat-option-card chat-option-party" data-route="chat-parties">
        <div class="chat-option-icon">🎉</div>
        <div class="chat-option-body">
          <div class="chat-option-title">Chat por fiesta</div>
          <p class="chat-option-subtitle">
            ${todayParties.length > 0
              ? `${todayParties.length} fiesta${todayParties.length === 1 ? '' : 's'} activa${todayParties.length === 1 ? '' : 's'} hoy`
              : 'Únete al chat de un evento'}
          </p>
        </div>
        ${state.hasUnreadChatParty ? `<span class="chat-dot chat-option-dot"></span>` : ''}
        <span class="chat-option-arrow">→</span>
      </button>
    </div>

    ${renderBottomNav('')}
  `;

  container.querySelector('#back-btn').addEventListener('click', () => router.navigate('wall'));
  container.querySelectorAll('.chat-option-card').forEach(card => {
    card.addEventListener('click', () => router.navigate(card.dataset.route));
  });
}
