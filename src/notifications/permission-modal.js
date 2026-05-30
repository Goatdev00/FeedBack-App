// =====================================================================
// FEEDBACK / PartyRate — push permission modal
// =====================================================================
// One-time prompt that asks the user to enable web push. Stays out of
// the way after the first answer (granted OR dismissed). Uses the
// existing design tokens (--bg-*, --text-*, --space-*, --radius-*,
// --shadow-*, --font-display) so it inherits the rest of the UI's look
// without hardcoded colors.
// =====================================================================

import { isPushSupported, subscribeToPush } from './push.js';

const DECISION_KEY = 'push-permission-decision';

function isIos() {
  const ua = (navigator.userAgent || '').toLowerCase();
  return /iphone|ipad|ipod/.test(ua);
}

function isStandalone() {
  return (typeof window !== 'undefined'
    && (
      window.matchMedia?.('(display-mode: standalone)').matches
      || window.navigator.standalone === true
    ));
}

export function showPermissionModal(userId) {
  // Bail early — every short-circuit here avoids piling state on the DOM.
  if (!isPushSupported()) return;
  let prior = null;
  try { prior = localStorage.getItem(DECISION_KEY); } catch { /* ignore */ }
  if (prior === 'granted' || prior === 'dismissed') return;
  if (!userId) return;

  const showIosHint = isIos() && !isStandalone();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay push-permission-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 700;
    background: var(--bg-overlay);
    display: flex; align-items: center; justify-content: center;
    padding: var(--space-md);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  `;

  overlay.innerHTML = `
    <div class="modal push-permission-modal"
         role="dialog" aria-modal="true" aria-labelledby="push-modal-title"
         style="
            max-width: 360px; width: 100%;
            background: var(--bg-card);
            border: 1px solid var(--border-subtle);
            border-radius: var(--radius-lg);
            padding: var(--space-xl);
            box-shadow: var(--shadow-xl);
         ">
      <div style="font-size: 2.4rem; text-align: center; margin-bottom: var(--space-md);"
           aria-hidden="true">🔔</div>

      <h2 id="push-modal-title"
          style="
            font-family: var(--font-display);
            font-size: var(--text-xl);
            font-weight: 700;
            text-align: center;
            margin: 0 0 var(--space-sm);
            color: var(--text-primary);
          ">
        Activa las notificaciones
      </h2>

      <p style="
            font-size: var(--text-sm);
            color: var(--text-secondary);
            text-align: center;
            line-height: 1.5;
            margin: 0 0 var(--space-lg);
         ">
        Activa las notificaciones para saber cuando alguien comenta, da like o te sigue
      </p>

      ${showIosHint ? `
        <p style="
            font-size: var(--text-xs);
            color: var(--text-tertiary);
            text-align: center;
            margin: 0 0 var(--space-lg);
            padding: var(--space-sm) var(--space-md);
            background: rgba(255,255,255,0.04);
            border: 1px solid var(--border-subtle);
            border-radius: var(--radius-md);
          ">
          En iPhone, primero añade PartyRate a tu pantalla de inicio
        </p>
      ` : ''}

      <div id="push-modal-status"
           role="status" aria-live="polite"
           style="
             font-size: var(--text-xs);
             color: #ff8080;
             text-align: center;
             min-height: 1.2em;
             margin-bottom: var(--space-sm);
           "></div>

      <div style="display: flex; flex-direction: column; gap: var(--space-sm);">
        <button id="push-modal-activate"
                class="btn btn-primary btn-full">
          Activar notificaciones
        </button>
        <button id="push-modal-dismiss"
                class="btn btn-ghost btn-full">
          Ahora no
        </button>
      </div>
    </div>
  `;

  let isOpen = true;

  function close() {
    if (!isOpen) return;
    isOpen = false;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }

  function onKey(e) {
    if (e.key === 'Escape') dismiss();
  }

  function dismiss() {
    try { localStorage.setItem(DECISION_KEY, 'dismissed'); } catch { /* ignore */ }
    close();
  }

  async function activate() {
    const statusEl   = overlay.querySelector('#push-modal-status');
    const activateEl = overlay.querySelector('#push-modal-activate');
    if (statusEl)   statusEl.textContent = '';
    if (activateEl) activateEl.setAttribute('disabled', 'true');

    try {
      const result = await subscribeToPush(userId);
      if (result?.granted) {
        try { localStorage.setItem(DECISION_KEY, 'granted'); } catch { /* ignore */ }
        close();
        return;
      }
      // Permission denied or dismissed at the browser prompt.
      if (statusEl) {
        statusEl.textContent = result?.permission === 'denied'
          ? 'Permiso denegado. Actívalo desde los ajustes del navegador.'
          : 'No se pudieron activar las notificaciones.';
      }
      if (activateEl) activateEl.removeAttribute('disabled');
    } catch (err) {
      console.warn('[push-modal] subscribe failed', err);
      if (statusEl) {
        const code = err?.message || '';
        statusEl.textContent = code === 'push_not_supported'
          ? 'Tu navegador no soporta notificaciones push.'
          : code === 'vapid_key_missing'
            ? 'Falta configuración (VAPID). Avisa al equipo.'
            : 'No se pudieron activar las notificaciones.';
      }
      if (activateEl) activateEl.removeAttribute('disabled');
    }
  }

  overlay.addEventListener('click', (e) => {
    // Click on the overlay (not on the modal box) = dismiss.
    if (e.target === overlay) dismiss();
  });
  overlay.querySelector('#push-modal-activate').addEventListener('click', activate);
  overlay.querySelector('#push-modal-dismiss').addEventListener('click', dismiss);
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
}
