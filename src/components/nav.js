// ============================================
// FEEDBACK — Bottom Navigation Component
// ============================================

import { ICONS, isSunday } from '../data/mock-data.js';
import { router } from '../router.js';

export function renderBottomNav(activeTab = 'wall') {
  return `
    <nav class="bottom-nav" id="bottom-nav">
      <button class="nav-item ${activeTab === 'profile' ? 'active' : ''}" data-nav="profile" id="nav-profile">
        ${ICONS.profile}
        <span class="nav-label">Perfil</span>
      </button>
      <button class="nav-item ${activeTab === 'wall' ? 'active' : ''}" data-nav="wall" id="nav-wall">
        ${ICONS.wall}
        <span class="nav-label">Muro</span>
      </button>
      <button class="nav-item ${activeTab === 'parties' ? 'active' : ''}" data-nav="parties" id="nav-parties">
        ${ICONS.parties}
        <span class="nav-label">Fiestas</span>
        ${isSunday ? '<span class="notification-dot"></span>' : ''}
      </button>
    </nav>
  `;
}

// Bind navigation events (called once after render)
export function bindNavEvents() {
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;

  nav.addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item');
    if (!item) return;

    const target = item.dataset.nav;
    switch (target) {
      case 'profile':
        router.navigate('profile');
        break;
      case 'wall':
        router.navigate('wall');
        break;
      case 'parties':
        router.navigate('parties');
        break;
    }
  });
}
