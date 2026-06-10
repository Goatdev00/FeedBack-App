// =====================================================================
// FEEDBACK — Image protection
// =====================================================================
// Removes the browser's default "save / copy / drag" affordances on
// photos when the user long-presses (mobile) or right-clicks (desktop):
//
//   * iOS Safari   — the long-press callout ("Guardar imagen", "Copiar")
//                    is suppressed mainly by `-webkit-touch-callout:none`
//                    in main.css; this also cancels the events as backup.
//   * Android Chrome / desktop — long-press / right-click open a
//                    `contextmenu` event ("Descargar imagen", "Copiar
//                    imagen"); we preventDefault it. touch-callout is
//                    WebKit-only, so this JS is what covers Android.
//   * Desktop      — dragging the photo onto the desktop to save it fires
//                    `dragstart`; we preventDefault that too.
//
// HONEST LIMITATION: this only closes the *convenient* paths. A
// determined user can still screenshot, open DevTools, read the network
// tab, or hit the image URL directly. Real protection would need
// signed/expiring URLs + server-side watermarking. This is deterrence,
// not DRM — set expectations accordingly.
//
// Listeners are delegated on `document` (not bound per <img>) so they
// also cover images injected later: the SPA rewrites page innerHTML on
// every route change and hydration repaint, so per-element binding would
// miss most photos. Scoped to <img> only, so taps that open a party,
// button clicks and text selection are all left untouched.
// =====================================================================

function isImage(el) {
  return !!el && el.tagName === 'IMG';
}

export function initImageProtection() {
  // Long-press (Android) + right-click (desktop) "save/copy image" menu.
  document.addEventListener('contextmenu', (e) => {
    if (isImage(e.target)) e.preventDefault();
  });

  // Drag-the-image-out-to-save (desktop).
  document.addEventListener('dragstart', (e) => {
    if (isImage(e.target)) e.preventDefault();
  });
}
