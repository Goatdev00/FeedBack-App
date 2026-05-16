// ============================================
// FEEDBACK — Create Party (Promotor)
// ============================================

import { store, ICONS } from '../data/mock-data.js';
import { router } from '../router.js';
import { showToast } from '../utils/toast.js';

const GENRES = [
  'Techno', 'Hardtechno', 'House', 'Deep House', 'Tech House', 'Melodic Techno',
  'Dark Techno', 'Acid Techno', 'Schranz', 'Gabber', 'Hardcore', 'Hardstyle',
  'Minimal', 'Drum & Bass', 'Jungle', 'Breakbeat', 'Trance', 'Psytrance',
  'Disco', 'Electro', 'Progressive', 'Ambient', 'Reggaeton', 'Guaracha',
];

const PARTY_CITIES = ['Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Cartagena'];

export function renderCreateParty(container) {
  const user = store.getState().currentUser;

  if (!user || user.role !== 'promotor') {
    showToast('Solo promotores pueden crear fiestas', 'warning');
    router.navigate('parties');
    return;
  }

  const todayStr = new Date().toISOString().split('T')[0];

  container.innerHTML = `
    <div class="page" id="create-party-page">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-lg);">
        <button class="back-btn" id="back-btn" style="margin-bottom:0;">
          ${ICONS.back}
          <span>Fiestas</span>
        </button>
        <button class="btn btn-primary btn-sm" id="publish-party-btn">
          Publicar evento
        </button>
      </div>

      <h1 class="page-title" style="margin-bottom:var(--space-xs);">Crear fiesta</h1>
      <p class="page-subtitle" style="margin-bottom:var(--space-xl);">Sube tu evento y llega a la comunidad</p>

      <!-- Flyer Upload -->
      <div class="form-section">
        <div class="form-section-title">Flyer del evento</div>
        <div class="flyer-upload" id="flyer-upload">
          ${ICONS.image}
          <span style="font-size:var(--text-sm);">Subir flyer</span>
          <span style="font-size:var(--text-xs);color:var(--text-muted);">JPG, PNG · Recomendado 1:1</span>
        </div>
        <input type="file" id="flyer-file" accept="image/*" style="display:none;" />
        <div id="flyer-preview" style="display:none;margin-top:var(--space-md);position:relative;">
          <img id="flyer-preview-img" style="width:100%;border-radius:var(--radius-md);max-height:300px;object-fit:cover;" />
          <button class="btn btn-icon btn-secondary" id="remove-flyer" style="position:absolute;top:8px;right:8px;width:32px;height:32px;">${ICONS.x}</button>
        </div>
      </div>

      <!-- Event Info -->
      <div class="form-section">
        <div class="form-section-title">Información del evento</div>
        
        <div class="input-group mb-md">
          <label class="input-label">Nombre del evento *</label>
          <input type="text" class="input" id="party-name" placeholder="Ej: NEXUS Underground Session" maxlength="50" />
        </div>

        <div class="input-group mb-md">
          <label class="input-label">Descripción</label>
          <textarea class="input textarea" id="party-description" placeholder="Describe tu evento..." maxlength="300" style="min-height:80px;"></textarea>
        </div>

        <div class="input-group mb-md">
          <label class="input-label">Venue / Lugar *</label>
          <input type="text" class="input" id="party-venue" placeholder="Ej: Warehouse Club" />
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-md);">
          <div class="input-group mb-md">
            <label class="input-label">Ciudad *</label>
            <select class="input" id="party-city">
              ${PARTY_CITIES.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
          <div class="input-group mb-md">
            <label class="input-label">Fecha *</label>
            <input type="date" class="input" id="party-date" value="${todayStr}" />
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-md);">
          <div class="input-group mb-md">
            <label class="input-label">Inicio</label>
            <input type="time" class="input" id="party-start" value="22:00" />
          </div>
          <div class="input-group mb-md">
            <label class="input-label">Fin</label>
            <input type="time" class="input" id="party-end" value="06:00" />
          </div>
        </div>
      </div>

      <!-- Genres -->
      <div class="form-section">
        <div class="form-section-title">Géneros musicales</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;" id="genre-picker">
          ${GENRES.map(g => `
            <button class="tag" data-genre="${g}">${g}</button>
          `).join('')}
        </div>
      </div>

      <!-- Premium CTA -->
      <div class="card" style="background:linear-gradient(135deg, rgba(255,200,0,0.05), rgba(255,106,0,0.05));border-color:rgba(255,200,0,0.2);margin-top:var(--space-lg);">
        <div style="display:flex;align-items:center;gap:var(--space-md);">
          <span style="font-size:1.5rem;">⭐</span>
          <div style="flex:1;">
            <h4 style="font-size:var(--text-sm);font-weight:600;color:#FFC800;">Evento Patrocinado</h4>
            <p style="font-size:var(--text-xs);color:var(--text-tertiary);">Destaca tu evento para mayor visibilidad</p>
          </div>
          <button class="btn btn-ghost btn-sm" style="color:#FFC800;border:1px solid rgba(255,200,0,0.3);">PRO</button>
        </div>
      </div>
    </div>
  `;

  let selectedGenres = [];
  let flyerData = null;

  // Back
  container.querySelector('#back-btn').addEventListener('click', () => router.navigate('parties'));

  // Flyer upload
  const flyerUpload = container.querySelector('#flyer-upload');
  const flyerInput = container.querySelector('#flyer-file');
  const flyerPreview = container.querySelector('#flyer-preview');
  const flyerPreviewImg = container.querySelector('#flyer-preview-img');

  flyerUpload.addEventListener('click', () => flyerInput.click());
  flyerInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        flyerData = ev.target.result;
        flyerPreviewImg.src = flyerData;
        flyerPreview.style.display = 'block';
        flyerUpload.style.display = 'none';
      };
      reader.readAsDataURL(file);
    }
  });

  container.querySelector('#remove-flyer').addEventListener('click', () => {
    flyerData = null;
    flyerPreview.style.display = 'none';
    flyerUpload.style.display = '';
    flyerInput.value = '';
  });

  // Genre selection
  container.querySelectorAll('[data-genre]').forEach(tag => {
    tag.addEventListener('click', () => {
      const genre = tag.dataset.genre;
      tag.classList.toggle('active');
      if (selectedGenres.includes(genre)) {
        selectedGenres = selectedGenres.filter(g => g !== genre);
      } else {
        selectedGenres.push(genre);
      }
    });
  });

  // Publish
  container.querySelector('#publish-party-btn').addEventListener('click', () => {
    const name = container.querySelector('#party-name').value.trim();
    const venue = container.querySelector('#party-venue').value.trim();
    const city = container.querySelector('#party-city').value;
    const date = container.querySelector('#party-date').value;
    const startTime = container.querySelector('#party-start').value;
    const endTime = container.querySelector('#party-end').value;
    const description = container.querySelector('#party-description').value.trim();

    if (!name) { showToast('El nombre del evento es obligatorio', 'error'); return; }
    if (!venue) { showToast('El lugar es obligatorio', 'error'); return; }

    // Check duplicate
    const dup = store.detectDuplicate(name);
    if (dup) {
      showToast(`⚠️ Ya existe "${dup.name}". Verifica que no sea duplicado.`, 'warning');
      return;
    }

    store.addParty({
      name,
      venue,
      city,
      date,
      startTime,
      endTime,
      genres: selectedGenres,
      promotor: user.id,
      djs: [],
      flyer: flyerData,
      description,
    });

    showToast('¡Evento creado con éxito! 🎉', 'success');
    router.navigate('parties');
  });
}
