// =====================================================================
// FEEDBACK / PartyRate — push permission modal (+ iOS install flow)
// =====================================================================
// Decides, once per boot (called from main.js schedulePushOffer), what
// to show about notifications:
//
//   * Android / desktop, no decision yet  → permission modal.
//   * iOS Safari TAB                      → install guide. Apple only
//     exposes PushManager inside an INSTALLED PWA (iOS ≥16.4), so on a
//     Safari tab `isPushSupported()` is false BY DESIGN — the old code
//     bailed on that check first and iPhone users never saw any path to
//     notifications at all. The guide walks them through "Añadir a
//     pantalla de inicio"; once they reopen from the icon, standalone
//     mode exposes PushManager and the normal modal takes over.
//   * Already granted                     → nothing (the silent boot
//     resync in push.js keeps the subscription alive).
//   * Browser-level denied                → nothing we can do.
//
// Decisions persist in localStorage as JSON { decision, at } and some
// of them EXPIRE so the ask can come back later:
//   granted      → permanent (resync owns it from here)
//   dismissed    → re-offer after 14 days
//   ios-install  → re-offer after 3 days (install friction is high; a
//                  gentle reminder is the only growth lever we have)
// Legacy plain-string values from the previous version are migrated on
// read ('granted' stays permanent; 'dismissed' counts as expired so the
// user gets exactly one re-ask under the new policy).
// =====================================================================

import { isPushSupported, subscribeToPush, resyncPushSubscription } from './push.js';
import { showToast } from '../utils/toast.js';

const DECISION_KEY = 'push-permission-decision';
const REOFFER_DAYS = { dismissed: 14, 'ios-install': 3 };
const DAY_MS = 86_400_000;

function isIos() {
  const ua = (navigator.userAgent || '').toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return true;
  // iPadOS 13+ masquerades as macOS but is the only "Mac" with touch.
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
}

function isStandalone() {
  return (typeof window !== 'undefined'
    && (
      window.matchMedia?.('(display-mode: standalone)').matches
      || window.navigator.standalone === true
    ));
}

function readDecision() {
  let raw = null;
  try { raw = localStorage.getItem(DECISION_KEY); } catch { /* ignore */ }
  if (!raw) return null;
  // Legacy plain strings ('granted' / 'dismissed') from the previous
  // version: granted stays permanent; dismissed maps to at=0 (expired)
  // so the user gets one re-ask under the new expiry policy.
  if (raw === 'granted' || raw === 'dismissed') return { decision: raw, at: 0 };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.decision === 'string') return parsed;
  } catch { /* ignore */ }
  return null;
}

function writeDecision(decision, extra = {}) {
  try {
    localStorage.setItem(DECISION_KEY, JSON.stringify({ decision, at: Date.now(), ...extra }));
  } catch { /* ignore */ }
}

// Wipe the device-scoped decision. Called on logout so the NEXT account
// on this device gets a fresh ask instead of inheriting the previous
// user's "dismissed"/install-guide backoff (which silently left brand-new
// users with zero subscriptions).
export function clearPushDecision() {
  try { localStorage.removeItem(DECISION_KEY); } catch { /* ignore */ }
}

function decisionStillBlocks(d) {
  if (!d) return false;
  if (d.decision === 'granted') return true;
  const days = REOFFER_DAYS[d.decision];
  // Unknown/corrupt decision value: do NOT block forever — nothing ever
  // clears the key, so "be conservative" meant "never ask again". Re-offer
  // and let the next real decision overwrite it.
  if (days == null) return false;
  let effectiveDays = days;
  // The iOS install guide backs off exponentially (3d → 6d → 12d → 24d,
  // capped at 30d): Safari-tab localStorage never learns about an
  // install (iOS partitions storage between tab and PWA), so without a
  // backoff the guide would nag forever at full cadence.
  if (d.decision === 'ios-install') {
    effectiveDays = Math.min(30, days * Math.pow(2, Math.max(0, (d.n || 1) - 1)));
  }
  return (Date.now() - (d.at || 0)) < effectiveDays * DAY_MS;
}

// Shared overlay scaffolding for both modals.
function mountOverlay(innerHtml) {
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
  overlay.innerHTML = innerHtml;
  document.body.appendChild(overlay);
  return overlay;
}

// `force: true` (the manual "Notificaciones" entry in Configuración)
// bypasses the decision snooze AND explains the states the automatic boot
// offer handles silently — the user explicitly asked, so silence would
// read as "the button is broken".
export function showPermissionModal(userId, { force = false } = {}) {
  if (!userId) return;
  if (!force && decisionStillBlocks(readDecision())) return;

  // Browser-level states we can't act on from a modal.
  if (typeof Notification !== 'undefined') {
    if (Notification.permission === 'denied') {
      if (force) showToast('Las notificaciones están bloqueadas en tu navegador. Actívalas desde los ajustes del sitio.', 'warning', 6000);
      return;
    }
    if (Notification.permission === 'granted') {
      // Granted out-of-band (or before this modal existed): record it
      // and let the boot resync own the subscription from here.
      writeDecision('granted');
      if (force) {
        // Self-heal: re-register this device's subscription right now.
        resyncPushSubscription(userId);
        // Prueba REAL a nivel de sistema: mostramos una notificación local
        // vía el SW. Confirma de una vez que el dispositivo las pinta
        // (atrapa el caso iOS "permiso concedido pero notificaciones del
        // sistema desactivadas para la app", que un toast no detecta).
        (async () => {
          try {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg) {
              await reg.showNotification('Notificaciones activas', {
                body: 'Así se verán las notificaciones de PartyRate en este dispositivo.',
                icon: '/logo-192.png',
                tag: 'self-test',
                // Sin data.url el click del SW navegaría a '/' — si el
                // documento se cargó con hash (F5 en #/profile), eso es un
                // hard-reload que saca al usuario de Configuración. Con la
                // ruta actual, el click solo enfoca la ventana.
                data: { url: `/${window.location.hash || ''}` || '/' },
              });
              showToast('Notificaciones activas — te mostramos una de prueba', 'success', 5000);
              return;
            }
          } catch { /* cae al toast simple */ }
          showToast('Las notificaciones ya están activas en este dispositivo', 'success');
        })();
      }
      return;
    }
  }

  // iOS in a Safari tab: PushManager doesn't exist here — guide the
  // install instead of bailing on isPushSupported().
  if (isIos() && !isStandalone()) {
    showIosInstallGuide(readDecision());
    return;
  }

  if (!isPushSupported()) {
    if (force) showToast('Este navegador no soporta notificaciones push.', 'warning');
    return;
  }

  const overlay = mountOverlay(`
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
  `);

  let isOpen = true;

  function close() {
    if (!isOpen) return;
    isOpen = false;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }

  function onKey(e) {
    // Escape is an accidental/ambivalent gesture — close WITHOUT writing
    // the 14-day 'dismissed' snooze (that's reserved for the explicit
    // "Ahora no" button). The offer simply comes back next boot.
    if (e.key === 'Escape') close();
  }

  function dismiss() {
    writeDecision('dismissed');
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
        writeDecision('granted');
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
    // A stray tap outside the modal box is NOT an informed "no" — close
    // without recording a decision so the ask returns next boot. Only the
    // explicit "Ahora no" button snoozes for 14 days.
    if (e.target === overlay) close();
  });
  overlay.querySelector('#push-modal-activate').addEventListener('click', activate);
  overlay.querySelector('#push-modal-dismiss').addEventListener('click', dismiss);
  document.addEventListener('keydown', onKey);
}

// ---------------------------------------------------------------------
// iOS install guide — the prerequisite step for push on iPhone/iPad.
// Once the user reopens the app from the home-screen icon (standalone),
// the regular permission modal takes over on the next boot.
// ---------------------------------------------------------------------
// Entrada pública para el banner de instalación del muro: abre la guía
// directamente (el usuario ya tocó "Cómo instalar" — sin snooze de por
// medio) reutilizando el contador de re-ofertas existente. Guard de
// re-entrada: un doble tap rápido apilaría dos overlays idénticos.
export function openIosInstallGuide() {
  if (document.querySelector('.push-permission-modal')) return;
  showIosInstallGuide(readDecision());
}

function showIosInstallGuide(priorDecision) {
  const overlay = mountOverlay(`
    <div class="modal push-permission-modal"
         role="dialog" aria-modal="true" aria-labelledby="ios-guide-title"
         style="
            max-width: 360px; width: 100%;
            background: var(--bg-card);
            border: 1px solid var(--border-subtle);
            border-radius: var(--radius-lg);
            padding: var(--space-xl);
            box-shadow: var(--shadow-xl);
         ">
      <div style="font-size: 2.4rem; text-align: center; margin-bottom: var(--space-md);"
           aria-hidden="true">📲</div>

      <h2 id="ios-guide-title"
          style="
            font-family: var(--font-display);
            font-size: var(--text-xl);
            font-weight: 700;
            text-align: center;
            margin: 0 0 var(--space-sm);
            color: var(--text-primary);
          ">
        Instala PartyRate en tu iPhone
      </h2>

      <p style="
            font-size: var(--text-sm);
            color: var(--text-secondary);
            text-align: center;
            line-height: 1.5;
            margin: 0 0 var(--space-md);
         ">
        Para recibir notificaciones en iPhone, primero añade la app a tu
        pantalla de inicio (necesitas iOS 16.4 o superior, en Safari):
      </p>

      <ol style="
            font-size: var(--text-sm);
            color: var(--text-secondary);
            line-height: 1.9;
            margin: 0 0 var(--space-lg);
            padding-left: var(--space-lg);
          ">
        <li>Toca el botón <strong>Compartir</strong> <span aria-hidden="true" style="display:inline-block;transform:translateY(1px);">⎙</span> de Safari</li>
        <li>Elige <strong>«Añadir a pantalla de inicio»</strong></li>
        <li>Abre <strong>PartyRate desde el icono</strong> y activa las notificaciones cuando te lo pida</li>
      </ol>

      <div style="display: flex; flex-direction: column; gap: var(--space-sm);">
        <button id="ios-guide-ok" class="btn btn-primary btn-full">Entendido</button>
      </div>
    </div>
  `);

  function close() {
    // Track how many times the guide has been shown so the re-offer
    // backs off (see decisionStillBlocks).
    const n = (priorDecision?.decision === 'ios-install' ? (priorDecision.n || 1) : 0) + 1;
    writeDecision('ios-install', { n });
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('#ios-guide-ok').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
}
