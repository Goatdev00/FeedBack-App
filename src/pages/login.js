// ============================================
// FEEDBACK — Login / Splash Screen
// ============================================

import { ICONS } from '../data/mock-data.js';
import { showToast } from '../utils/toast.js';
import { signInWithGoogle } from '../data/auth.js';
import { isSupabaseConfigured } from '../data/supabase.js';
import { showInstallPrompt } from '../utils/install-prompt.js';

export function renderLogin(container) {
  // Before drawing the Google button, push the PWA install instructions
  // if the user is on mobile (iOS/Android) and not already in standalone
  // mode. The helper self-filters: standalone or desktop → no-op. Login
  // is the only place that calls this — by the time we hit renderLogin
  // we know the user isn't signed in.
  showInstallPrompt();

  container.innerHTML = `
    <div class="splash-screen" id="login-page">
      <div class="splash-bg"></div>

      <div style="position:relative;z-index:2;width:100%;display:flex;flex-direction:column;align-items:center;">
        <img src="/logo-transparent.png" alt="FEEDBACK" class="splash-icon" />
        <p class="splash-tagline">Live the Scene</p>

        <p style="font-size:0.8125rem;color:var(--text-tertiary);max-width:280px;text-align:center;margin-bottom:48px;line-height:1.6;">
          Tu radar social de fiestas en tiempo real.<br>
          Publica, califica y vive la escena.
        </p>

        <button class="google-btn" id="btn-google-login">
          ${ICONS.google}
          Continuar con Google
        </button>

        <p style="font-size:0.6875rem;color:var(--text-muted);margin-top:24px;max-width:240px;text-align:center;line-height:1.5;">
          Al continuar, aceptas los Términos de Servicio y la Política de Privacidad.
        </p>

        <div style="position:fixed;bottom:32px;left:50%;transform:translateX(-50%);display:flex;gap:8px;opacity:0.2;">
          <span style="font-size:0.625rem;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase;">Bogotá · Medellín · Cali</span>
        </div>
      </div>
    </div>
  `;

  // Entrance animation — animate the logo image itself now that the
  // FEEDBACK heading has been removed from the splash.
  const logo = container.querySelector('.splash-icon');
  if (logo) {
    logo.style.opacity = '0';
    logo.style.transform = 'translateY(20px)';
    logo.style.transition = 'opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), transform 0.8s cubic-bezier(0.16, 1, 0.3, 1)';
    requestAnimationFrame(() => {
      logo.style.opacity = '1';
      logo.style.transform = 'translateY(0)';
    });
  }

  const btn = container.querySelector('#btn-google-login');
  btn.addEventListener('click', async () => {
    if (!isSupabaseConfigured()) {
      showToast('Supabase no está configurado. Revisa .env y SETUP.md.', 'error', 5000);
      return;
    }
    btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;"></div> Conectando...';
    btn.style.pointerEvents = 'none';
    try {
      await signInWithGoogle();
      // The browser is now redirecting to Google. Nothing else to do —
      // when we come back, main.js bootstraps the session.
    } catch (err) {
      console.error('[login]', err);
      showToast('No se pudo iniciar sesión. Intenta de nuevo.', 'error');
      btn.innerHTML = `${ICONS.google} Continuar con Google`;
      btn.style.pointerEvents = '';
    }
  });
}
