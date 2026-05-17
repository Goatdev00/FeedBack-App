// ============================================
// FEEDBACK — Wall / Feed Page
// ============================================

import { store, ICONS, formatRelative } from '../data/mock-data.js';
import { router } from '../router.js';
import { showToast } from '../utils/toast.js';
import { avatarHTML, roleBadgeClass, roleTitle, sanitize } from '../utils/helpers.js';
import { createModal } from '../utils/dom.js';
import { renderBottomNav, bindNavEvents } from '../components/nav.js';

const LIKE_RECENCY_BOOST_MS = 60_000 * 30;

function sortFeed(posts) {
  return [...posts].sort((a, b) => {
    const scoreA = new Date(a.createdAt).getTime() + a.likes * LIKE_RECENCY_BOOST_MS;
    const scoreB = new Date(b.createdAt).getTime() + b.likes * LIKE_RECENCY_BOOST_MS;
    return scoreB - scoreA;
  });
}

export function renderWall(container) {
  const state = store.getState();
  const user = state.currentUser;
  const posts = sortFeed(state.posts);
  const unreadNotifs = user ? store.getUnreadNotificationCount() : 0;

  container.innerHTML = `
    <div class="page" id="wall-page">
      <!-- Top action row: chat (left) — notifications (right) -->
      <div class="wall-top-row">
        <button class="chat-trigger" id="chat-btn" title="Chats en vivo" aria-label="Abrir chats">
          ${ICONS.reply}
        </button>
        <button class="notifications-trigger ${unreadNotifs > 0 ? 'has-unread' : ''}"
                id="notifications-btn" title="Notificaciones" aria-label="Ver notificaciones">
          ${ICONS.heart}
          ${unreadNotifs > 0 ? `<span class="notif-dot"></span>` : ''}
        </button>
      </div>

      <!-- Title -->
      <div class="wall-title-block">
        <p class="page-subtitle">Lo que está pasando ahora</p>
      </div>

      <!-- Stories-like party thermometer -->
      ${renderLiveParties(state)}

      <!-- Feed -->
      <div id="feed-container">
        ${posts.length > 0
          ? posts.map(post => renderPostCard(post, state)).join('')
          : renderEmptyWall()
        }
      </div>
    </div>

    <!-- FAB create post -->
    ${user ? `
      <button class="fab" id="fab-create-post" title="Crear publicación">
        ${ICONS.plus}
      </button>
    ` : ''}

    ${renderBottomNav('wall')}
  `;

  bindWallEvents(container);
}

function renderLiveParties(state) {
  const todayParties = store.getTodayParties(state.selectedCity);
  if (todayParties.length === 0) return '';

  return `
    <div style="margin-bottom:var(--space-lg);overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <div style="display:flex;gap:var(--space-sm);padding-bottom:var(--space-sm);">
        ${todayParties.map(party => `
          <div class="card" style="min-width:140px;max-width:160px;padding:var(--space-sm) var(--space-md);cursor:pointer;flex-shrink:0;"
               data-action="view-party" data-party-id="${party.id}">
            <div style="font-size:1.2rem;margin-bottom:4px;">🔴</div>
            <div style="font-size:var(--text-xs);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sanitize(party.name)}</div>
            <div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-top:2px;">${sanitize(party.venue)}</div>
            <div style="display:flex;align-items:center;gap:4px;margin-top:6px;">
              <span style="font-size:var(--text-xs);color:var(--orange);">⚡ ${party.reports?.energia || 0}%</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderPostComments(post) {
  const comments = post.comments || [];
  if (comments.length === 0) return '';

  const visibleComments = comments.slice(-3);
  const hiddenCount = comments.length - visibleComments.length;

  return `
    <div class="post-comments">
      ${hiddenCount > 0 ? `
        <button class="post-comments-more" data-action="view-all-comments" data-post-id="${post.id}">
          Ver ${hiddenCount} comentario${hiddenCount > 1 ? 's' : ''} más...
        </button>
      ` : ''}
      ${visibleComments.map(comment => {
        const commenter = store.getUserById(comment.userId);
        if (!commenter) return '';
        return `
          <div class="post-comment">
            <strong class="post-comment-author" data-action="view-profile" data-user-id="${commenter.id}" style="cursor:pointer;">${sanitize(commenter.name)}</strong>
            <span class="post-comment-text">${sanitize(comment.text)}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderPostCard(post, state) {
  const author = store.getUserById(post.userId);
  if (!author) return '';
  const party = store.getPartyById(post.partyId);
  const currentUser = state.currentUser;
  const isLiked = !!(currentUser && post.likedBy.includes(currentUser.id));
  const commentsCount = (post.comments || []).length;

  return `
    <div class="post-card ${post._syncFailed ? 'post-card-failed' : ''} ${post._pending ? 'post-card-pending' : ''}" data-post-id="${post.id}">
      <div class="post-header">
        ${avatarHTML(author, 'avatar-md')}
        <div class="post-author-info">
          <div class="post-author-name" data-action="view-profile" data-user-id="${author.id}" style="cursor:pointer;">
            ${sanitize(author.name)}
            ${author.premium ? '<span class="premium-badge">PRO</span>' : ''}
            <span class="badge ${roleBadgeClass(author.role)}" style="font-size:0.5625rem;padding:2px 6px;">${roleTitle(author.role)}</span>
          </div>
          ${party ? `
            <div class="post-party-tag">
              ${ICONS.location}
              ${sanitize(party.name)}
            </div>
          ` : ''}
        </div>
        <span class="post-time">${formatRelative(new Date(post.createdAt))}</span>
      </div>

      <div class="post-content">${sanitize(post.content)}</div>

      ${post.image ? `<img src="${post.image}" alt="Post image" class="post-image" />` : ''}

      <div class="post-actions">
        <button class="post-action ${isLiked ? 'liked' : ''}" data-action="like" data-post-id="${post.id}">
          ${isLiked ? ICONS.heartFilled : ICONS.heart}
          <span>${post.likes}</span>
        </button>
        <button class="post-action" data-action="toggle-comments" data-post-id="${post.id}">
          ${ICONS.reply}
          <span>${commentsCount}</span>
        </button>
        <button class="post-action" data-action="question-author" data-user-id="${author.id}">
          ${ICONS.question}
        </button>
        <button class="post-action" data-action="report-post" data-post-id="${post.id}" style="margin-left:auto;">
          ${ICONS.flag}
        </button>
      </div>

      ${renderPostComments(post)}

      <div class="post-comment-input-wrapper">
        <input type="text" class="post-comment-input" data-post-id="${post.id}" placeholder="Escribe un comentario..." maxlength="200" />
        <button class="post-comment-send" data-action="send-comment" data-post-id="${post.id}">
          ${ICONS.send}
        </button>
      </div>
    </div>
  `;
}

function renderEmptyWall() {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">📭</div>
      <h3 class="empty-state-title">Sin publicaciones aún</h3>
      <p class="empty-state-text">
        ¡Sé el primero en publicar! Selecciona una fiesta y comparte lo que está pasando.
      </p>
      <button class="btn btn-primary mt-lg" id="empty-create-post">Crear publicación</button>
    </div>
  `;
}

function submitComment(container, postId) {
  const input = container.querySelector(`.post-comment-input[data-post-id="${postId}"]`);
  const text = input?.value?.trim();
  if (!text) { showToast('Escribe un comentario', 'error'); return; }
  store.addComment(postId, text);
  showToast('Comentario publicado 💬', 'success');
  renderWall(container);
}

const WALL_ACTIONS = {
  like(container, action) {
    store.toggleLike(action.dataset.postId);
    renderWall(container);
  },
  'view-profile'(_container, action) {
    const userId = action.dataset.userId;
    store.setState({ viewingUserId: userId });
    router.navigate('profile-other', { userId });
  },
  'view-party'(_container, action) {
    const partyId = action.dataset.partyId;
    store.setState({ viewingPartyId: partyId });
    router.navigate('party-detail', { partyId });
  },
  'send-comment'(container, action) {
    submitComment(container, action.dataset.postId);
  },
  'toggle-comments'(container, action) {
    const input = container.querySelector(`.post-comment-input[data-post-id="${action.dataset.postId}"]`);
    input?.focus();
  },
  'view-all-comments'(container, action) {
    showAllCommentsModal(container, action.dataset.postId);
  },
  'question-author'(container, action) {
    showQuestionModal(container, action.dataset.userId);
  },
  'report-post'() {
    showToast('Publicación reportada. Gracias por tu feedback.', 'info');
  },
};

function bindWallEvents(container) {
  // The wall page root is regenerated by each renderWall, so listeners on it
  // are released along with the old DOM — no need for bindOnce-style guards.
  const root = container.querySelector('#wall-page');
  if (!root) return;

  container.querySelector('#fab-create-post')?.addEventListener('click', () => {
    const state = store.getState();
    if (!store.canUserPost(state.currentUser.id)) {
      showToast('Has alcanzado el límite de 5 publicaciones diarias', 'warning');
      return;
    }
    router.navigate('select-party');
  });

  container.querySelector('#empty-create-post')?.addEventListener('click', () => {
    router.navigate('select-party');
  });

  container.querySelector('#notifications-btn')?.addEventListener('click', () => {
    router.navigate('notifications');
  });

  container.querySelector('#chat-btn')?.addEventListener('click', () => {
    router.navigate('chat-hub');
  });

  root.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]');
    if (!action) return;
    WALL_ACTIONS[action.dataset.action]?.(container, action);
  });

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const input = e.target.closest('.post-comment-input');
    if (!input) return;
    e.preventDefault();
    submitComment(container, input.dataset.postId);
  });

  // Self-contained nav binding: WALL_ACTIONS handlers can call
  // renderWall(container) directly (after like / send comment), which
  // wipes the bottom-nav DOM along with the rest. Re-bind here so the
  // nav buttons keep working regardless of how we got rendered. The
  // router wrapper still calls bindNavEvents() too — it's idempotent.
  bindNavEvents();
}

function showAllCommentsModal(container, postId) {
  const post = store.getState().posts.find(p => p.id === postId);
  if (!post) return;
  const comments = post.comments || [];

  const overlay = createModal(`
    <div class="modal" style="max-height:70dvh;">
      <div class="modal-handle"></div>
      <div class="modal-title">Comentarios (${comments.length})</div>
      <div style="display:flex;flex-direction:column;gap:var(--space-md);max-height:50dvh;overflow-y:auto;">
        ${comments.map(c => {
          const commenter = store.getUserById(c.userId);
          if (!commenter) return '';
          return `
            <div style="display:flex;gap:var(--space-sm);align-items:flex-start;">
              ${avatarHTML(commenter, 'avatar-sm')}
              <div style="flex:1;">
                <div style="font-size:var(--text-sm);font-weight:600;">${sanitize(commenter.name)}</div>
                <div style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.5;">${sanitize(c.text)}</div>
                <div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-top:2px;">${formatRelative(new Date(c.createdAt))}</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      <div style="display:flex;gap:var(--space-sm);margin-top:var(--space-lg);border-top:1px solid var(--border-subtle);padding-top:var(--space-md);">
        <input type="text" class="input" id="modal-comment-input" placeholder="Escribe un comentario..." maxlength="200" style="flex:1;font-size:var(--text-sm);" />
        <button class="btn btn-primary btn-sm" id="modal-comment-send">${ICONS.send}</button>
      </div>
    </div>
  `);

  const sendModalComment = () => {
    const input = overlay.querySelector('#modal-comment-input');
    const text = input?.value?.trim();
    if (!text) { showToast('Escribe un comentario', 'error'); return; }
    store.addComment(postId, text);
    showToast('Comentario publicado 💬', 'success');
    overlay.close();
    renderWall(container);
  };

  overlay.querySelector('#modal-comment-send').addEventListener('click', sendModalComment);
  overlay.querySelector('#modal-comment-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendModalComment();
  });
}

function showQuestionModal(_container, userId) {
  const user = store.getUserById(userId);
  if (!user) return;

  const overlay = createModal(`
    <div class="modal" style="max-height:50dvh;">
      <div class="modal-handle"></div>
      <div class="modal-title">Pregunta a ${sanitize(user.name)}</div>
      <p style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-lg);">
        Tu pregunta será anónima
      </p>
      <textarea class="input textarea" id="question-text" placeholder="¿Qué quieres preguntarle?" maxlength="200" style="min-height:80px;"></textarea>
      <div style="display:flex;gap:var(--space-sm);margin-top:var(--space-lg);">
        <button class="btn btn-secondary" id="cancel-question" style="flex:1;">Cancelar</button>
        <button class="btn btn-primary" id="send-question" style="flex:1;">Enviar</button>
      </div>
    </div>
  `);

  overlay.querySelector('#cancel-question').addEventListener('click', () => overlay.close());
  overlay.querySelector('#send-question').addEventListener('click', () => {
    const text = overlay.querySelector('#question-text').value.trim();
    if (!text) {
      showToast('Escribe tu pregunta', 'error');
      return;
    }
    store.addQuestion(userId, text);
    overlay.close();
    showToast('Pregunta enviada 📨', 'success');
  });
}
