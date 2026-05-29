// =====================================================================
// FEEDBACK — On-screen debug console (mobile-friendly)
// =====================================================================
// iOS Safari has no reachable DevTools console without a tethered Mac.
// When the URL contains `?debug` (e.g. https://partyrate.site/?debug),
// this mirrors console.log/info/warn/error into a fixed panel pinned to
// the bottom of the screen, so timings and errors can be read — and
// screenshotted — directly on the phone.
//
// No-op unless ?debug is present, so it costs nothing for real users and
// is safe to ship.
// =====================================================================

export function initDebugOverlay() {
  if (!/[?&]debug\b/.test(window.location.search)) return;

  const panel = document.createElement('div');
  panel.id = 'debug-overlay';
  Object.assign(panel.style, {
    position: 'fixed',
    left: '0',
    right: '0',
    bottom: '0',
    maxHeight: '45vh',
    overflowY: 'auto',
    zIndex: '99999',
    background: 'rgba(0,0,0,0.88)',
    color: '#0f0',
    font: '11px/1.4 ui-monospace, Menlo, monospace',
    padding: '8px 10px calc(8px + env(safe-area-inset-bottom))',
    borderTop: '1px solid #0f0',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  });

  const header = document.createElement('div');
  header.textContent = 'DEBUG — toca para copiar / mantén para ocultar';
  Object.assign(header.style, { color: '#ff0', marginBottom: '4px', fontWeight: '700' });
  panel.appendChild(header);

  const body = document.createElement('div');
  panel.appendChild(body);

  const start = performance.now();
  function append(kind, args) {
    const line = document.createElement('div');
    const t = Math.round(performance.now() - start);
    const msg = args
      .map((a) => {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch { return String(a); }
      })
      .join(' ');
    line.textContent = `+${t}ms  ${msg}`;
    if (kind === 'warn') line.style.color = '#fb0';
    if (kind === 'error') line.style.color = '#f44';
    body.appendChild(line);
    panel.scrollTop = panel.scrollHeight;
  }

  // Tap header to copy the whole log to clipboard; long-press to hide.
  header.addEventListener('click', () => {
    const text = body.innerText;
    navigator.clipboard?.writeText(text).then(
      () => { header.textContent = '¡Copiado! ✓'; setTimeout(() => { header.textContent = 'DEBUG — toca para copiar'; }, 1500); },
      () => {}
    );
  });
  let pressTimer = 0;
  header.addEventListener('touchstart', () => {
    pressTimer = window.setTimeout(() => { panel.style.display = 'none'; }, 600);
  });
  header.addEventListener('touchend', () => clearTimeout(pressTimer));

  const wrap = (orig, kind) => (...args) => { append(kind, args); orig.apply(console, args); };
  console.log = wrap(console.log.bind(console), 'log');
  console.info = wrap(console.info.bind(console), 'info');
  console.warn = wrap(console.warn.bind(console), 'warn');
  console.error = wrap(console.error.bind(console), 'error');

  // Surface uncaught errors + promise rejections too — these often hide
  // the real cause of "it just hangs".
  window.addEventListener('error', (e) => append('error', ['window.error:', e.message]));
  window.addEventListener('unhandledrejection', (e) => append('error', ['unhandledrejection:', e.reason?.message || e.reason]));

  document.body.appendChild(panel);
  console.info('[debug] overlay activo');
}
