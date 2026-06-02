// ============================================
// FEEDBACK — Bottom Navigation Component
// ============================================
// The <nav id="bottom-nav"> element lives in index.html, OUTSIDE #app,
// so router page swaps don't touch it. We populate its contents ONCE at
// boot (mountBottomNav, called from main.js) and from then on each page
// just calls setBottomNav(tab) — which toggles classes on the existing
// buttons instead of rewriting the bar. Result: no nav flicker on
// hydration repaints / route changes. Login & onboarding call
// setBottomNav(null) to hide it entirely.

import { isSunday } from '../data/mock-data.js';
import { router } from '../router.js';

const NAV_HTML = `
  <button class="nav-item" data-nav="parties" id="nav-parties" aria-label="Fiestas" title="Fiestas">
    <span class="nav-item-icon nav-item-icon-parties" aria-hidden="true"></span>
    ${isSunday ? '<span class="notification-dot"></span>' : ''}
  </button>
  <button class="nav-item" data-nav="wall" id="nav-wall" aria-label="Muro" title="Muro">
    <span class="nav-item-icon nav-item-icon-wall" aria-hidden="true"></span>
  </button>
  <button class="nav-item" data-nav="profile" id="nav-profile" aria-label="Perfil" title="Perfil">
    <span class="nav-item-icon nav-item-icon-profile" aria-hidden="true"></span>
  </button>
`;

let _mounted = false;

/**
 * Populate the persistent <nav id="bottom-nav"> element and wire the
 * delegated click handler. Idempotent — calling this again after the
 * initial boot is a no-op.
 */
export function mountBottomNav() {
  if (_mounted) return;
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;
  nav.innerHTML = NAV_HTML;
  nav.addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item');
    if (!item) return;
    const target = item.dataset.nav;
    if (target === 'profile' || target === 'wall' || target === 'parties') {
      router.navigate(target);
    }
  });
  _mounted = true;
}

/**
 * Show the bottom nav and mark `activeTab` as active (or no active button
 * if it's `''` / a route without a nav highlight like /notifications or
 * /chat-hub). Pass `null` to hide the nav entirely (login, onboarding).
 */
export function setBottomNav(activeTab) {
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;
  if (activeTab === null || activeTab === undefined || activeTab === false) {
    nav.hidden = true;
    return;
  }
  nav.hidden = false;
  for (const btn of nav.querySelectorAll('.nav-item')) {
    btn.classList.toggle('active', btn.dataset.nav === activeTab);
  }
}

// ---------------------------------------------------------------------
// Legacy compatibility shims
// ---------------------------------------------------------------------
// renderBottomNav() used to be embedded in each page's HTML template.
// Pages that still call it now receive an empty string — the persistent
// nav above handles their nav state via setBottomNav(). bindNavEvents()
// is similarly a no-op: events are bound exactly once at mount time.
// Both shims let us migrate pages one at a time without breaking
// anything that hasn't been touched yet.
export function renderBottomNav() { return ''; }
export function bindNavEvents() { /* no-op — handler delegated at mount */ }
