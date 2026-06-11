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
  const name = user?.name || '?';
  const src = safeImageSrc(user?.avatar);
  if (src) {
    return `<img src="${src}" alt="${sanitize(name)}" class="avatar ${sizeClass} ${extraClass}" />`;
  }
  const bg = stringToColor(name);
  const initials = getInitials(name);
  return `<div class="avatar avatar-placeholder ${sizeClass} ${extraClass}" style="background:${bg}">${sanitize(initials)}</div>`;
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

/** Sanitize/escape a value for safe interpolation in HTML templates.
 *  Escapes &, <, >, " and ' so the result is inert in BOTH text nodes
 *  and quoted attribute values (src/alt/value/placeholder). The previous
 *  textContent→innerHTML trick left quotes intact, which let user data
 *  break out of attribute context — see the jun-2026 audit (XSS C1). */
export function sanitize(str) {
  return str == null ? '' : String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Validate + escape a user-controlled image URL for use in src="…".
 *  Allows https, same-origin paths, blob: previews and data:image/ URIs
 *  (avatars/flyers/posts are stored as data URLs until the Storage
 *  migration). Anything else — javascript:, data:text/html, etc. —
 *  returns null so the caller can fall back to a placeholder. */
export function safeImageSrc(url) {
  if (typeof url !== 'string') return null;
  const v = url.trim();
  // Single leading "/" only — "//evil.com" is protocol-relative, and
  // browsers also treat "\" as "/" in the authority part, so "/\evil.com"
  // resolves cross-origin too. Reject both.
  if (/^(https:\/\/|data:image\/|blob:)/i.test(v) || /^\/(?![/\\])/.test(v)) {
    return sanitize(v);
  }
  return null;
}
