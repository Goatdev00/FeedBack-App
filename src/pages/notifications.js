// ============================================
// FEEDBACK — Notifications Page
// ============================================

import { store, ICONS, formatRelative } from '../data/mock-data.js';
import { router } from '../router.js';
import { avatarHTML, sanitize } from '../utils/helpers.js';
import { renderBottomNav } from '../components/nav.js';
import { requireCurrentUser } from '../data/profile-sync.js';

const KIND_META = {
  follow:   { icon: '🤝', accent: 'follow'   },
  comment:  { icon: '💬', accent: 'comment'  },
  like:     { icon: '❤️', accent: 'like'     },
  question: { icon: '❓', accent: 'question' },
};

export function renderNotifications(container) {
  if (!requireCurrentUser(container)) return;
  const state = store.getState();
  const user = state.currentUser;

  // Snapshot the unread threshold BEFORE marking as read, so items just
  // received still render with the "is-new" highlight on this visit.
  const lastViewed = state.lastNotificationsViewed
    ? new Date(state.lastNotificationsViewed).getTime()
    : 0;

  const notifications = store.getNotifications();
  store.markNotificationsRead();

  const grouped = groupByDay(notifications);

  container.innerHTML = `
    <div class="page" id="notifications-page">
      <button class="back-btn" id="back-btn">
        ${ICONS.back}
        <span>Volver al muro</span>
      </button>

      <h1 class="page-title">Notificaciones</h1>
      <p class="page-subtitle" style="margin-bottom:var(--space-lg);">
        ${notifications.length === 0
          ? 'Sin movimientos por ahora'
          : `${notifications.length} interacción${notifications.length === 1 ? '' : 'es'} reciente${notifications.length === 1 ? '' : 's'}`}
      </p>

      ${notifications.length === 0
        ? renderEmptyState()
        : grouped.map(group => renderGroup(group, lastViewed)).join('')
      }
    </div>

    ${renderBottomNav('')}
  `;

  bindEvents(container, notifications);
}

function renderEmptyState() {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">🔔</div>
      <h3 class="empty-state-title">Aún no hay notificaciones</h3>
      <p class="empty-state-text">
        Cuando alguien te siga, comente tus publicaciones o te haga una pregunta anónima, aparecerá aquí.
      </p>
    </div>
  `;
}

function renderGroup(group, lastViewed) {
  return `
    <div class="notif-group">
      <h3 class="notif-group-title">${group.label}</h3>
      ${group.items.map(n => renderItem(n, lastViewed)).join('')}
    </div>
  `;
}

function renderItem(n, lastViewed) {
  const meta = KIND_META[n.kind] || { icon: '🔔', accent: '' };
  const isNew = n.time && n.time.getTime() > lastViewed;
  const timeLabel = n.time ? formatRelative(n.time) : '';
  const actorBlock = n.anonymous
    ? `<div class="notif-anon">${ICONS.question}</div>`
    : avatarHTML(n.actor, 'avatar-sm');
  const actorName = n.anonymous ? 'Alguien' : sanitize(n.actor.name);

  return `
    <button class="notification-item ${isNew ? 'is-new' : ''}"
            data-id="${n.id}"
            data-route="${n.navigate.route}"
            data-user-id="${n.navigate.params?.userId || ''}">
      ${actorBlock}
      <div class="notification-content">
        <div class="notification-text">
          <span class="notification-actor-name">${actorName}</span>
          <span> ${sanitize(n.text)}</span>
        </div>
        <div class="notification-meta">
          <span class="notification-kind">${meta.icon}</span>
          <span class="notification-time">${timeLabel}</span>
        </div>
      </div>
    </button>
  `;
}

function bindEvents(container, notifications) {
  container.querySelector('#back-btn')?.addEventListener('click', () => router.navigate('wall'));

  container.querySelectorAll('.notification-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const n = notifications.find(x => x.id === id);
      if (!n) return;
      if (n.navigate.params?.userId) {
        store.setState({ viewingUserId: n.navigate.params.userId });
      }
      router.navigate(n.navigate.route, n.navigate.params || {});
    });
  });
}

// Group notifications into Hoy / Ayer / "Esta semana" / "Más antiguo".
function groupByDay(items) {
  const today = startOfDay(new Date());
  const yesterday = startOfDay(new Date(today.getTime() - 86_400_000));
  const weekAgo = startOfDay(new Date(today.getTime() - 6 * 86_400_000));

  const groups = { today: [], yesterday: [], thisWeek: [], older: [] };

  for (const n of items) {
    const t = n.time ? n.time.getTime() : 0;
    if (t >= today.getTime()) groups.today.push(n);
    else if (t >= yesterday.getTime()) groups.yesterday.push(n);
    else if (t >= weekAgo.getTime()) groups.thisWeek.push(n);
    else groups.older.push(n);
  }

  return [
    { label: 'Hoy',          items: groups.today },
    { label: 'Ayer',         items: groups.yesterday },
    { label: 'Esta semana',  items: groups.thisWeek },
    { label: 'Más antiguo',  items: groups.older },
  ].filter(g => g.items.length > 0);
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
