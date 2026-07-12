// ============================================
// FEEDBACK — Parties Page
// ============================================

import { store, ICONS, isSunday } from '../data/mock-data.js';
import { router } from '../router.js';
import { showToast } from '../utils/toast.js';
import { avatarHTML, debounce, sanitize, safeImageSrc, bogotaTodayStr } from '../utils/helpers.js';
import { hashStr } from '../utils/dom.js';
import { renderBottomNav, bindNavEvents } from '../components/nav.js';

const CITIES = ['Todas', 'Bogotá', 'Medellín', 'Cali', 'Barranquilla'];

// Divider between current and archived-but-visible content.
function sectionSeparator(label) {
  return `
    <div style="display:flex;align-items:center;gap:var(--space-sm);margin:var(--space-lg) 0 var(--space-md);">
      <span style="flex:1;height:1px;background:var(--border-subtle);"></span>
      <span style="font-size:var(--text-xs);color:var(--text-tertiary);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${label}</span>
      <span style="flex:1;height:1px;background:var(--border-subtle);"></span>
    </div>
  `;
}

// La agenda de fiestas NO muestra remates: viven en su pestaña del muro.
// Filas pre-0037 sin kind cuentan como fiesta.
const isFiesta = (p) => (p.kind || 'party') !== 'remate';

export function renderParties(container) {
  const state = store.getState();
  const user = state.currentUser;
  const selectedCity = state.selectedCity || 'Bogotá';
  const parties = (selectedCity === 'Todas'
    ? store.getRecommendedParties(user?.id)
    : store.getPartiesByCity(selectedCity)
  ).filter(isFiesta);

  const todayStr = bogotaTodayStr();
  const todayParties = parties.filter(p => p.date === todayStr);
  const upcomingParties = parties.filter(p => p.date > todayStr);
  const pastParties = parties.filter(p => p.date < todayStr);

  container.innerHTML = `
    <div class="page" id="parties-page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Fiestas</h1>
          <p class="page-subtitle">Descubre lo que hay hoy</p>
        </div>
        ${user?.role === 'promotor' ? `
          <button class="btn btn-primary btn-sm btn-shine" id="create-party-btn">
            ${ICONS.plus} Crear
          </button>
        ` : ''}
      </div>

      <!-- City filter pills -->
      <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:var(--space-sm);margin-bottom:var(--space-md);-webkit-overflow-scrolling:touch;">
        ${CITIES.map(city => `
          <button class="tag ${selectedCity === city ? 'active' : ''}" data-city="${city}">${city}</button>
        `).join('')}
      </div>

      <!-- Search -->
      <div class="search-bar">
        ${ICONS.search}
        <input type="text" id="party-search" placeholder="Buscar fiesta, venue, género..." autocomplete="off" />
        <button class="btn-icon" style="color:var(--text-muted);">${ICONS.filter}</button>
      </div>

      ${isSunday ? renderSundayBanner() : ''}

      <!-- Today's parties -->
      <div id="parties-list">
        ${todayParties.length > 0 ? `
          <h3 style="font-size:var(--text-sm);font-weight:600;color:var(--orange);margin-bottom:var(--space-md);display:flex;align-items:center;gap:var(--space-sm);">
            <span style="width:8px;height:8px;background:var(--orange);border-radius:50%;animation:pulse 2s infinite;"></span>
            Fiestas de hoy
          </h3>
          ${todayParties.map(p => renderPartyCard(p, state)).join('')}
        ` : ''}

        ${upcomingParties.length > 0 ? `
          <h3 style="font-size:var(--text-sm);font-weight:600;color:var(--text-secondary);margin-top:var(--space-lg);margin-bottom:var(--space-md);">
            Próximamente
          </h3>
          ${upcomingParties.map(p => renderPartyCard(p, state)).join('')}
        ` : ''}

        ${pastParties.length > 0 ? `
          ${sectionSeparator('Publicaciones antiguas')}
          ${pastParties.map(p => renderPartyCard(p, state)).join('')}
        ` : ''}

        ${parties.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">🎵</div>
            <h3 class="empty-state-title">No hay fiestas</h3>
            <p class="empty-state-text">No encontramos eventos en ${sanitize(selectedCity)} por ahora.</p>
            ${user?.role === 'promotor' ? `<button class="btn btn-primary mt-lg" id="empty-create">Crear fiesta</button>` : ''}
          </div>
        ` : ''}
      </div>
    </div>

    ${renderBottomNav('parties')}
  `;

  bindPartiesEvents(container);
}

function renderSundayBanner() {
  return `
    <div class="card" style="background:linear-gradient(135deg, rgba(255,106,0,0.1), rgba(63,10,116,0.1));border-color:var(--border-orange);margin-bottom:var(--space-lg);cursor:pointer;" id="sunday-banner">
      <div style="display:flex;align-items:center;gap:var(--space-md);">
        <span style="font-size:2rem;">🏆</span>
        <div>
          <h3 style="font-family:var(--font-display);font-size:var(--text-base);font-weight:700;color:var(--orange);">¡Puntúa las fiestas!</h3>
          <p style="font-size:var(--text-xs);color:var(--text-secondary);">Es domingo. Califica las fiestas de esta semana y gana puntos.</p>
        </div>
        <span style="font-size:1.2rem;">→</span>
      </div>
    </div>
  `;
}

function renderPartyCard(party, state) {
  const user = state.currentUser;
  const isAttending = !!(user && party.attendees.includes(user.id));
  const promotor = party.promotor ? store.getUserById(party.promotor) : null;
  const djs = party.djs.map(id => store.getUserById(id)).filter(Boolean);
  const avgEnergy = party.reports?.energia || 0;
  const liveBadge = avgEnergy > 80
    ? `<div style="position:absolute;top:12px;right:12px;padding:4px 10px;background:rgba(255,106,0,0.9);border-radius:var(--radius-full);font-size:0.625rem;font-weight:700;color:white;">EN VIVO</div>`
    : '';

  const flyerSrc = safeImageSrc(party.flyer);
  const hero = flyerSrc
    ? `
      <div class="party-flyer-container" style="position:relative;">
        <img src="${flyerSrc}" alt="${sanitize(party.name)}" class="party-flyer" style="width:100%;height:200px;object-fit:cover;" />
        ${liveBadge}
      </div>
    `
    : `
      <div class="party-flyer-placeholder" style="background:linear-gradient(135deg, hsl(${hashStr(party.name) % 360}, 60%, 25%), hsl(${(hashStr(party.name) + 60) % 360}, 50%, 15%));">
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:var(--space-lg);">
          <span style="font-family:var(--font-display);font-size:var(--text-2xl);font-weight:800;color:#fff;text-align:center;text-transform:uppercase;letter-spacing:2px;">${sanitize(party.name)}</span>
          <span style="font-size:var(--text-xs);color:#fff;margin-top:8px;">${sanitize(party.startTime)} — ${sanitize(party.endTime)}</span>
        </div>
        ${liveBadge}
      </div>
    `;

  return `
    <div class="party-card" data-party-id="${party.id}">
      ${party.sponsored ? `
        <div style="padding:6px 12px;background:rgba(255,200,0,0.1);display:flex;align-items:center;gap:6px;">
          <span style="font-size:0.625rem;color:#FFC800;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Evento patrocinado</span>
        </div>
      ` : ''}

      ${hero}

      <div class="party-info">
        <div class="party-name">${sanitize(party.name)}</div>

        <div class="party-meta">
          <span class="party-meta-item">${ICONS.location} ${sanitize(party.venue)}</span>
          <span class="party-meta-item">${ICONS.clock} ${party.startTime}</span>
          <span class="party-meta-item">${ICONS.calendar} ${party.date}</span>
        </div>

        <div class="party-genres">
          ${party.genres.map(g => `<span class="tag" style="padding:3px 8px;font-size:0.5625rem;">${sanitize(g)}</span>`).join('')}
        </div>

        ${promotor ? `
          <div style="display:flex;align-items:center;gap:6px;margin-top:var(--space-sm);font-size:var(--text-xs);color:var(--text-secondary);">
            ✨ Organiza: <strong>${sanitize(promotor.name)}</strong>
          </div>
        ` : ''}

        ${djs.length > 0 ? `
          <div style="display:flex;align-items:center;gap:6px;margin-top:4px;font-size:var(--text-xs);color:var(--text-secondary);">
            🎧 ${djs.map(dj => `<span class="dj-linked">${sanitize(dj.name)}</span>`).join(', ')}
          </div>
        ` : ''}

        <div class="party-attendance">
          <div class="party-attendees">
            ${party.attendees.slice(0, 3).map(uid => {
              const u = store.getUserById(uid);
              return u ? avatarHTML(u, 'avatar-sm') : '';
            }).join('')}
            ${party.attendees.length > 3
              ? `<span class="party-attendee-count">+${party.attendees.length - 3} más</span>`
              : `<span class="party-attendee-count">${party.attendees.length} asistentes</span>`
            }
          </div>
          <button class="btn ${isAttending ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'}"
                  data-action="attend" data-party-id="${party.id}">
            ${isAttending ? '✓ Asistiré' : 'Asistiré'}
          </button>
        </div>
      </div>
    </div>
  `;
}

function bindPartiesEvents(container) {
  // City filter
  container.querySelectorAll('[data-city]').forEach(tag => {
    tag.addEventListener('click', () => {
      store.setState({ selectedCity: tag.dataset.city });
      renderParties(container);
    });
  });

  // Search
  const searchInput = container.querySelector('#party-search');
  searchInput?.addEventListener('input', debounce((e) => {
    const query = e.target.value.trim();
    // Mismo filtro que el render principal: los remates no se cuelan en
    // los resultados de búsqueda de la agenda de fiestas.
    const results = (query ? store.searchParties(query) : store.getPartiesByCity(store.getState().selectedCity)).filter(isFiesta);
    const list = container.querySelector('#parties-list');
    list.innerHTML = results.length > 0
      ? results.map(p => renderPartyCard(p, store.getState())).join('')
      : `<div class="empty-state" style="padding:var(--space-xl);"><h3 class="empty-state-title">Sin resultados</h3><p class="empty-state-text">Intenta con otro término</p></div>`;
  }, 250));

  // Create party
  container.querySelector('#create-party-btn')?.addEventListener('click', () => router.navigate('create-party'));
  container.querySelector('#empty-create')?.addEventListener('click', () => router.navigate('create-party'));

  // Sunday banner
  container.querySelector('#sunday-banner')?.addEventListener('click', () => router.navigate('sunday-rating'));

  // Single delegated handler on the page root for party-card clicks and attend
  // buttons — replaces the rebind-after-search dance that the previous version
  // needed (it manually re-attached listeners every keystroke).
  const root = container.querySelector('#parties-page');
  root.addEventListener('click', (e) => {
    const attendBtn = e.target.closest('[data-action="attend"]');
    if (attendBtn) {
      e.stopPropagation();
      const partyId = attendBtn.dataset.partyId;
      store.toggleAttendance(partyId);
      renderParties(container);
      showToast('Asistencia actualizada ✅', 'success');
      return;
    }
    const card = e.target.closest('.party-card');
    if (card) {
      const partyId = card.dataset.partyId;
      store.setState({ viewingPartyId: partyId });
      router.navigate('party-detail', { partyId });
    }
  });

  // Self-contained nav binding: renderParties() may be called directly
  // from within an in-page handler (city filter, attend toggle). Each
  // such direct call wipes container.innerHTML, including #bottom-nav,
  // so the new nav loses its listener. Rebinding here guarantees the
  // bottom nav stays interactive regardless of how we got here — the
  // router's wrapper still calls bindNavEvents() too, idempotently.
  bindNavEvents();
}
