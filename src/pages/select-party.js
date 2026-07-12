// ============================================
// FEEDBACK — Party Selector (before posting)
// ============================================
// Dos modos, según la pestaña del muro desde la que se llega:
//   * fiestas (default): igual que siempre — el post DEBE ir vinculado a
//     una fiesta (kind !== 'remate'; los remates no aparecen aquí).
//   * remates (params.feed === 'remates'): lista SOLO remates, con una
//     opción fija "Publicar sin evento" (post libre, partyId null) y un
//     acceso a crear remate.
// El modo llega por params y el param EXPLÍCITO siempre manda (create-post
// pasa feed en ambas direcciones — Cambiar/Volver incluidos — porque el
// flujo pudo originarse fuera del muro, p.ej. "Publicar aquí" desde la
// agenda de fiestas con la pestaña Remates activa). Solo si el param se
// pierde (reload / back-forward, el hash no lleva ?feed) se cae al
// fallback de store.wallTab.

import { store, ICONS } from '../data/mock-data.js';
import { router } from '../router.js';
import { debounce, sanitize, safeImageSrc } from '../utils/helpers.js';

export function renderSelectParty(container, params = {}) {
  const state = store.getState();
  const isRemates = (params.feed || (state.wallTab === 'remates' ? 'remates' : 'fiestas')) === 'remates';
  // suggestPartyForPost devuelve TODO lo no-finalizado: cada modo filtra
  // por kind para que fiestas y remates nunca se mezclen en el selector.
  const byMode = (list) => (list || []).filter(p => ((p.kind || 'party') === 'remate') === isRemates);
  const parties = byMode(store.suggestPartyForPost());

  container.innerHTML = `
    <div class="page" id="select-party-page">
      <button class="back-btn" id="back-btn">
        ${ICONS.back}
        <span>Volver al muro</span>
      </button>

      <h1 class="page-title" style="margin-bottom:var(--space-xs);">${isRemates ? '¿En qué remate estás?' : '¿A qué fiesta asististe?'}</h1>
      <p class="page-subtitle" style="margin-bottom:var(--space-lg);">
        ${isRemates
          ? 'Vincula tu publicación a un remate, o publica libre en el muro de remates.'
          : 'Selecciona la fiesta antes de publicar. Todas las publicaciones están vinculadas a un evento.'}
      </p>

      <!-- Search -->
      <div class="search-bar">
        ${ICONS.search}
        <input type="text" id="party-search" placeholder="${isRemates ? 'Buscar remate...' : 'Buscar fiesta...'}" autocomplete="off" />
      </div>

      ${isRemates ? `
        <!-- Opción fija: post libre (sin evento). Vive FUERA de #party-list
             para que la búsqueda no la borre al re-renderizar la lista. -->
        <div class="party-selector-item" id="free-remate-option" style="border:1px dashed var(--border-orange);margin-bottom:var(--space-sm);">
          <div class="party-selector-thumb" style="display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🔥</div>
          <div class="party-selector-info">
            <div class="party-selector-name">Publicar sin evento</div>
            <div class="party-selector-detail">Tu publicación va al muro de remates, sin vincularla a uno</div>
          </div>
        </div>
        <button class="btn btn-outline btn-sm" id="create-remate-btn" style="width:100%;margin-bottom:var(--space-md);">
          ${ICONS.plus} Crear remate
        </button>
      ` : ''}

      <!-- AI suggestion label -->
      <div style="display:flex;align-items:center;gap:var(--space-sm);margin-bottom:var(--space-md);">
        <span style="font-size:var(--text-xs);color:var(--text-tertiary);">${isRemates ? `Remates activos en ${state.selectedCity}` : `Fiestas sugeridas para hoy en ${state.selectedCity}`}</span>
      </div>

      <!-- Party list -->
      <div class="party-selector-list" id="party-list">
        ${parties.length > 0
          ? parties.map(p => renderPartyOption(p)).join('')
          : `
            <div class="empty-state" style="padding:var(--space-xl);">
              <div style="font-size:2rem;margin-bottom:var(--space-sm);">${isRemates ? '🔥' : '🎵'}</div>
              <h3 class="empty-state-title">${isRemates ? 'No hay remates activos' : 'No hay fiestas hoy'}</h3>
              <p class="empty-state-text">${isRemates
                ? `No encontramos remates en ${state.selectedCity}. Publica sin evento o crea el primero.`
                : `No encontramos fiestas activas en ${state.selectedCity}.`}</p>
            </div>
          `
        }
      </div>
    </div>
  `;

  bindSelectPartyEvents(container, isRemates, byMode);
}

function renderPartyOption(party) {
  const flyer = safeImageSrc(party.flyer);
  // Show the flyer as the thumbnail; fall back to the music-note tile when
  // the party has no flyer (.party-selector-thumb already sets 48px, radius,
  // object-fit:cover + a brand-gradient background for the empty case).
  const thumb = flyer
    ? `<img class="party-selector-thumb" src="${flyer}" alt="" />`
    : `<div class="party-selector-thumb" style="display:flex;align-items:center;justify-content:center;font-size:1.2rem;">${party.kind === 'remate' ? '🔥' : '🎵'}</div>`;
  return `
    <div class="party-selector-item" data-party-id="${party.id}">
      ${thumb}
      <div class="party-selector-info">
        <div class="party-selector-name">
          ${sanitize(party.name)}
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

function bindSelectPartyEvents(container, isRemates, byMode) {
  // Back
  container.querySelector('#back-btn').addEventListener('click', () => {
    router.navigate('wall');
  });

  // Post libre (solo remates): create-post sin partyId, con el feed
  // explícito para que no rebote a este selector.
  container.querySelector('#free-remate-option')?.addEventListener('click', () => {
    store.setState({ viewingPartyId: null });
    router.navigate('create-post', { feed: 'remates' });
  });

  // Crear remate: abierto a cualquier usuario (sin gate de promotor).
  container.querySelector('#create-remate-btn')?.addEventListener('click', () => {
    router.navigate('create-party', { kind: 'remate' });
  });

  // Search — los resultados respetan el filtro del modo (searchParties
  // busca sobre TODAS las parties).
  const searchInput = container.querySelector('#party-search');
  searchInput.addEventListener('input', debounce((e) => {
    const query = e.target.value.trim();
    const results = byMode(query ? store.searchParties(query) : store.suggestPartyForPost());
    const list = container.querySelector('#party-list');
    list.innerHTML = results.length > 0
      ? results.map(p => renderPartyOption(p)).join('')
      : `<div style="text-align:center;padding:var(--space-xl);color:var(--text-tertiary);font-size:var(--text-sm);">No se encontraron ${isRemates ? 'remates' : 'fiestas'} para "${sanitize(query)}"</div>`;
    rebindPartyClicks(container, isRemates);
  }, 200));

  // Party selection
  rebindPartyClicks(container, isRemates);
}

function rebindPartyClicks(container, isRemates) {
  container.querySelectorAll('.party-selector-item[data-party-id]').forEach(item => {
    item.addEventListener('click', () => {
      const partyId = item.dataset.partyId;
      container.querySelectorAll('.party-selector-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');

      // Navigate to create post with selected party
      setTimeout(() => {
        store.setState({ viewingPartyId: partyId });
        router.navigate('create-post', isRemates ? { partyId, feed: 'remates' } : { partyId });
      }, 200);
    });
  });
}
