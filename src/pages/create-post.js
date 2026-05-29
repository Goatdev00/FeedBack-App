// ============================================
// FEEDBACK — Create Post Page
// ============================================

import { store, ICONS, REPORT_CATEGORIES } from '../data/mock-data.js';
import { router } from '../router.js';
import { showToast, showPointsToast } from '../utils/toast.js';
import { avatarHTML } from '../utils/helpers.js';
import { fileToResizedDataURL } from '../utils/image.js';

export function renderCreatePost(container, params = {}) {
  const state = store.getState();
  const user = state.currentUser;
  const partyId = params.partyId || state.viewingPartyId;
  const party = store.getPartyById(partyId);

  if (!party) {
    router.navigate('select-party');
    return;
  }

  if (!user) {
    router.navigate('login');
    return;
  }

  const postsToday = store.getUserPostsToday(user.id);
  const remaining = 5 - postsToday;

  container.innerHTML = `
    <div class="page" id="create-post-page">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-sm);margin-bottom:var(--space-md);">
        <button class="back-btn" id="back-btn" style="margin-bottom:0;">
          ${ICONS.back}
          <span>Volver</span>
        </button>
        <div class="post-counter" title="Publicaciones hechas hoy">
          📝 <span class="post-counter-value">${postsToday}</span>/5 hoy
        </div>
        <button class="btn btn-primary btn-sm" id="publish-btn">
          Publicar
        </button>
      </div>

      <!-- Party tag (like Instagram location) -->
      <div class="card" style="display:flex;align-items:center;gap:var(--space-md);margin-bottom:var(--space-lg);padding:var(--space-sm) var(--space-md);">
        <span style="font-size:1.2rem;">📍</span>
        <div style="flex:1;">
          <div style="font-size:var(--text-sm);font-weight:600;">${party.name}</div>
          <div style="font-size:var(--text-xs);color:var(--text-tertiary);">${party.venue} · ${party.city}</div>
        </div>
        <button class="btn btn-ghost btn-sm" id="change-party" style="font-size:var(--text-xs);">Cambiar</button>
      </div>

      <!-- Author info -->
      <div style="display:flex;align-items:center;gap:var(--space-sm);margin-bottom:var(--space-md);">
        ${avatarHTML(user, 'avatar-sm')}
        <span style="font-size:var(--text-sm);font-weight:500;">${user.name}</span>
        <span class="post-counter" style="margin-left:auto;font-size:0.625rem;">
          ${remaining} publicaciones restantes
        </span>
      </div>

      <!-- Post content -->
      <textarea 
        class="input textarea" 
        id="post-content" 
        placeholder="¿Qué está pasando en ${party.name}? Comparte tu experiencia..." 
        maxlength="500"
        style="min-height:140px;font-size:var(--text-base);border:none;background:transparent;padding:0;resize:none;"
        autofocus
      ></textarea>

      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:var(--space-sm);">
        <span style="font-size:var(--text-xs);color:var(--text-muted);" id="char-counter">0/500</span>
        <span style="font-size:var(--text-xs);color:var(--text-muted);">Desaparece en 7 días</span>
      </div>

      <!-- Divider -->
      <div style="height:1px;background:var(--border-subtle);margin:var(--space-lg) 0;"></div>

      <!-- Media options -->
      <div style="display:flex;gap:var(--space-sm);margin-bottom:var(--space-lg);">
        <button class="btn btn-secondary btn-sm" id="add-photo">
          ${ICONS.image}
          Foto
        </button>
      </div>

      <!-- Photo preview -->
      <div id="photo-preview" style="display:none;margin-bottom:var(--space-lg);position:relative;">
        <img id="preview-img" style="width:100%;border-radius:var(--radius-md);max-height:300px;object-fit:cover;" />
        <button class="btn btn-icon btn-secondary" id="remove-photo" style="position:absolute;top:8px;right:8px;width:32px;height:32px;">
          ${ICONS.x}
        </button>
      </div>
      <input type="file" id="photo-file" accept="image/*" style="display:none;" />

      <!-- Live Report Section -->
      <div style="margin-bottom:var(--space-lg);">
        <h3 style="font-size:var(--text-sm);font-weight:600;color:var(--text-secondary);margin-bottom:var(--space-md);">
          🌡️ ¿Cómo está la fiesta? (opcional)
        </h3>
        <div class="report-grid" id="report-grid">
          ${REPORT_CATEGORIES.map(cat => `
            <div class="report-chip" data-report="${cat.id}">
              <span class="report-chip-emoji">${cat.emoji}</span>
              ${cat.label}
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  let selectedReports = [];
  let photoData = null;

  // Back
  container.querySelector('#back-btn').addEventListener('click', () => {
    router.navigate('select-party');
  });

  // Change party
  container.querySelector('#change-party').addEventListener('click', () => {
    router.navigate('select-party');
  });

  // Char counter
  const textarea = container.querySelector('#post-content');
  const counter = container.querySelector('#char-counter');
  textarea.addEventListener('input', () => {
    counter.textContent = `${textarea.value.length}/500`;
  });

  // Photo
  const photoBtn = container.querySelector('#add-photo');
  const fileInput = container.querySelector('#photo-file');
  const preview = container.querySelector('#photo-preview');
  const previewImg = container.querySelector('#preview-img');

  photoBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      // Downscale + JPEG-compress so post photos don't get stored as
      // multi-MB base64 (which bloats the feed query and localStorage).
      photoData = await fileToResizedDataURL(file, 1280, 0.82);
      previewImg.src = photoData;
      preview.style.display = 'block';
    } catch {
      showToast('No se pudo procesar la imagen', 'error');
    }
  });

  container.querySelector('#remove-photo').addEventListener('click', () => {
    photoData = null;
    preview.style.display = 'none';
    fileInput.value = '';
  });

  // Report chips
  container.querySelectorAll('.report-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
      const id = chip.dataset.report;
      if (selectedReports.includes(id)) {
        selectedReports = selectedReports.filter(r => r !== id);
      } else {
        selectedReports.push(id);
      }
    });
  });

  // Publish
  container.querySelector('#publish-btn').addEventListener('click', () => {
    const content = textarea.value.trim();
    if (!content && !photoData) {
      showToast('Escribe algo o agrega una foto', 'error');
      return;
    }

    if (!store.canUserPost(user.id)) {
      showToast('Has alcanzado el límite de 5 publicaciones diarias', 'warning');
      return;
    }

    // Check for duplicate content
    const recentPosts = store.getState().posts.filter(p => p.userId === user.id);
    const isDuplicate = recentPosts.some(p => p.content === content && p.partyId === partyId);
    if (isDuplicate) {
      showToast('Publicación duplicada. No suma puntos.', 'warning');
      return;
    }

    store.addPost({
      userId: user.id,
      partyId: partyId,
      type: photoData ? 'photo' : 'text',
      content: content,
      image: photoData,
    });

    // No optimistic success/points toast — those used to overlap with
    // any error toast from the API call landing ~200-500ms later, hiding
    // the failure reason from the user. The post appears immediately
    // on the wall; a toast fires only if the API actually rejects.
    router.navigate('wall');
  });
}
