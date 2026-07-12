// ============================================
// FEEDBACK — Onboarding Flow
// ============================================

import { store, ICONS } from '../data/mock-data.js';
import { router } from '../router.js';
import { showToast } from '../utils/toast.js';
import { sanitize } from '../utils/helpers.js';
import { fileToResizedDataURL } from '../utils/image.js';
import { isSupabaseConfigured } from '../data/supabase.js';
import { patchProfile } from '../data/profile-sync.js';
import { resyncPushSubscription } from '../notifications/push.js';
import { showPermissionModal } from '../notifications/permission-modal.js';

const TOTAL_STEPS = 4;
const EMPTY_FORM = Object.freeze({
  name: '', username: '', role: '', city: '', bio: '', avatar: null,
});

// Module-scope step state. Reset on every entry to `renderOnboarding` so a
// fresh sign-in never inherits the previous user's draft.
let currentStep = 1;
let formData = { ...EMPTY_FORM };

function renderStep(container) {
  const progressPct = (currentStep / TOTAL_STEPS) * 100;

  let stepContent = '';

  switch (currentStep) {
    case 1:
      stepContent = `
        <div class="onboarding-title">¿Cómo te llamas?</div>
        <p class="onboarding-subtitle">Este será tu nombre visible en FEEDBACK</p>
        
        <div class="input-group mb-lg">
          <label class="input-label">Nombre visible</label>
          <input type="text" class="input" id="onb-name" placeholder="Ej: Carlos Rave" value="${sanitize(formData.name)}" maxlength="30" autocomplete="off" />
        </div>

        <div class="input-group mb-lg">
          <label class="input-label">Username único</label>
          <input type="text" class="input" id="onb-username" placeholder="@tuuser" value="${sanitize(formData.username)}" maxlength="20" autocomplete="off" />
          <span style="font-size:var(--text-xs);color:var(--text-muted);">Sin espacios, mínimo 3 caracteres</span>
        </div>
      `;
      break;

    case 2:
      stepContent = `
        <div class="onboarding-title">¿Qué tipo de perfil eres?</div>
        <p class="onboarding-subtitle">Esto define tu experiencia en FEEDBACK</p>
        
        <div class="role-selector">
          <div class="role-card ${formData.role === 'raver' ? 'selected' : ''}" data-role="raver">
            <span class="role-emoji">🎉</span>
            <div class="role-info">
              <h3>Raver</h3>
              <p>Vives la escena. Publicas, calificas y descubres fiestas.</p>
            </div>
          </div>
          <div class="role-card ${formData.role === 'dj' ? 'selected' : ''}" data-role="dj">
            <span class="role-emoji">🎧</span>
            <div class="role-info">
              <h3>DJ</h3>
              <p>Tocas en fiestas, te vinculas a eventos y muestras tu arte.</p>
            </div>
          </div>
          <div class="role-card role-locked" data-role="promotor" aria-disabled="true">
            <span class="role-emoji">✨</span>
            <div class="role-info">
              <h3>Promotor</h3>
              <p>Cuenta verificada por el equipo de FEEDBACK. Contáctanos para habilitar tu perfil.</p>
            </div>
          </div>
        </div>
      `;
      break;

    case 3:
      stepContent = `
        <div class="onboarding-title">Tu foto y ciudad</div>
        <p class="onboarding-subtitle">Hazle saber a la escena quién eres</p>

        <div class="photo-upload" id="photo-upload">
          ${formData.avatar
            ? `<img src="${formData.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`
            : `${ICONS.camera}<span>Subir foto</span>`
          }
        </div>
        <input type="file" id="photo-input" accept="image/*" style="display:none;" />

        <div class="input-group mb-lg">
          <label class="input-label">Ciudad principal</label>
          <select class="input" id="onb-city">
            <option value="" ${!formData.city ? 'selected' : ''} disabled>Selecciona tu ciudad</option>
            <option value="Bogotá" ${formData.city === 'Bogotá' ? 'selected' : ''}>Bogotá</option>
            <option value="Medellín" ${formData.city === 'Medellín' ? 'selected' : ''}>Medellín</option>
            <option value="Cali" ${formData.city === 'Cali' ? 'selected' : ''}>Cali</option>
            <option value="Barranquilla" ${formData.city === 'Barranquilla' ? 'selected' : ''}>Barranquilla</option>
            <option value="Cartagena" ${formData.city === 'Cartagena' ? 'selected' : ''}>Cartagena</option>
            <option value="Otra" ${formData.city === 'Otra' ? 'selected' : ''}>Otra</option>
          </select>
        </div>
      `;
      break;

    case 4:
      stepContent = `
        <div class="onboarding-title">Cuéntanos de ti</div>
        <p class="onboarding-subtitle">Una bio corta para tu perfil (opcional)</p>

        <div class="input-group mb-lg">
          <label class="input-label">Biografía</label>
          <textarea class="input textarea" id="onb-bio" placeholder="Ej: Techno lover desde 2019 🖤" maxlength="150">${sanitize(formData.bio)}</textarea>
          <span style="font-size:var(--text-xs);color:var(--text-muted);" id="bio-counter">${formData.bio.length}/150</span>
        </div>

        <div class="card" style="text-align:center;padding:var(--space-xl);">
          <div style="font-size:2rem;margin-bottom:var(--space-sm);">🎉</div>
          <h3 style="font-family:var(--font-display);margin-bottom:var(--space-xs);">¡Casi listo!</h3>
          <p style="font-size:var(--text-sm);color:var(--text-secondary);">
            Empieza con <strong style="color:var(--orange);">50 puntos</strong> de bienvenida
          </p>
        </div>
      `;
      break;
  }

  container.innerHTML = `
    <div class="onboarding" id="onboarding-page">
      <div class="onboarding-progress">
        <div class="onboarding-step-label">Paso ${currentStep} de ${TOTAL_STEPS}</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width:${progressPct}%"></div>
        </div>
      </div>

      <div style="flex:1;">
        ${stepContent}
      </div>

      <div style="display:flex;gap:var(--space-md);margin-top:var(--space-xl);">
        ${currentStep > 1
          ? `<button class="btn btn-secondary" id="onb-back" style="flex:0.4;">${ICONS.back}</button>`
          : ''
        }
        <button class="btn btn-primary btn-full" id="onb-next">
          ${currentStep === TOTAL_STEPS ? 'Empezar' : 'Siguiente'}
        </button>
      </div>
    </div>
  `;

  bindStepEvents(container);
}

function bindStepEvents(container) {
  // Back button
  const backBtn = container.querySelector('#onb-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      saveCurrentStepData(container);
      currentStep--;
      renderStep(container);
    });
  }

  // Next button
  const nextBtn = container.querySelector('#onb-next');
  nextBtn.addEventListener('click', () => {
    if (!validateStep(container)) return;
    saveCurrentStepData(container);

    if (currentStep === TOTAL_STEPS) {
      finishOnboarding(nextBtn);
    } else {
      currentStep++;
      renderStep(container);
    }
  });

  // Step-specific bindings
  if (currentStep === 2) {
    container.querySelectorAll('.role-card').forEach(card => {
      card.addEventListener('click', () => {
        // Locked roles (currently: promotor — issued manually by the
        // team) silently absorb the click and surface a friendly toast
        // explaining the gate. No selection state changes.
        if (card.classList.contains('role-locked')) {
          showToast('Las cuentas de Promotor las verificamos manualmente. Escríbenos por Instagram para habilitarte.', 'info', 4500);
          return;
        }
        container.querySelectorAll('.role-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        formData.role = card.dataset.role;
      });
    });
  }

  if (currentStep === 3) {
    const uploadBtn = container.querySelector('#photo-upload');
    const fileInput = container.querySelector('#photo-input');
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        // Downscale before storing — a raw camera photo as base64 is
        // multi-MB and breaks profile reads + localStorage.
        formData.avatar = await fileToResizedDataURL(file);
        uploadBtn.innerHTML = `<img src="${formData.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`;
      } catch {
        showToast('No se pudo procesar la imagen', 'error');
      }
    });
  }

  if (currentStep === 4) {
    const textarea = container.querySelector('#onb-bio');
    const counter = container.querySelector('#bio-counter');
    if (textarea && counter) {
      textarea.addEventListener('input', () => {
        counter.textContent = `${textarea.value.length}/150`;
      });
    }
  }
}

function saveCurrentStepData(container) {
  switch (currentStep) {
    case 1:
      formData.name = container.querySelector('#onb-name')?.value?.trim() || formData.name;
      let uname = container.querySelector('#onb-username')?.value?.trim() || formData.username;
      if (uname && !uname.startsWith('@')) uname = '@' + uname;
      formData.username = uname;
      break;
    case 3:
      formData.city = container.querySelector('#onb-city')?.value || formData.city;
      break;
    case 4:
      formData.bio = container.querySelector('#onb-bio')?.value?.trim() || formData.bio;
      break;
  }
}

function validateStep(container) {
  switch (currentStep) {
    case 1: {
      const name = container.querySelector('#onb-name')?.value?.trim();
      const username = container.querySelector('#onb-username')?.value?.trim();
      if (!name || name.length < 2) {
        showToast('Escribe tu nombre (mínimo 2 caracteres)', 'error');
        return false;
      }
      if (!username || username.replace('@', '').length < 3) {
        showToast('Username debe tener mínimo 3 caracteres', 'error');
        return false;
      }
      return true;
    }
    case 2:
      if (!formData.role) {
        showToast('Selecciona tu tipo de perfil', 'error');
        return false;
      }
      return true;
    case 3: {
      const city = container.querySelector('#onb-city')?.value;
      if (!city) {
        showToast('Selecciona tu ciudad', 'error');
        return false;
      }
      return true;
    }
    case 4:
      return true;
  }
  return true;
}

async function finishOnboarding(submitBtn) {
  // Username normalization: strip leading "@", lowercase, only alphanum+_
  const username = formData.username.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!username || username.length < 3) {
    showToast('Username inválido (min. 3 caracteres, sin espacios)', 'error');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.style.pointerEvents = 'none';
    submitBtn.innerHTML = '<div class="spinner" style="width:18px;height:18px;border-width:2px;"></div>';
  }

  if (isSupabaseConfigured()) {
    try {
      await patchProfile({
        name: formData.name,
        username,
        role: formData.role,
        city: formData.city,
        bio: formData.bio || null,
        avatar_url: formData.avatar || null,
        onboarding_complete: true,
      });
      store.setState({ selectedCity: formData.city });
    } catch (err) {
      console.error('[onboarding]', err);
      const detail = err?.message?.includes('duplicate')
        ? 'Ese username ya está en uso. Prueba otro.'
        : 'No se pudo guardar el perfil. Intenta de nuevo.';
      showToast(detail, 'error', 4000);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.style.pointerEvents = '';
        submitBtn.innerHTML = 'Empezar';
      }
      return;
    }
  } else {
    // Legacy fallback when Supabase isn't configured (dev demo only).
    const newUser = {
      id: 'u_self',
      name: formData.name, username: '@' + username, role: formData.role,
      city: formData.city, bio: formData.bio || '', avatar: formData.avatar,
      points: 50, followers: 0, following: 0, badges: [], partiesAttended: [],
      postsToday: 0, premium: false,
      social: { instagram: '', tiktok: '', twitter: '' }, theme: 'dark',
    };
    const state = store.getState();
    store.setState({
      currentUser: newUser,
      users: [newUser, ...state.users],
      onboardingComplete: true,
      selectedCity: formData.city,
    });
  }

  showToast('¡Bienvenido a FEEDBACK! +50 pts de bienvenida 🎉', 'points');
  currentStep = 1;
  formData = { ...EMPTY_FORM };
  router.navigate('wall');

  // First-session push offer. routeAfterSession only schedules it on its
  // own paths, and this direct navigate('wall') bypasses them — without
  // this, the freshly-onboarded user (peak engagement) never saw the
  // notifications ask until their NEXT visit.
  setTimeout(() => {
    const uid = store.getState().currentUser?.id;
    if (!uid) return;
    resyncPushSubscription(uid);
    showPermissionModal(uid);
  }, 1500);
}

export function renderOnboarding(container) {
  currentStep = 1;
  formData = { ...EMPTY_FORM };
  renderStep(container);
}
