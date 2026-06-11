// ============================================
// FEEDBACK — Sunday Rating Page
// ============================================

import { store, ICONS, SUNDAY_CATEGORIES } from '../data/mock-data.js';
import { router } from '../router.js';
import { showToast, showPointsToast } from '../utils/toast.js';
import { sanitize } from '../utils/helpers.js';

export function renderSundayRating(container) {
  const state = store.getState();
  const user = state.currentUser;
  if (!user) { router.navigate('login'); return; }

  // Get parties user attended this week
  const attendedPartyIds = user.partiesAttended || [];
  const parties = attendedPartyIds.map(id => store.getPartyById(id)).filter(Boolean);

  // Also include parties from the attendees list
  const allParties = state.parties.filter(p => p.attendees.includes(user.id));
  const uniqueParties = [...new Map([...parties, ...allParties].map(p => [p.id, p])).values()];

  let currentPartyIndex = 0;
  let ratings = {};

  function renderCurrentParty() {
    if (uniqueParties.length === 0) {
      container.innerHTML = `
        <div class="page" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100dvh;text-align:center;">
          <button class="back-btn" id="back-btn" style="position:absolute;top:var(--space-lg);left:var(--space-md);">
            ${ICONS.back}
            <span>Volver</span>
          </button>
          <div style="font-size:3rem;margin-bottom:var(--space-lg);">🏆</div>
          <h2 class="page-title" style="margin-bottom:var(--space-sm);">Puntúa las fiestas</h2>
          <p style="font-size:var(--text-sm);color:var(--text-secondary);max-width:280px;">
            No has asistido a ninguna fiesta esta semana. ¡Marca asistencia en la sección de fiestas!
          </p>
          <button class="btn btn-primary mt-xl" id="go-parties">Ver fiestas</button>
        </div>
      `;
      container.querySelector('#back-btn').addEventListener('click', () => router.navigate('parties'));
      container.querySelector('#go-parties').addEventListener('click', () => router.navigate('parties'));
      return;
    }

    const party = uniqueParties[currentPartyIndex];
    const partyRatings = ratings[party.id] || {};
    const progress = ((currentPartyIndex + 1) / uniqueParties.length) * 100;

    container.innerHTML = `
      <div class="page" id="sunday-rating-page">
        <button class="back-btn" id="back-btn">
          ${ICONS.back}
          <span>${currentPartyIndex > 0 ? 'Anterior' : 'Salir'}</span>
        </button>

        <!-- Progress -->
        <div style="margin-bottom:var(--space-xl);">
          <div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-bottom:var(--space-sm);">
            Fiesta ${currentPartyIndex + 1} de ${uniqueParties.length}
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width:${progress}%"></div>
          </div>
        </div>

        <!-- Party Header -->
        <div class="sunday-header">
          <div style="font-size:2.5rem;margin-bottom:var(--space-sm);">🏆</div>
          <h2>Puntúa las fiestas</h2>
          <p>Califica tu experiencia en cada evento</p>
        </div>

        <div class="card" style="text-align:center;margin-bottom:var(--space-xl);padding:var(--space-lg);background:linear-gradient(135deg, rgba(255,106,0,0.08), rgba(63,10,116,0.08));border-color:var(--border-orange);">
          <h3 style="font-family:var(--font-display);font-size:var(--text-xl);font-weight:700;">${sanitize(party.name)}</h3>
          <p style="font-size:var(--text-sm);color:var(--text-secondary);margin-top:4px;">${sanitize(party.venue)} · ${sanitize(party.city)}</p>
        </div>

        <!-- Rating Categories -->
        <div id="rating-categories">
          ${SUNDAY_CATEGORIES.map(cat => `
            <div class="rating-category">
              <div class="rating-category-label">
                <span>${cat.emoji}</span>
                <span>${cat.label}</span>
              </div>
              <div class="rating-stars" data-category="${cat.id}">
                ${[1, 2, 3, 4, 5].map(i => `
                  <button class="rating-star ${partyRatings[cat.id] >= i ? 'active' : ''}" data-value="${i}" data-category="${cat.id}">
                    ${partyRatings[cat.id] >= i ? ICONS.starFilled : ICONS.star}
                  </button>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>

        <!-- Actions -->
        <div style="display:flex;gap:var(--space-sm);margin-top:var(--space-xl);">
          <button class="btn btn-secondary" id="skip-btn" style="flex:0.4;">Saltar</button>
          <button class="btn btn-primary btn-full" id="next-btn">
            ${currentPartyIndex === uniqueParties.length - 1 ? 'Finalizar 🎉' : 'Siguiente →'}
          </button>
        </div>

        <!-- Points info -->
        <p style="font-size:var(--text-xs);color:var(--text-tertiary);text-align:center;margin-top:var(--space-lg);">
          ⚡ Ganas +10 pts por cada fiesta calificada
        </p>
      </div>
    `;

    // Bind events
    container.querySelector('#back-btn').addEventListener('click', () => {
      if (currentPartyIndex > 0) {
        currentPartyIndex--;
        renderCurrentParty();
      } else {
        router.navigate('parties');
      }
    });

    // Star ratings
    container.querySelectorAll('.rating-star').forEach(star => {
      star.addEventListener('click', () => {
        const value = parseInt(star.dataset.value);
        const category = star.dataset.category;
        if (!ratings[party.id]) ratings[party.id] = {};
        ratings[party.id][category] = value;
        renderCurrentParty();
      });
    });

    // Skip
    container.querySelector('#skip-btn').addEventListener('click', () => {
      if (currentPartyIndex < uniqueParties.length - 1) {
        currentPartyIndex++;
        renderCurrentParty();
      } else {
        finishRating();
      }
    });

    // Next
    container.querySelector('#next-btn').addEventListener('click', () => {
      const partyRating = ratings[party.id] || {};
      const ratedCategories = Object.keys(partyRating).length;
      if (ratedCategories < 3) {
        showToast('Califica al menos 3 categorías', 'warning');
        return;
      }

      // Award points
      store.addPoints(10, `Calificar ${party.name}`);

      if (currentPartyIndex < uniqueParties.length - 1) {
        currentPartyIndex++;
        renderCurrentParty();
        showPointsToast(10, 'Fiesta calificada');
      } else {
        finishRating();
      }
    });
  }

  function finishRating() {
    const totalRated = Object.keys(ratings).length;
    
    container.innerHTML = `
      <div class="page" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100dvh;text-align:center;">
        <div style="font-size:4rem;margin-bottom:var(--space-lg);animation:heartBeat 0.6s var(--ease-spring);">🏆</div>
        <h2 style="font-family:var(--font-display);font-size:var(--text-2xl);font-weight:700;margin-bottom:var(--space-sm);">
          ¡Gracias por calificar!
        </h2>
        <p style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-sm);">
          Calificaste ${totalRated} fiesta${totalRated !== 1 ? 's' : ''}
        </p>
        <div class="points-display" style="font-size:var(--text-lg);margin-bottom:var(--space-2xl);">
          ${ICONS.zap}
          <span>+${totalRated * 10} pts</span>
        </div>
        <p style="font-size:var(--text-xs);color:var(--text-tertiary);max-width:260px;margin-bottom:var(--space-xl);">
          Tus calificaciones ayudan a mejorar las fiestas y alimentan los rankings de la comunidad.
        </p>
        <button class="btn btn-primary btn-lg" id="done-btn">Volver a fiestas</button>
      </div>
    `;

    container.querySelector('#done-btn').addEventListener('click', () => router.navigate('parties'));
  }

  renderCurrentParty();
}
