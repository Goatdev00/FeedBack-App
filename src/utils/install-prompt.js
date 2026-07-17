// =====================================================================
// FEEDBACK — PWA install prompt (pre-login)
// =====================================================================
// Friendly "¡Bienvenidx!" modal shown on the login screen ONLY when:
//   1. The user is not signed in (login is the only caller — that's
//      where it gets fired from).
//   2. The page is NOT already running as an installed PWA
//      (display-mode: standalone, or iOS's navigator.standalone).
// Tone is warm + orange-brand (not a red alert) because this is the
// first visual contact with a new user — needs to build trust, not
// scare them off.
//
// Plus a third implicit filter: we don't fire on desktop. The user
// explicitly asked for "en el celular", so showing iOS/Android
// instructions to a desktop visitor would be noise. If neither isIos()
// nor isAndroid() matches we bail.
//
// "Continuar" dismisses the modal for this session. We DON'T persist the
// dismissal — the goal is to push installation hard. Next visit (still
// not in standalone) shows it again. Once the user opens from their
// homescreen, isStandalone() returns true and the modal never appears.
// =====================================================================

// Exportados: el banner de instalación del muro (components/install-banner)
// necesita el mismo trío de detecciones sin duplicarlas.
export function isIos() {
  const ua = (navigator.userAgent || '').toLowerCase();
  // iPadOS moderno se hace pasar por Mac en el UA — se delata por el
  // touch (mismo truco que usa permission-modal para el flujo de push).
  return /iphone|ipad|ipod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isAndroid() {
  const ua = (navigator.userAgent || '').toLowerCase();
  return /android/.test(ua);
}

export function isStandalone() {
  return (typeof window !== 'undefined' && (
    window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true
  ));
}

// Per-platform step lists. Plain HTML in the strings is safe because the
// content is hardcoded here, never user input.
const IOS_STEPS = [
  { icon: '⋯',  text: 'Toca los <strong>tres puntos (•••)</strong> abajo a la derecha de Safari.' },
  { icon: '🔗', text: 'Toca el botón <strong>Compartir</strong> y luego dale en <strong>"Ver más"</strong>.' },
  { icon: '📲', text: 'Desplázate y selecciona <strong>"Añadir a pantalla de inicio"</strong>.' },
  { icon: '✅', text: 'Toca <strong>"Añadir"</strong> en la esquina superior derecha.' },
  { icon: '🎉', text: 'Cierra Safari y abre la app desde el nuevo ícono en tu pantalla de inicio.' },
];

const ANDROID_STEPS = [
  { icon: '⋮',  text: 'Toca el <strong>menú de tres puntos</strong> arriba a la derecha de Chrome.' },
  { icon: '📲', text: 'Selecciona <strong>"Instalar aplicación"</strong> (o <strong>"Añadir a pantalla principal"</strong>).' },
  { icon: '✅', text: 'Confirma tocando <strong>"Instalar"</strong>.' },
  { icon: '🎉', text: 'Abre la app desde el nuevo ícono en tu pantalla principal.' },
];

export function showInstallPrompt() {
  // Self-filters: never show in standalone, never show on desktop.
  if (isStandalone()) return;
  const ios = isIos();
  const android = isAndroid();
  if (!ios && !android) return;

  // Bail if the overlay is already on the DOM (re-render of login can
  // re-call this; we don't want to stack instances).
  if (document.getElementById('pwa-install-overlay')) return;

  const steps     = ios ? IOS_STEPS  : ANDROID_STEPS;
  const deviceTag = ios ? 'iPhone'   : 'Android';

  const overlay = document.createElement('div');
  overlay.id = 'pwa-install-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 900;
    background: rgba(0, 0, 0, 0.88);
    display: flex; align-items: center; justify-content: center;
    padding: var(--space-md);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    animation: fadeIn 0.25s ease-out;
  `;

  overlay.innerHTML = `
    <div role="dialog" aria-modal="true" aria-labelledby="install-modal-title"
         style="
           max-width: 420px; width: 100%;
           background: var(--bg-card);
           border: 1px solid var(--border-orange);
           border-radius: var(--radius-lg);
           padding: var(--space-xl);
           box-shadow: 0 8px 40px rgba(255, 106, 0, 0.18);
           max-height: 90dvh;
           overflow-y: auto;
         ">
      <div style="text-align: center; margin-bottom: var(--space-lg);">
        <div style="font-size: 2.6rem; line-height: 1; margin-bottom: var(--space-sm);">👋</div>
        <h2 id="install-modal-title" style="
          color: var(--orange);
          font-family: var(--font-display);
          font-size: 2rem;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin: 0 0 var(--space-sm) 0;
          line-height: 1.1;
        ">¡Bienvenidx!</h2>
        <p style="
          color: var(--text-primary);
          font-size: 1rem;
          font-weight: 500;
          line-height: 1.5;
          margin: 0;
        ">
          Antes de continuar, sigue estos pasos para instalar FEEDBACK
          en tu ${deviceTag} y vivirlo como una app de verdad ✨
        </p>
      </div>

      <ol style="
        list-style: none;
        padding: 0;
        margin: 0 0 var(--space-xl) 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
      ">
        ${steps.map((s, i) => `
          <li style="
            display: flex;
            gap: var(--space-md);
            align-items: flex-start;
            background: rgba(255, 106, 0, 0.06);
            padding: var(--space-md);
            border-radius: var(--radius-md);
            border-left: 3px solid var(--orange);
          ">
            <div style="
              flex-shrink: 0;
              width: 30px; height: 30px;
              border-radius: 50%;
              background: var(--orange);
              color: white;
              display: flex; align-items: center; justify-content: center;
              font-weight: 800;
              font-size: 0.95rem;
              font-family: var(--font-display);
            ">${i + 1}</div>
            <div style="flex: 1; padding-top: 2px;">
              <span style="font-size: 1.3rem; margin-right: 6px;">${s.icon}</span>
              <span style="
                color: var(--text-primary);
                font-size: 0.95rem;
                line-height: 1.5;
              ">${s.text}</span>
            </div>
          </li>
        `).join('')}
      </ol>

      <button id="pwa-install-continue" style="
        width: 100%;
        padding: 14px var(--space-md);
        background: var(--orange);
        color: white;
        border: none;
        border-radius: var(--radius-md);
        font-size: 1rem;
        font-weight: 700;
        cursor: pointer;
        font-family: inherit;
        transition: transform 0.1s, box-shadow 0.2s;
        box-shadow: 0 4px 16px rgba(255, 106, 0, 0.3);
      ">
        ¡Listo, continuar! →
      </button>

      <p style="
        text-align: center;
        margin: var(--space-md) 0 0 0;
        font-size: 0.75rem;
        color: var(--text-tertiary);
        line-height: 1.5;
      ">
        Si ya la tienes instalada, ábrela desde tu pantalla principal
        y este aviso desaparece solo. 🧡
      </p>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#pwa-install-continue').addEventListener('click', () => {
    overlay.remove();
  });
}
