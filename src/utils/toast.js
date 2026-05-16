// ============================================
// FEEDBACK — Toast Notification System
// ============================================

const ICON_MAP = {
  success: '✅',
  error: '❌',
  info: '🔔',
  points: '⚡',
  warning: '⚠️',
};

let toastContainer = null;
let dismissTimer = null;
let removeTimer = null;

function ensureContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    toastContainer.id = 'toast-container';
    toastContainer.setAttribute('aria-live', 'polite');
    toastContainer.setAttribute('role', 'status');
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

export function showToast(message, type = 'info', duration = 3000) {
  const container = ensureContainer();

  // Cancel any in-flight dismissal so the new toast renders cleanly.
  if (dismissTimer) clearTimeout(dismissTimer);
  if (removeTimer) clearTimeout(removeTimer);
  container.innerHTML = '';

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${ICON_MAP[type] || ICON_MAP.info}</span>
    <span></span>
  `;
  // textContent on the inner span keeps user-supplied strings safe to render.
  toast.lastElementChild.textContent = message;
  container.appendChild(toast);

  dismissTimer = setTimeout(() => {
    toast.style.animation = 'fadeIn 0.3s reverse forwards';
    removeTimer = setTimeout(() => { container.innerHTML = ''; }, 300);
  }, duration);
}

export function showPointsToast(points, reason) {
  showToast(`+${points} pts — ${reason}`, 'points', 2500);
}
