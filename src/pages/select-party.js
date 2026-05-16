// ============================================
// FEEDBACK — Party Selector (before posting)
// ============================================

import { store, ICONS } from '../data/mock-data.js';
import { router } from '../router.js';
import { showToast } from '../utils/toast.js';
import { debounce, sanitize } from '../utils/helpers.js';
import { createModal } from '../utils/dom.js';

const SUGGEST_CITIES = ['Bogotá', 'Medellín', 'Cali', 'Barranquilla'];

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
              <p class="empty-state-text">No encontramos fiestas en ${state.selectedCity}. ¿Quieres sugerir una?</p>
            </div>
          `
        }
      </div>

      <!-- Suggest new party -->
      <button class="btn btn-ghost btn-full mt-lg" id="suggest-party" style="border:1px dashed var(--border-medium);">
        ${ICONS.plus}
        <span>Sugerir nueva fiesta</span>
      </button>
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
          📍 ${sanitize(party.venue)} · ${sanitize(party.city)} · ${party.startTime}
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

  // Suggest new
  container.querySelector('#suggest-party').addEventListener('click', () => {
    showSuggestModal(container);
  });
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

function showSuggestModal(container) {
  const overlay = createModal(`
    <div class="modal">
      <div class="modal-handle"></div>
      <div class="modal-title">Sugerir nueva fiesta</div>
      <p style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-lg);">
        🤖 Nuestro sistema revisará si la fiesta ya existe o es duplicada.
      </p>

      <div class="input-group mb-md">
        <label class="input-label">Nombre de la fiesta</label>
        <input type="text" class="input" id="suggest-name" placeholder="Ej: NEXUS Underground" />
      </div>
      <div class="input-group mb-md">
        <label class="input-label">Lugar / Venue</label>
        <input type="text" class="input" id="suggest-venue" placeholder="Ej: Warehouse Club" />
      </div>
      <div class="input-group mb-lg">
        <label class="input-label">Ciudad</label>
        <select class="input" id="suggest-city">
          ${SUGGEST_CITIES.map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>

      <div style="display:flex;gap:var(--space-sm);">
        <button class="btn btn-secondary" id="cancel-suggest" style="flex:1;">Cancelar</button>
        <button class="btn btn-primary" id="submit-suggest" style="flex:1;">Enviar</button>
      </div>
    </div>
  `);

  overlay.querySelector('#cancel-suggest').addEventListener('click', () => overlay.close());

  overlay.querySelector('#submit-suggest').addEventListener('click', () => {
    const name = overlay.querySelector('#suggest-name').value.trim();
    const venue = overlay.querySelector('#suggest-venue').value.trim();
    const city = overlay.querySelector('#suggest-city').value;

    if (!name) { showToast('Escribe el nombre de la fiesta', 'error'); return; }
    if (!venue) { showToast('Escribe el lugar', 'error'); return; }

    const duplicate = store.detectDuplicate(name);
    if (duplicate) {
      showToast(`⚠️ Ya existe una fiesta similar: "${duplicate.name}"`, 'warning');
      return;
    }

    store.addParty({
      name,
      venue,
      city,
      date: new Date().toISOString().split('T')[0],
      startTime: '22:00',
      endTime: '06:00',
      genres: [],
      promotor: null,
      djs: [],
      flyer: null,
      description: '',
    });

    overlay.close();
    showToast('Fiesta sugerida con éxito ✅', 'success');
    renderSelectParty(container);
  });
}
