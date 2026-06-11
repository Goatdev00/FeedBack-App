// ============================================
// FEEDBACK — Party Detail Page
// ============================================

import { store, ICONS } from '../data/mock-data.js';
import { router } from '../router.js';
import { showToast } from '../utils/toast.js';
import { avatarHTML, sanitize, safeImageSrc } from '../utils/helpers.js';
import { createModal, hashStr } from '../utils/dom.js';
import { fileToResizedDataURL } from '../utils/image.js';
import { renderPostCard, bindPostCardActions } from './wall.js';

const PARTY_CITIES = ['Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Cartagena'];
const PARTY_GENRES = [
  'Techno', 'Hardtechno', 'House', 'Deep House', 'Tech House', 'Melodic Techno',
  'Dark Techno', 'Acid Techno', 'Schranz', 'Gabber', 'Hardcore', 'Hardstyle',
  'Minimal', 'Drum & Bass', 'Jungle', 'Breakbeat', 'Trance', 'Psytrance',
  'Disco', 'Electro', 'Progressive', 'Ambient', 'Reggaeton', 'Guaracha',
];

export function renderPartyDetail(container, params = {}) {
  const state = store.getState();
  const partyId = params.partyId || state.viewingPartyId;
  const party = store.getPartyById(partyId);
  if (!party) { router.navigate('parties'); return; }

  const user = state.currentUser;
  const isAttending = user && party.attendees.includes(user.id);
  const promotor = party.promotor ? store.getUserById(party.promotor) : null;
  const djs = party.djs.map(id => store.getUserById(id)).filter(Boolean);
  const partyPosts = state.posts.filter(p => p.partyId === partyId);
  // Only the actual creator can edit/delete. All four conditions are
  // checked explicitly: both ids must be present AND equal. Without the
  // `user.id` and `party.promotor` truthy guards a brief window during
  // boot (before currentUser hydrates, or for a legacy cached row whose
  // `promotor` field is null) would let `undefined === undefined` slip
  // through and show the panel to non-creators.
  // RLS on the server still enforces ownership independently
  // (parties_update_owner / parties_delete_owner check
  //  promoter_id = auth.uid()), so even if this UI gate were tampered
  // with via DevTools, the PATCH/DELETE would be rejected.
  const isCreator = !!(
    user
    && user.id
    && party.promotor
    && party.promotor === user.id
  );

  container.innerHTML = `
    <div class="page" id="party-detail-page">
      <button class="back-btn" id="back-btn">
        ${ICONS.back}
        <span>Fiestas</span>
      </button>

      <!-- Flyer / Hero -->
      ${safeImageSrc(party.flyer) ? `
        <div style="position:relative;border-radius:var(--radius-lg);overflow:hidden;margin-bottom:var(--space-lg);">
          <img src="${safeImageSrc(party.flyer)}" alt="${sanitize(party.name)}" style="width:100%;height:220px;object-fit:cover;display:block;" />
        </div>
      ` : `
        <div class="party-flyer-placeholder" style="border-radius:var(--radius-lg);margin-bottom:var(--space-lg);height:220px;background:linear-gradient(135deg, hsl(${hashStr(party.name) % 360}, 60%, 25%), hsl(${(hashStr(party.name) + 60) % 360}, 50%, 15%));">
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:var(--space-lg);">
            <span style="font-family:var(--font-display);font-size:var(--text-3xl);font-weight:900;color:#fff;text-align:center;text-transform:uppercase;letter-spacing:3px;">${sanitize(party.name)}</span>
            <span style="font-size:var(--text-sm);color:#fff;margin-top:8px;">${sanitize(party.startTime)} — ${sanitize(party.endTime)}</span>
          </div>
        </div>
      `}

      <!-- Info Grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-sm);margin-bottom:var(--space-lg);">
        <div class="card" style="display:flex;align-items:center;gap:var(--space-sm);">
          <span style="font-size:1.2rem;">📍</span>
          <div>
            <div style="font-size:var(--text-xs);color:var(--text-tertiary);">LUGAR</div>
            <div style="font-size:var(--text-sm);font-weight:600;">${sanitize(party.venue)}</div>
          </div>
        </div>
        <div class="card" style="display:flex;align-items:center;gap:var(--space-sm);">
          <span style="font-size:1.2rem;">📅</span>
          <div>
            <div style="font-size:var(--text-xs);color:var(--text-tertiary);">FECHA</div>
            <div style="font-size:var(--text-sm);font-weight:600;">${sanitize(party.date)}</div>
          </div>
        </div>
        <div class="card" style="display:flex;align-items:center;gap:var(--space-sm);">
          <span style="font-size:1.2rem;">🏙️</span>
          <div>
            <div style="font-size:var(--text-xs);color:var(--text-tertiary);">CIUDAD</div>
            <div style="font-size:var(--text-sm);font-weight:600;">${sanitize(party.city)}</div>
          </div>
        </div>
        <div class="card" style="display:flex;align-items:center;gap:var(--space-sm);">
          <span style="font-size:1.2rem;">👥</span>
          <div>
            <div style="font-size:var(--text-xs);color:var(--text-tertiary);">ASISTENTES</div>
            <div style="font-size:var(--text-sm);font-weight:600;">${party.attendees.length}</div>
          </div>
        </div>
      </div>

      <!-- Genres -->
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:var(--space-lg);">
        ${party.genres.map(g => `<span class="tag active" style="pointer-events:none;">${sanitize(g)}</span>`).join('')}
      </div>

      ${party.description ? `
        <p style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.6;margin-bottom:var(--space-lg);">${sanitize(party.description)}</p>
      ` : ''}

      <!-- Promotor & DJs -->
      ${promotor ? `
        <div class="card mb-md" style="cursor:pointer;" data-action="view-profile" data-user-id="${promotor.id}">
          <div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-bottom:var(--space-sm);">ORGANIZADOR</div>
          <div style="display:flex;align-items:center;gap:var(--space-sm);">
            ${avatarHTML(promotor, 'avatar-sm')}
            <div>
              <div style="font-size:var(--text-sm);font-weight:600;">${sanitize(promotor.name)}</div>
              <div style="font-size:var(--text-xs);color:var(--text-tertiary);">${sanitize(promotor.username)}</div>
            </div>
          </div>
        </div>
      ` : ''}

      ${djs.length > 0 ? `
        <div style="margin-bottom:var(--space-lg);">
          <div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-bottom:var(--space-sm);">DJs</div>
          ${djs.map(dj => `
            <div class="card mb-sm" style="display:flex;align-items:center;gap:var(--space-sm);cursor:pointer;" data-action="view-profile" data-user-id="${dj.id}">
              ${avatarHTML(dj, 'avatar-sm')}
              <div style="flex:1;">
                <div style="font-size:var(--text-sm);font-weight:600;">${sanitize(dj.name)}</div>
                <div style="font-size:var(--text-xs);color:var(--text-tertiary);">${sanitize(dj.username)}</div>
              </div>
              <span class="badge badge-purple" style="font-size:0.5625rem;">🎧 DJ</span>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- Attendance Button -->
      <button class="btn ${isAttending ? 'btn-secondary' : 'btn-primary'} btn-full btn-lg mb-lg" id="attend-btn">
        ${isAttending ? '✓ Confirmo asistencia' : '🎉 Voy a esta fiesta'}
      </button>

      <!-- Thermometer / Live Reports -->
      ${renderThermometer(party)}

      <!-- Posts from this party. Uses the SAME renderPostCard as the
           wall so the visual (photo, like button, comment input, etc.)
           is identical and any future card changes propagate to both
           surfaces. bindPostCardActions below wires like / comment /
           report / view-profile / view-all-comments. -->
      <div id="party-posts-section" style="margin-top:var(--space-xl);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-md);">
          <h3 style="font-size:var(--text-sm);font-weight:600;color:var(--text-secondary);">💬 Lo que dicen (${partyPosts.length})</h3>
          <button class="btn btn-ghost btn-sm" id="post-here-btn">Publicar aquí</button>
        </div>
        ${partyPosts.length > 0
          ? partyPosts.map(post => renderPostCard(post, state)).join('')
          : `<div class="empty-state" style="padding:var(--space-lg);"><p class="empty-state-text">Aún no hay publicaciones de esta fiesta</p></div>`
        }
      </div>

      ${isCreator ? renderCreatorPanel(party) : ''}
    </div>
  `;

  // Back
  container.querySelector('#back-btn').addEventListener('click', () => router.navigate('parties'));

  // Attend
  container.querySelector('#attend-btn').addEventListener('click', () => {
    store.toggleAttendance(partyId);
    showToast(store.getPartyById(partyId).attendees.includes(user.id) ? 'Asistencia confirmada +20 pts ⚡' : 'Asistencia cancelada', 'success');
    renderPartyDetail(container, params);
  });

  // Post here
  container.querySelector('#post-here-btn').addEventListener('click', () => {
    store.setState({ viewingPartyId: partyId });
    router.navigate('create-post', { partyId });
  });

  // Post-card actions (like / comment / report / view-profile / etc).
  // Delegated on the posts section so toggling like or sending a
  // comment refreshes the party-detail page in place — same handler
  // wall.js uses, just with a different `refresh` callback.
  const postsRoot = container.querySelector('#party-posts-section');
  if (postsRoot) {
    bindPostCardActions(container, postsRoot, () => renderPartyDetail(container, params));
  }

  // Profile clicks OUTSIDE the posts section (promotor card, DJs).
  // The post-card delegate above already handles in-post avatar/name
  // taps, so we scope this fallback to the non-post UI to avoid
  // double-binding the same buttons.
  container.querySelectorAll('[data-action="view-profile"]').forEach(el => {
    if (postsRoot && postsRoot.contains(el)) return;
    el.addEventListener('click', () => {
      const userId = el.dataset.userId;
      store.setState({ viewingUserId: userId });
      router.navigate('profile-other', { userId });
    });
  });

  // Creator-only: edit + delete buttons. Both buttons only exist in the
  // DOM if isCreator was true at render time (renderCreatorPanel gates
  // it), so we don't need to re-check here — but RLS will also reject
  // any patch/delete from someone who isn't promoter_id.
  const editBtn = container.querySelector('#edit-event-btn');
  if (editBtn) {
    editBtn.addEventListener('click', () => showEditPartyModal(container, party, params));
  }
  const deleteBtn = container.querySelector('#delete-event-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => showDeletePartyConfirm(party));
  }
}

// =====================================================================
// Edit modal
// =====================================================================
function showEditPartyModal(container, party, params) {
  // Snapshot the original flyer so the "remove flyer" + "pick new flyer"
  // flows can both round-trip without losing the existing image when
  // the user cancels.
  let flyerData = party.flyer || null;
  let selectedGenres = [...(party.genres || [])];

  const overlay = createModal(`
    <div class="modal" style="max-height:92dvh;overflow-y:auto;">
      <div class="modal-handle"></div>
      <div class="modal-title">Editar evento</div>

      <!-- Flyer -->
      <div class="form-section">
        <div class="form-section-title">Flyer</div>
        <div id="edit-flyer-preview" style="${flyerData ? '' : 'display:none;'}position:relative;margin-bottom:var(--space-sm);">
          <img id="edit-flyer-img" src="${safeImageSrc(flyerData) || ''}" style="width:100%;border-radius:var(--radius-md);max-height:240px;object-fit:cover;" />
          <button type="button" class="btn btn-icon btn-secondary" id="edit-flyer-remove" style="position:absolute;top:8px;right:8px;width:32px;height:32px;">${ICONS.x}</button>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="edit-flyer-pick" style="width:100%;">
          ${ICONS.image} ${flyerData ? 'Cambiar flyer' : 'Subir flyer'}
        </button>
        <input type="file" id="edit-flyer-file" accept="image/*" hidden />
      </div>

      <div class="form-section">
        <div class="input-group mb-md">
          <label class="input-label">Nombre del evento *</label>
          <input type="text" class="input" id="edit-name" maxlength="50" value="${sanitize(party.name || '')}" />
        </div>

        <div class="input-group mb-md">
          <label class="input-label">Descripción</label>
          <textarea class="input textarea" id="edit-description" maxlength="300" style="min-height:80px;">${sanitize(party.description || '')}</textarea>
        </div>

        <div class="input-group mb-md">
          <label class="input-label">Venue / Lugar *</label>
          <input type="text" class="input" id="edit-venue" value="${sanitize(party.venue || '')}" />
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-md);">
          <div class="input-group mb-md">
            <label class="input-label">Ciudad *</label>
            <select class="input" id="edit-city">
              ${PARTY_CITIES.map(c => `<option value="${c}" ${c === party.city ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="input-group mb-md">
            <label class="input-label">Fecha *</label>
            <input type="date" class="input" id="edit-date" value="${party.date || ''}" />
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-md);">
          <div class="input-group mb-md">
            <label class="input-label">Inicio</label>
            <input type="time" class="input" id="edit-start" value="${party.startTime || ''}" />
          </div>
          <div class="input-group mb-md">
            <label class="input-label">Fin</label>
            <input type="time" class="input" id="edit-end" value="${party.endTime || ''}" />
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Géneros</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;" id="edit-genres">
          ${PARTY_GENRES.map(g => `
            <button type="button" class="tag ${selectedGenres.includes(g) ? 'active' : ''}" data-genre="${g}">${g}</button>
          `).join('')}
        </div>
      </div>

      <div style="display:flex;gap:var(--space-sm);margin-top:var(--space-lg);">
        <button type="button" class="btn btn-secondary" id="edit-cancel" style="flex:1;">Cancelar</button>
        <button type="button" class="btn btn-primary" id="edit-save" style="flex:1;">Guardar cambios</button>
      </div>
    </div>
  `);

  // Flyer pick + remove
  const flyerInput   = overlay.querySelector('#edit-flyer-file');
  const flyerPick    = overlay.querySelector('#edit-flyer-pick');
  const flyerPreview = overlay.querySelector('#edit-flyer-preview');
  const flyerImg     = overlay.querySelector('#edit-flyer-img');
  const flyerRemove  = overlay.querySelector('#edit-flyer-remove');

  flyerPick.addEventListener('click', () => flyerInput.click());
  flyerInput.addEventListener('change', async () => {
    const file = flyerInput.files?.[0];
    if (!file) return;
    try {
      flyerData = await fileToResizedDataURL(file, 1280, 0.82);
      flyerImg.src = flyerData;
      flyerPreview.style.display = '';
      flyerPick.textContent = '';
      flyerPick.innerHTML = `${ICONS.image} Cambiar flyer`;
    } catch {
      showToast('No se pudo procesar la imagen', 'error');
    }
    flyerInput.value = '';
  });
  flyerRemove.addEventListener('click', () => {
    flyerData = null;
    flyerPreview.style.display = 'none';
    flyerPick.innerHTML = `${ICONS.image} Subir flyer`;
  });

  // Genre toggles
  overlay.querySelectorAll('[data-genre]').forEach(tag => {
    tag.addEventListener('click', () => {
      const g = tag.dataset.genre;
      tag.classList.toggle('active');
      if (selectedGenres.includes(g)) {
        selectedGenres = selectedGenres.filter(x => x !== g);
      } else {
        selectedGenres.push(g);
      }
    });
  });

  overlay.querySelector('#edit-cancel').addEventListener('click', () => overlay.close());
  overlay.querySelector('#edit-save').addEventListener('click', () => {
    const name        = overlay.querySelector('#edit-name').value.trim();
    const venue       = overlay.querySelector('#edit-venue').value.trim();
    const city        = overlay.querySelector('#edit-city').value;
    const date        = overlay.querySelector('#edit-date').value;
    const startTime   = overlay.querySelector('#edit-start').value;
    const endTime     = overlay.querySelector('#edit-end').value;
    const description = overlay.querySelector('#edit-description').value.trim();

    if (!name)  { showToast('El nombre es obligatorio', 'error'); return; }
    if (!venue) { showToast('El lugar es obligatorio', 'error'); return; }

    store.updateParty(party.id, {
      name, venue, city, date,
      startTime, endTime,
      genres: selectedGenres,
      flyer: flyerData,
      description,
    });

    overlay.close();
    showToast('Evento actualizado ✨', 'success');
    renderPartyDetail(container, params);
  });
}

// =====================================================================
// Delete confirmation
// =====================================================================
function showDeletePartyConfirm(party) {
  const overlay = createModal(`
    <div class="modal" style="max-width:400px;">
      <div class="modal-handle"></div>
      <div style="text-align:center;padding:var(--space-md) 0;">
        <div style="font-size:2.5rem;margin-bottom:var(--space-sm);">🗑️</div>
        <h2 style="font-family:var(--font-display);font-size:var(--text-lg);font-weight:700;margin-bottom:var(--space-sm);">
          ¿Eliminar evento?
        </h2>
        <p style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.5;margin-bottom:var(--space-lg);">
          "<strong>${sanitize(party.name)}</strong>" se eliminará para todos los usuarios.
          Esta acción no se puede deshacer.
        </p>
      </div>
      <div style="display:flex;gap:var(--space-sm);">
        <button type="button" class="btn btn-secondary" id="del-cancel" style="flex:1;">Cancelar</button>
        <button type="button" class="btn" id="del-confirm" style="flex:1;background:#dc2626;color:white;border:none;">
          Eliminar
        </button>
      </div>
    </div>
  `);

  overlay.querySelector('#del-cancel').addEventListener('click', () => overlay.close());
  overlay.querySelector('#del-confirm').addEventListener('click', () => {
    store.deleteParty(party.id);
    overlay.close();
    showToast('Evento eliminado', 'success');
    router.navigate('parties');
  });
}

function renderThermometer(party) {
  const reports = party.reports || {};
  const categories = [
    { key: 'ambiente', label: 'Ambiente', emoji: '✨' },
    { key: 'seguridad', label: 'Seguridad', emoji: '🛡️' },
    { key: 'musica', label: 'Música', emoji: '🎵' },
    { key: 'aforo', label: 'Aforo', emoji: '👥' },
    { key: 'energia', label: 'Energía', emoji: '⚡' },
  ];

  if (Object.keys(reports).length === 0) return '';

  return `
    <div class="thermometer">
      <div class="thermometer-title">
        <span>🌡️</span> Termómetro en vivo
      </div>
      ${categories.map(cat => `
        <div class="thermo-row">
          <span class="thermo-label">${cat.emoji} ${cat.label}</span>
          <div class="thermo-bar">
            <div class="thermo-fill" style="width:${reports[cat.key] || 0}%"></div>
          </div>
          <span class="thermo-value">${reports[cat.key] || 0}%</span>
        </div>
      `).join('')}
    </div>
  `;
}

// Panel only rendered when the viewing user is the party's creator —
// the gating happens at the call site (`${isCreator ? renderCreatorPanel
// : ''}`). The buttons here are the ONLY surface that exposes edit /
// delete; RLS would reject either action from anyone else regardless.
function renderCreatorPanel(party) {
  return `
    <div style="margin-top:var(--space-xl);padding-top:var(--space-xl);border-top:2px solid var(--border-orange);">
      <h3 style="font-family:var(--font-display);font-size:var(--text-base);font-weight:700;color:var(--orange);margin-bottom:var(--space-md);">
        ✨ Panel de Promotor
      </h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-sm);">
        <div class="card" style="text-align:center;">
          <div style="font-family:var(--font-display);font-size:var(--text-2xl);font-weight:700;">${party.attendees.length}</div>
          <div style="font-size:var(--text-xs);color:var(--text-tertiary);">Asistentes</div>
        </div>
        <div class="card" style="text-align:center;">
          <div style="font-family:var(--font-display);font-size:var(--text-2xl);font-weight:700;">${store.getState().posts.filter(p => p.partyId === party.id).length}</div>
          <div style="font-size:var(--text-xs);color:var(--text-tertiary);">Publicaciones</div>
        </div>
      </div>
      <button class="btn btn-outline btn-full btn-sm mt-md" id="edit-event-btn">
        ${ICONS.edit} Editar evento
      </button>
      <button class="btn btn-full btn-sm mt-sm" id="delete-event-btn"
              style="background:transparent;border:1px solid rgba(220,38,38,0.4);color:#dc2626;">
        🗑️ Eliminar evento
      </button>
    </div>
  `;
}

