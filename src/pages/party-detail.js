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
import { adminSoftDeleteParty } from '../data/api.js';
import { confirmAdminDelete } from '../utils/admin-moderation.js';

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
  // Skin de remate: mismos bloques, labels contextuales. La lógica
  // (asistencia, posts, lightbox, edición) es idéntica para ambos kinds.
  const isRemate = (party.kind || 'party') === 'remate';
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
  // Super-admin moderation gate (cosmetic; admin_soft_delete_party
  // re-checks is_admin() server-side). Distinct from isCreator: the admin
  // can delete ANY party, not only their own.
  const isAdmin = !!(user && user.isAdmin);

  // Boletería (0037): solo fiestas de promotor (los remates no venden
  // boletas) y solo si el enlace sigue siendo https — se RE-valida aquí
  // aunque create-party ya normalizó, porque el valor viaja por el store
  // y una fila vieja/manipulada no debe convertirse en un href arbitrario.
  // sanitize() lo deja inerte en contexto de atributo (audit C1).
  const rawTicketUrl = typeof party.ticketContactUrl === 'string' ? party.ticketContactUrl.trim() : '';
  const ticketHref = (!isRemate && rawTicketUrl.startsWith('https://')) ? sanitize(rawTicketUrl) : null;

  container.innerHTML = `
    <div class="page" id="party-detail-page">
      <button class="back-btn" id="back-btn">
        ${ICONS.back}
        <span>${isRemate ? 'Muro' : 'Fiestas'}</span>
      </button>

      ${isRemate ? `
        <!-- Badge contextual: deja claro que esto es un after, no una
             fiesta de la agenda. -->
        <div style="display:inline-flex;align-items:center;gap:6px;margin-bottom:var(--space-md);padding:4px 12px;background:rgba(255,106,0,0.12);border:1px solid var(--border-orange);border-radius:var(--radius-full);font-size:var(--text-xs);font-weight:700;color:var(--orange);text-transform:uppercase;letter-spacing:1px;">Remate</div>
      ` : ''}

      ${isAdmin ? `
        <button class="btn btn-full btn-sm" id="admin-delete-party-btn" style="margin-bottom:var(--space-md);background:rgba(220,38,38,0.12);border:1px solid rgba(220,38,38,0.5);color:#dc2626;gap:6px;font-weight:600;">
          <span style="width:16px;height:16px;display:inline-flex;">${ICONS.trash}</span>
          ${isRemate ? 'Eliminar remate (admin)' : 'Eliminar fiesta (admin)'}
        </button>
      ` : ''}

      <!-- Flyer / Hero — tap to expand into the full-flyer lightbox. The
           <img> is locked against save/select/drag (see below); tapping the
           WRAPPER (pointer-events pass through the img) opens the viewer. -->
      ${safeImageSrc(party.flyer) ? `
        <div id="flyer-hero" role="button" tabindex="0" aria-label="Ampliar flyer" style="position:relative;border-radius:var(--radius-lg);overflow:hidden;margin-bottom:var(--space-lg);cursor:zoom-in;">
          <img src="${safeImageSrc(party.flyer)}" alt="${sanitize(party.name)}" draggable="false" style="width:100%;height:220px;object-fit:cover;display:block;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-user-drag:none;user-drag:none;pointer-events:none;" />
          <span style="position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,0.55);color:#fff;font-size:0.7rem;font-weight:600;padding:4px 9px;border-radius:var(--radius-full);pointer-events:none;">⤢ Ampliar</span>
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

      <!-- Boletería del promotor — anchor real (no button+JS): abre en
           pestaña nueva con noopener/noreferrer. Va bajo la info grid,
           visible sin scroll y sin tapar el flyer-hero (el lightbox sigue
           siendo el tap del flyer). -->
      ${ticketHref ? `
        <a class="btn btn-primary btn-full btn-lg ticket-buy-btn" id="ticket-btn"
           href="${ticketHref}" target="_blank" rel="noopener noreferrer">
          Comprar boletas
        </a>
      ` : ''}

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
              <span class="badge badge-purple" style="font-size:0.5625rem;">DJ</span>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- Attendance Button -->
      <button class="btn ${isAttending ? 'btn-secondary' : 'btn-primary'} btn-full btn-lg mb-lg" id="attend-btn">
        ${isAttending ? '✓ Confirmo asistencia' : (isRemate ? 'Voy a este remate' : 'Voy a esta fiesta')}
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
          <h3 style="font-size:var(--text-sm);font-weight:600;color:var(--text-secondary);">Lo que dicen (${partyPosts.length})</h3>
          <button class="btn btn-ghost btn-sm" id="post-here-btn">Publicar aquí</button>
        </div>
        ${partyPosts.length > 0
          ? partyPosts.map(post => renderPostCard(post, state)).join('')
          : `<div class="empty-state" style="padding:var(--space-lg);"><p class="empty-state-text">Aún no hay publicaciones de ${isRemate ? 'este remate' : 'esta fiesta'}</p></div>`
        }
      </div>

      ${isCreator ? renderCreatorPanel(party, isRemate) : ''}
    </div>
  `;

  // Back: los remates no están en la agenda de fiestas — se vuelve a su
  // pestaña del muro.
  container.querySelector('#back-btn').addEventListener('click', () => {
    if (isRemate) {
      store.setState({ wallTab: 'remates' });
      router.navigate('wall');
    } else {
      router.navigate('parties');
    }
  });

  // Tap the flyer → full-flyer lightbox (locked against save/download).
  const flyerHero = container.querySelector('#flyer-hero');
  if (flyerHero) {
    const openFlyer = () => showFlyerLightbox(safeImageSrc(party.flyer), sanitize(party.name));
    flyerHero.addEventListener('click', openFlyer);
    flyerHero.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFlyer(); } });
    // Match the lightbox: block the desktop right-click menu on the hero too
    // (the img is pointer-events:none so "Guardar imagen" already never
    // appears; this just suppresses the generic menu for consistency).
    flyerHero.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Attend
  container.querySelector('#attend-btn').addEventListener('click', () => {
    store.toggleAttendance(partyId);
    showToast(store.getPartyById(partyId).attendees.includes(user.id) ? 'Asistencia confirmada +20 pts ⚡' : 'Asistencia cancelada', 'success');
    renderPartyDetail(container, params);
  });

  // Post here — con feed explícito en remates para que create-post no
  // dependa solo del kind cacheado al decidir el modo.
  container.querySelector('#post-here-btn').addEventListener('click', () => {
    store.setState({ viewingPartyId: partyId });
    router.navigate('create-post', isRemate ? { partyId, feed: 'remates' } : { partyId });
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

  // Super-admin: soft-delete ANY party (moderation path, separate from the
  // creator-only delete above). Goes through admin_soft_delete_party which
  // re-checks is_admin() server-side; the row + its children land in the
  // moderation_log trash for restore.
  const adminDelBtn = container.querySelector('#admin-delete-party-btn');
  if (adminDelBtn) {
    adminDelBtn.addEventListener('click', () => confirmAdminDelete({
      title: 'Eliminar fiesta (admin)',
      message: `"<strong>${sanitize(party.name)}</strong>" y todo su contenido (publicaciones, chat, comentarios) se ocultarán para todos. Queda en la papelera y puedes restaurarla.`,
      onConfirm: async (reason) => {
        await adminSoftDeleteParty(party.id, reason);
        // Drop from the local store so the parties list doesn't show it
        // until the next hydration (which RLS already filters).
        store.setState({ parties: store.getState().parties.filter(p => p.id !== party.id) });
        showToast('Fiesta eliminada (admin) 🛡️', 'success');
        router.navigate('parties');
      },
    }));
  }
}

// =====================================================================
// Flyer lightbox — full-flyer viewer, locked against download/select
// =====================================================================
// Shows the WHOLE flyer (object-fit:contain) over a dark backdrop; tap
// anywhere or the ✕ to close. The image is deliberately hard to save:
//   * -webkit-touch-callout:none  → iOS long-press "Guardar imagen" menu
//   * user-select / user-drag none + draggable=false → no drag-to-save
//   * pointer-events:none on the img → long-press/right-click land on the
//     backdrop (which closes), never on the <img>, so no image context menu
//   * contextmenu preventDefault → blocks desktop right-click "Save image"
// (base64 bytes are still in the DOM — this stops casual saving, not a
// determined user with devtools; that's inherent to any web image.)
function showFlyerLightbox(src, name) {
  if (!src) return;
  // Re-entrancy guard: a fast double-tap on the hero must not stack two
  // overlays (each with its own document keydown listener).
  if (document.querySelector('.flyer-lightbox-overlay')) return;
  const overlay = document.createElement('div');
  // The `modal-overlay` class opts this body-appended overlay into the
  // router's teardown (router removes .modal-overlay on every navigation),
  // so a back-gesture with the viewer open doesn't leave it stuck over the
  // next page. We ALSO close() on hashchange so the keydown listener is
  // removed too (node removal alone would leak it).
  overlay.className = 'modal-overlay flyer-lightbox-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;padding:16px;-webkit-user-select:none;user-select:none;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);';
  overlay.innerHTML = `
    <button type="button" class="flyer-lightbox-close" aria-label="Cerrar"
            style="position:absolute;top:calc(env(safe-area-inset-top, 0px) + 12px);right:16px;width:40px;height:40px;border-radius:50%;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.25);color:#fff;font-size:1.3rem;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;">✕</button>
    <img src="${src}" alt="${name}" draggable="false"
         style="max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.6);-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-user-drag:none;user-drag:none;pointer-events:none;" />
  `;
  const close = () => {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', close);
    overlay.remove();
  };
  function onKey(e) { if (e.key === 'Escape') close(); }
  // Tap anywhere (backdrop or ✕) closes; the img is pointer-events:none so
  // taps on it fall through to the overlay too.
  overlay.addEventListener('click', close);
  overlay.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('keydown', onKey);
  // Close on navigation (back-gesture / route change) so nothing is left
  // orphaned; close() removes this listener whichever way we exit.
  window.addEventListener('hashchange', close);
  document.body.appendChild(overlay);
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
        Termómetro en vivo
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
function renderCreatorPanel(party, isRemate = false) {
  return `
    <div style="margin-top:var(--space-xl);padding-top:var(--space-xl);border-top:2px solid var(--border-orange);">
      <h3 style="font-family:var(--font-display);font-size:var(--text-base);font-weight:700;color:var(--orange);margin-bottom:var(--space-md);">
        ${isRemate ? 'Panel del creador' : 'Panel de Promotor'}
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
        Eliminar evento
      </button>
    </div>
  `;
}

