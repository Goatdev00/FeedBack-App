// ============================================
// FEEDBACK — Party Selector (before posting)
// ============================================

import { store, ICONS } from '../data/mock-data.js';
import { router } from '../router.js';
import { debounce, sanitize } from '../utils/helpers.js';

export function renderSelectParty(container) {
  const state = store.getState();
  const parties = store.suggestPartyForPost();

  container.innerHTML = `
    <div class="page" id="select-party-page">
      <button class="back-btn" id="back-btn">
        ${ICONS.back}
        <span>Volver al muro</span>
      </button>

      <h1 class="page-title" style="margin-bottom:var(--space-xs);">¿A qué fiesta asististe?</h1>
      <p class="page-subtitle" style="margin-bottom:var(--space-lg);">
        Selecciona la fiesta antes de publicar. Todas las publicaciones están vinculadas a un evento.
      </p>

      <!-- Search -->
      <div class="search-bar">
        ${ICONS.search}
        <input type="text" id="party-search" placeholder="Buscar fiesta..." autocomplete="off" />
      </div>

      <!-- AI suggestion label -->
      <div style="display:flex;align-items:center;gap:var(--space-sm);margin-bottom:var(--space-md);">
        <span style="font-size:var(--text-xs);color:var(--text-tertiary);">🤖 Fiestas sugeridas para hoy en ${state.selectedCity}</span>
      </div>

      <!-- Party list -->
      <div class="party-selector-list" id="party-list">
        ${parties.length > 0
          ? parties.map(p => renderPartyOption(p)).join('')
          : `
            <div class="empty-state" style="padding:var(--space-xl);">
              <div style="font-size:2rem;margin-bottom:var(--space-sm);">🎵</div>
              <h3 class="empty-state-title">No hay fiestas hoy</h3>
              <p class="empty-state-text">No encontramos fiestas activas en ${state.selectedCity}.</p>
            </div>
          `
        }
      </div>
    </div>
  `;

  bindSelectPartyEvents(container);
}

function renderPartyOption(party) {
  return `
    <div class="party-selector-item" data-party-id="${party.id}">
      <div class="party-selector-thumb" style="display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🎵</div>
      <div class="party-selector-info">
        <div class="party-selector-name">
          ${party.sponsored ? '⭐ ' : ''}${sanitize(party.name)}
        </div>
        <div class="party-selector-detail">
          📍 ${sanitize(party.venue)} · ${sanitize(party.city)} · ${sanitize(party.startTime)}
        </div>
        <div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap;">
          ${party.genres.map(g => `<span class="tag" style="padding:2px 8px;font-size:0.5625rem;">${sanitize(g)}</span>`).join('')}
        </div>
      </div>
    </div>
  `;
}

function bindSelectPartyEvents(container) {
  // Back
  container.querySelector('#back-btn').addEventListener('click', () => {
    router.navigate('wall');
  });

  // Search
  const searchInput = container.querySelector('#party-search');
  searchInput.addEventListener('input', debounce((e) => {
    const query = e.target.value.trim();
    const results = query ? store.searchParties(query) : store.suggestPartyForPost();
    const list = container.querySelector('#party-list');
    list.innerHTML = results.length > 0
      ? results.map(p => renderPartyOption(p)).join('')
      : `<div style="text-align:center;padding:var(--space-xl);color:var(--text-tertiary);font-size:var(--text-sm);">No se encontraron fiestas para "${query}"</div>`;
    rebindPartyClicks(container);
  }, 200));

  // Party selection
  rebindPartyClicks(container);
}

function rebindPartyClicks(container) {
  container.querySelectorAll('.party-selector-item').forEach(item => {
    item.addEventListener('click', () => {
      const partyId = item.dataset.partyId;
      container.querySelectorAll('.party-selector-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');

      // Navigate to create post with selected party
      setTimeout(() => {
        store.setState({ viewingPartyId: partyId });
        router.navigate('create-post', { partyId });
      }, 200);
    });
  });
}
