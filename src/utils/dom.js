// ============================================
// FEEDBACK — Shared DOM helpers
// ============================================

/** Stable string → positive int hash (used for color seeds, gradients). */
export function hashStr(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

// Tracks previous handlers per (element, key) so we can detach the prior one
// before attaching a new one. Without this, pages that re-render into the
// persistent #app container stack listeners on every internal re-render.
const handlerRegistry = new WeakMap();

/**
 * Attach a listener, transparently detaching any previously-registered handler
 * for the same `(element, key)` pair first. Safe to call on every render.
 */
export function replaceListener(el, eventName, handler, key) {
  if (!el) return;
  const id = key || eventName;
  let perEl = handlerRegistry.get(el);
  if (!perEl) {
    perEl = new Map();
    handlerRegistry.set(el, perEl);
  }
  const prev = perEl.get(id);
  if (prev) el.removeEventListener(prev.eventName, prev.handler);
  el.addEventListener(eventName, handler);
  perEl.set(id, { eventName, handler });
}

/**
 * Detach a listener previously registered through `replaceListener`. Used by
 * pages that want to clean up when they're sure they're going away.
 */
export function detachListener(el, key) {
  if (!el) return;
  const perEl = handlerRegistry.get(el);
  const prev = perEl?.get(key);
  if (!prev) return;
  el.removeEventListener(prev.eventName, prev.handler);
  perEl.delete(key);
}

/**
 * Mount a modal overlay with bottom-sheet animation.
 * Outside-click and Escape both dismiss it. The returned overlay has a
 * `.close()` method for programmatic dismissal.
 */
export function createModal(innerHTML, { onClose } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = innerHTML;
  document.body.appendChild(overlay);

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    if (!overlay.isConnected) return;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);

  overlay.close = close;
  return overlay;
}
