// ============================================
// FEEDBACK — Utility Helpers
// ============================================

/** Generate a color from a string (for avatar fallbacks) */
export function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 65%, 45%)`;
}

/** Get initials from name */
export function getInitials(name) {
  return name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/** Create avatar HTML (image or placeholder) */
export function avatarHTML(user, sizeClass = 'avatar-md', extraClass = '') {
  if (user.avatar) {
    return `<img src="${user.avatar}" alt="${user.name}" class="avatar ${sizeClass} ${extraClass}" />`;
  }
  const bg = stringToColor(user.name);
  const initials = getInitials(user.name);
  return `<div class="avatar avatar-placeholder ${sizeClass} ${extraClass}" style="background:${bg}">${initials}</div>`;
}

const ROLE_LABEL_MAP = {
  raver: '🎉 Raver',
  dj: '🎧 DJ',
  promotor: '✨ Promotor',
};

const ROLE_BADGE_CLASS_MAP = {
  raver: 'badge-orange',
  dj: 'badge-purple',
  promotor: 'badge-gold',
};

/** Role label with emoji */
export function roleLabel(role) {
  return ROLE_LABEL_MAP[role] || role;
}

/** Role → badge class */
export function roleBadgeClass(role) {
  return ROLE_BADGE_CLASS_MAP[role] || 'badge-orange';
}

/** Capitalized role for inline badge text. */
export function roleTitle(role) {
  if (!role) return '';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/** Debounce function */
export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Sanitize HTML (escape text for safe interpolation in templates). */
export function sanitize(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
