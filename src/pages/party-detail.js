// ============================================
// FEEDBACK — Party Detail Page
// ============================================

import { store, ICONS, formatRelative } from '../data/mock-data.js';
import { router } from '../router.js';
import { showToast } from '../utils/toast.js';
import { avatarHTML, sanitize } from '../utils/helpers.js';
import { hashStr } from '../utils/dom.js';

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
  const isPromotor = user && user.role === 'promotor' && party.promotor === user.id;

  container.innerHTML = `
    <div class="page" id="party-detail-page">
      <button class="back-btn" id="back-btn">
        ${ICONS.back}
        <span>Fiestas</span>
      </button>

      <!-- Flyer / Hero -->
      ${party.flyer ? `
        <div style="position:relative;border-radius:var(--radius-lg);overflow:hidden;margin-bottom:var(--space-lg);">
          <img src="${party.flyer}" alt="${party.name}" style="width:100%;height:220px;object-fit:cover;display:block;" />
        </div>
      ` : `
        <div class="party-flyer-placeholder" style="border-radius:var(--radius-lg);margin-bottom:var(--space-lg);height:220px;background:linear-gradient(135deg, hsl(${hashStr(party.name) % 360}, 60%, 25%), hsl(${(hashStr(party.name) + 60) % 360}, 50%, 15%));">
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:var(--space-lg);">
            <span style="font-family:var(--font-display);font-size:var(--text-3xl);font-weight:900;color:rgba(255,255,255,0.95);text-align:center;text-transform:uppercase;letter-spacing:3px;">${party.name}</span>
            <span style="font-size:var(--text-sm);color:rgba(255,255,255,0.6);margin-top:8px;">${party.startTime} — ${party.endTime}</span>
          </div>
        </div>
      `}

      <!-- Info Grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-sm);margin-bottom:var(--space-lg);">
        <div class="card" style="display:flex;align-items:center;gap:var(--space-sm);">
          <span style="font-size:1.2rem;">📍</span>
          <div>
            <div style="font-size:var(--text-xs);color:var(--text-tertiary);">LUGAR</div>
            <div style="font-size:var(--text-sm);font-weight:600;">${party.venue}</div>
          </div>
        </div>
        <div class="card" style="display:flex;align-items:center;gap:var(--space-sm);">
          <span style="font-size:1.2rem;">📅</span>
          <div>
            <div style="font-size:var(--text-xs);color:var(--text-tertiary);">FECHA</div>
            <div style="font-size:var(--text-sm);font-weight:600;">${party.date}</div>
          </div>
        </div>
        <div class="card" style="display:flex;align-items:center;gap:var(--space-sm);">
          <span style="font-size:1.2rem;">🏙️</span>
          <div>
            <div style="font-size:var(--text-xs);color:var(--text-tertiary);">CIUDAD</div>
            <div style="font-size:var(--text-sm);font-weight:600;">${party.city}</div>
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
        ${party.genres.map(g => `<span class="tag active" style="pointer-events:none;">${g}</span>`).join('')}
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
              <div style="font-size:var(--text-xs);color:var(--text-tertiary);">${promotor.username}</div>
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
                <div style="font-size:var(--text-xs);color:var(--text-tertiary);">${dj.username}</div>
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

      <!-- Posts from this party -->
      <div style="margin-top:var(--space-xl);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-md);">
          <h3 style="font-size:var(--text-sm);font-weight:600;color:var(--text-secondary);">💬 Lo que dicen (${partyPosts.length})</h3>
          <button class="btn btn-ghost btn-sm" id="post-here-btn">Publicar aquí</button>
        </div>
        ${partyPosts.length > 0
          ? partyPosts.map(post => {
              const author = store.getUserById(post.userId);
              if (!author) return '';
              return `
                <div class="card mb-sm">
                  <div style="display:flex;align-items:center;gap:var(--space-sm);margin-bottom:var(--space-sm);">
                    ${avatarHTML(author, 'avatar-sm')}
                    <span style="font-size:var(--text-sm);font-weight:500;">${sanitize(author.name)}</span>
                    <span style="font-size:var(--text-xs);color:var(--text-tertiary);margin-left:auto;">${formatRelative(new Date(post.createdAt))}</span>
                  </div>
                  <p style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.5;">${sanitize(post.content)}</p>
                  <div style="display:flex;align-items:center;gap:var(--space-md);margin-top:var(--space-sm);">
                    <span style="font-size:var(--text-xs);color:var(--text-tertiary);">❤️ ${post.likes}</span>
                    <span style="font-size:var(--text-xs);color:var(--text-tertiary);">💬 ${post.replies}</span>
                  </div>
                </div>
              `;
            }).join('')
          : `<div class="empty-state" style="padding:var(--space-lg);"><p class="empty-state-text">Aún no hay publicaciones de esta fiesta</p></div>`
        }
      </div>

      ${isPromotor ? renderPromotorPanel(party) : ''}
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

  // Profile clicks
  container.querySelectorAll('[data-action="view-profile"]').forEach(el => {
    el.addEventListener('click', () => {
      const userId = el.dataset.userId;
      store.setState({ viewingUserId: userId });
      router.navigate('profile-other', { userId });
    });
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

function renderPromotorPanel(party) {
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
    </div>
  `;
}

