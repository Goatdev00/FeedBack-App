// =====================================================================
// FEEDBACK — Banner de instalación iOS (adopción de push)
// =====================================================================
// El embudo de notificaciones en iPhone tiene UN prerequisito duro de
// Apple: la PWA debe estar instalada en la pantalla de inicio. El modal
// de onboarding lo cuenta una vez, pero un usuario iOS logueado que
// sigue en Safari no vuelve a ver ninguna invitación — y sin instalar,
// jamás recibirá un push. Este banner cierra ese hueco:
//   * Solo iOS + NO standalone + sesión iniciada (el muro lo pinta).
//   * Compacto, arriba del feed, con cierre explícito.
//   * Cerrarlo lo silencia 3 días (localStorage, por dispositivo) — la
//     insistencia suave gana instalaciones; la insistencia agresiva
//     gana desinstalaciones de usuarios.
//   * "Cómo instalar" abre la guía paso a paso ya existente del flujo
//     de permisos (openIosInstallGuide) — una sola fuente de verdad.
// Android queda fuera a propósito: allí el push funciona sin instalar.
// =====================================================================

import { isIos, isStandalone } from '../utils/install-prompt.js';
import { openIosInstallGuide } from '../notifications/permission-modal.js';

const DISMISS_KEY = 'feedback_ios_install_banner_at';
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000; // 3 días

function snoozed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

/** HTML del banner, o '' si no aplica (no-iOS, ya instalada, o en snooze).
 *  Función pura de entorno + localStorage: sobrevive los repaints del
 *  muro sin estado propio. */
export function iosInstallBannerHTML() {
  if (!isIos() || isStandalone() || snoozed()) return '';
  return `
    <div class="install-banner" id="ios-install-banner" role="note">
      <div class="install-banner-text">
        <strong>Instala la app en tu iPhone</strong>
        <span>Es el único modo de que te lleguen las notificaciones.</span>
      </div>
      <button class="btn btn-primary btn-sm" id="ios-banner-cta">Cómo instalar</button>
      <button class="install-banner-close" id="ios-banner-close" aria-label="Cerrar">✕</button>
    </div>
  `;
}

/** Cablea CTA y cierre. Llamar tras pintar un contenedor que incluya el
 *  banner; no-op si el banner no está en el DOM. */
export function bindIosInstallBanner(container) {
  const banner = container.querySelector('#ios-install-banner');
  if (!banner) return;
  banner.querySelector('#ios-banner-cta').addEventListener('click', () => {
    openIosInstallGuide();
  });
  banner.querySelector('#ios-banner-close').addEventListener('click', () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* sin storage, reaparece */ }
    banner.remove();
  });
}
