// ============================================
// FEEDBACK — Wall / Feed Page
// ============================================

import { store, ICONS, formatRelative } from '../data/mock-data.js';
import { router } from '../router.js';
import { showToast } from '../utils/toast.js';
import { avatarHTML, roleBadgeClass, roleTitle, sanitize, safeImageSrc, bogotaTodayStr } from '../utils/helpers.js';
import { createModal } from '../utils/dom.js';
import { renderBottomNav, bindNavEvents } from '../components/nav.js';
import { refreshFromSupabaseInBackground } from '../data/hydration.js';
import { reportPost, adminSoftDeletePost, adminSoftDeleteComment } from '../data/api.js';
import { currentUserIsAdmin, confirmAdminDelete } from '../utils/admin-moderation.js';

const LIKE_RECENCY_BOOST_MS = 60_000 * 30;

function sortFeed(posts) {
  return [...posts].sort((a, b) => {
    const scoreA = new Date(a.createdAt).getTime() + a.likes * LIKE_RECENCY_BOOST_MS;
    const scoreB = new Date(b.createdAt).getTime() + b.likes * LIKE_RECENCY_BOOST_MS;
    return scoreB - scoreA;
  });
}

// Divider between current and archived-but-visible content (wall + fiestas).
function sectionSeparator(label) {
  return `
    <div style="display:flex;align-items:center;gap:var(--space-sm);margin:var(--space-lg) 0 var(--space-md);">
      <span style="flex:1;height:1px;background:var(--border-subtle);"></span>
      <span style="font-size:var(--text-xs);color:var(--text-tertiary);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${label}</span>
      <span style="flex:1;height:1px;background:var(--border-subtle);"></span>
    </div>
  `;
}

export function renderWall(container) {
  const state = store.getState();
  const user = state.currentUser;
  const posts = sortFeed(state.posts);
  const unreadNotifs = user ? store.getUnreadNotificationCount() : 0;
  // Split "current" (posts whose party is today/upcoming) from "old" (posts
  // whose party date already passed, still inside the 7-day window). Old
  // ones sink below a "Publicaciones antiguas" divider.
  const _todayStr = bogotaTodayStr();
  const isOldPost = (p) => { const pty = store.getPartyById(p.partyId); return !!(pty && pty.date && pty.date < _todayStr); };
  const currentPosts = posts.filter(p => !isOldPost(p));
  const oldPosts = posts.filter(isOldPost);

  // Belt-and-suspenders: if the wall rendered without a prior hydrate
  // (e.g. user came straight from /onboarding → /wall without re-
  // entering routeAfterSession), kick one off. The in-flight guard
  // inside refreshFromSupabaseInBackground coalesces concurrent calls.
  if (!state.hydrated) refreshFromSupabaseInBackground();

  container.innerHTML = `
    <div class="page" id="wall-page">
      <!-- Top action row: chat (left) — notifications (right) -->
      <div class="wall-top-row">
        ${(() => {
          // Single dot on the wall icon if EITHER chat type has unread —
          // the breakdown (which type) is shown inside chat-hub on its
          // per-card dots.
          const anyUnread = state.hasUnreadChatGeneral || state.hasUnreadChatParty;
          return `
        <button class="chat-trigger ${anyUnread ? 'has-unread' : ''}"
                id="chat-btn" title="Chats en vivo" aria-label="Abrir chats">
          ${ICONS.reply}
          ${anyUnread ? `<span class="chat-dot"></span>` : ''}
        </button>`;
        })()}
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
        ${(() => {
          // Render each section first, then gate the separator on the
          // ACTUAL markup (renderPostCard returns '' for report-hidden /
          // uncached-author posts), so no divider shows with nothing under
          // it and the empty state shows when everything renders blank.
          const currentHtml = currentPosts.map(post => renderPostCard(post, state)).join('');
          const oldHtml = oldPosts.map(post => renderPostCard(post, state)).join('');
          if (!currentHtml.trim() && !oldHtml.trim()) {
            return state.hydrated ? renderEmptyWall() : renderWallSkeleton();
          }
          return currentHtml + (oldHtml.trim() ? sectionSeparator('Publicaciones antiguas') + oldHtml : '');
        })()}
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

  // Deep link target (#/wall?post=<id> — shared links and tapped push
  // notifications land here). Scroll the post into view and flash a
  // highlight, then consume the param so subsequent re-renders (likes,
  // realtime) don't keep yanking the scroll position back.
  const targetPost = router.getCurrentParams()?.post;
  if (targetPost) {
    const node = container.querySelector(`[data-post-id="${CSS.escape(targetPost)}"]`);
    if (node) {
      delete router.getCurrentParams().post;
      requestAnimationFrame(() => {
        node.scrollIntoView({ block: 'center' });
        node.classList.add('post-card-highlight');
      });
    }
    // If the post isn't in the initial 50, leave the param: the post-
    // hydration repaint gets one more chance to find it.
  }
}

function renderLiveParties(state) {
  const parties = store.getTodayParties(state.selectedCity);
  if (parties.length === 0) return '';

  // getTodayParties returns every non-finished party regardless of calendar
  // date, so past-but-still-visible parties are already in this strip. Split
  // them: current/upcoming first (soonest → later), then the past ones behind
  // a compact "Antiguas" divider so it's clear which are old.
  const todayStr = bogotaTodayStr();
  const isOld = (p) => !!(p.date && p.date < todayStr);
  const recent = parties.filter(p => !isOld(p)).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const old = parties.filter(isOld).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const partyCard = (party, faded) => {
    // Flyer as a soft backdrop: blurred + dimmed (blur/saturate/brightness
    // + a dark veil) so the photo reads as ambience, not competition for
    // the text. scale(1.15) hides the blur's transparent edge bleed;
    // overflow:hidden + .card's radius clip it to the card shape.
    const flyer = safeImageSrc(party.flyer);
    // These cards sit on a dark-dimmed photo (or a dark base when there's
    // no flyer), so the text is ALWAYS white — hardcoded, not themed:
    // in light mode the theme's dark text over the dark backdrop was
    // unreadable.
    return `
    <div class="card" style="min-width:140px;max-width:160px;padding:var(--space-sm) var(--space-md);cursor:pointer;flex-shrink:0;position:relative;overflow:hidden;background:rgba(18,18,26,0.95);border-color:rgba(255,255,255,0.08);${faded ? 'opacity:0.6;' : ''}"
         data-action="view-party" data-party-id="${party.id}">
      ${flyer ? `
        <img src="${flyer}" alt="" aria-hidden="true" loading="lazy"
             style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(3px) saturate(0.85) brightness(0.55);transform:scale(1.15);pointer-events:none;" />
        <div style="position:absolute;inset:0;background:rgba(10,10,16,0.35);pointer-events:none;"></div>
      ` : ''}
      <div style="position:relative;">
        <div style="font-size:1.2rem;margin-bottom:4px;">${faded ? '🕓' : '🔴'}</div>
        <div style="font-size:var(--text-xs);font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sanitize(party.name)}</div>
        <div style="font-size:var(--text-xs);color:rgba(255,255,255,0.8);margin-top:2px;">${sanitize(party.venue)}</div>
        <div style="display:flex;align-items:center;gap:4px;margin-top:6px;">
          <span style="font-size:var(--text-xs);color:var(--orange);">⚡ ${party.reports?.energia || 0}%</span>
        </div>
      </div>
    </div>
  `;
  };

  const oldDivider = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;flex-shrink:0;align-self:stretch;padding:0 8px;">
      <span style="flex:1;width:2px;border-radius:2px;background:var(--border-subtle);min-height:8px;"></span>
      <span style="font-size:0.6rem;color:var(--text-secondary);font-weight:800;text-transform:uppercase;letter-spacing:2px;writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;padding:8px 4px;background:rgba(255,255,255,0.05);border:1px solid var(--border-subtle);border-radius:var(--radius-full);">Antiguas</span>
      <span style="flex:1;width:2px;border-radius:2px;background:var(--border-subtle);min-height:8px;"></span>
    </div>
  `;

  // Only split when BOTH groups exist. If everything is current, no divider;
  // if everything is past (e.g. all dates slipped within the 7-day window),
  // show them as normal cards rather than an empty "recent" side + a leading
  // divider.
  const split = recent.length > 0 && old.length > 0;
  const strip = split
    ? recent.map(p => partyCard(p, false)).join('') + oldDivider + old.map(p => partyCard(p, true)).join('')
    : recent.concat(old).map(p => partyCard(p, false)).join('');

  return `
    <div class="wall-live-strip" style="margin-bottom:var(--space-lg);overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <div style="display:flex;gap:var(--space-sm);padding-bottom:var(--space-sm);">
        ${strip}
      </div>
    </div>
  `;
}

// Small heart on a comment. Hidden on optimistic (pending) comments whose
// temp id can't be liked server-side yet.
function commentLikeBtn(postId, comment) {
  if (comment._pending) return '';
  const me = store.getState().currentUser;
  const isLiked = !!(me && (comment.likedBy || []).includes(me.id));
  const count = comment.likes || 0;
  return `<button class="comment-like ${isLiked ? 'liked' : ''}" data-action="like-comment" data-post-id="${postId}" data-comment-id="${comment.id}" title="Me gusta" aria-label="Me gusta comentario">${isLiked ? ICONS.heartFilled : ICONS.heart}${count > 0 ? `<span class="comment-like-count">${count}</span>` : ''}</button>`;
}

function renderPostComments(post) {
  const comments = post.comments || [];
  if (comments.length === 0) return '';

  const visibleComments = comments.slice(-3);
  const hiddenCount = comments.length - visibleComments.length;
  const isAdmin = currentUserIsAdmin();

  return `
    <div class="post-comments">
      ${hiddenCount > 0 ? `
        <button class="post-comments-more" data-action="view-all-comments" data-post-id="${post.id}">
          Ver ${hiddenCount} comentario${hiddenCount > 1 ? 's' : ''} más...
        </button>
      ` : ''}
      ${visibleComments.map(comment => {
        const commenter = store.getUserById(comment.userId);
        // Keep the existing behavior for non-admins (hide a comment whose
        // author isn't cached yet); for admins render a neutral fallback so
        // the moderation control is still reachable. Never offer delete on
        // an optimistic (pending) comment — its temp id can't resolve.
        if (!commenter && !isAdmin) return '';
        const canModerate = isAdmin && !comment._pending && !comment._syncFailed;
        const authorName = commenter ? sanitize(commenter.name) : 'Usuario';
        const authorAttrs = commenter
          ? `data-action="view-profile" data-user-id="${commenter.id}" style="cursor:pointer;"`
          : 'style="opacity:0.7;"';
        return `
          <div class="post-comment">
            <strong class="post-comment-author" ${authorAttrs}>${authorName}</strong>
            <span class="post-comment-text">${sanitize(comment.text)}</span>
            ${commentLikeBtn(post.id, comment)}
            ${canModerate ? `<button class="admin-mod-inline" data-action="admin-delete-comment" data-comment-id="${comment.id}" title="Eliminar (admin)" style="margin-left:6px;background:transparent;border:none;color:#dc2626;cursor:pointer;padding:0 2px;font-size:0.8em;line-height:1;vertical-align:middle;">🗑️</button>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

export function renderPostCard(post, state) {
  // Prefer the inline author the listPosts query joins in — it's always
  // present and matches the post's user_id. Fall back to the users[] cache
  // only if the row arrived without an author (e.g. an optimistic temp
  // post). This covers the race where state.users hasn't been populated
  // yet (own profile not synced, listProfiles still in flight): without it
  // the user's own posts disappear from THEIR own wall while others still
  // see them, because foreign clients' caches already have the author.
  const author = post.author || store.getUserById(post.userId);
  if (!author) return '';
  const party = store.getPartyById(post.partyId);
  const currentUser = state.currentUser;
  const isLiked = !!(currentUser && post.likedBy.includes(currentUser.id));
  const commentsCount = (post.comments || []).length;
  const isOwn = currentUser && post.userId === currentUser.id;
  const isAdmin = !!(currentUser && currentUser.isAdmin);

  // Auto-hidden by report threshold. RLS already prevents foreign clients
  // from receiving these rows; only the author still sees the post — and
  // here we replace the body with a "blocked" banner instead of the
  // original content + actions. Defensive: also bail for non-owners just
  // in case a stale cached row carries hiddenAt.
  if (post.hiddenAt) {
    // Owner sees the "blocked by reports" banner. The admin's is_admin()
    // RLS override (0032) delivers foreign report-hidden posts too, so the
    // admin also gets a card here — with a moderation control so they can
    // permanently soft-delete an abusive post that crossed the threshold.
    if (!isOwn && !isAdmin) return '';
    return `
      <div class="post-card post-card-hidden" data-post-id="${post.id}">
        <div class="post-header">
          <span data-action="view-profile" data-user-id="${author.id}" style="cursor:pointer;display:inline-flex;">
            ${avatarHTML(author, 'avatar-md')}
          </span>
          <div class="post-author-info">
            <div class="post-author-name">${sanitize(author.name)}</div>
            <div class="post-party-tag" style="color:var(--text-tertiary);">
              ${formatRelative(new Date(post.createdAt))}
            </div>
          </div>
          ${isAdmin ? `
            <button class="post-action" data-action="admin-delete-post" data-post-id="${post.id}" style="margin-left:auto;color:#dc2626;" title="Eliminar (admin)">
              ${ICONS.trash}
            </button>
          ` : ''}
        </div>
        <div class="post-hidden-banner">
          <div class="post-hidden-icon">🚫</div>
          <div class="post-hidden-text">
            <strong>Publicación oculta por reportes</strong>
            <p>${isOwn
              ? 'Tu publicación recibió 10 o más reportes y ya no es visible para otros usuarios.'
              : 'Esta publicación recibió 10 o más reportes y está oculta para los usuarios.'}</p>
            ${isAdmin && !isOwn ? `<p style="margin-top:6px;color:var(--text-secondary);">${sanitize(post.content)}</p>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="post-card ${post._syncFailed ? 'post-card-failed' : ''} ${post._pending ? 'post-card-pending' : ''}" data-post-id="${post.id}">
      <div class="post-header">
        <span data-action="view-profile" data-user-id="${author.id}" style="cursor:pointer;display:inline-flex;">
          ${avatarHTML(author, 'avatar-md')}
        </span>
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

      ${safeImageSrc(post.image) ? `<img src="${safeImageSrc(post.image)}" alt="Post image" class="post-image" loading="lazy" />` : ''}

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
        ${isOwn ? '' : `
          <button class="post-action" data-action="report-post" data-post-id="${post.id}" style="margin-left:auto;" title="Reportar">
            ${ICONS.flag}
          </button>
        `}
        ${isAdmin ? `
          <button class="post-action" data-action="admin-delete-post" data-post-id="${post.id}" style="${isOwn ? 'margin-left:auto;' : ''}color:#dc2626;" title="Eliminar (admin)">
            ${ICONS.trash}
          </button>
        ` : ''}
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

function renderWallSkeleton() {
  // Shown while the first Supabase hydration is in flight — better UX
  // than flashing the "no publications yet" empty state to a user who
  // actually has posts that just haven't loaded yet.
  return `
    <div class="empty-state">
      <div class="spinner" style="margin: 0 auto var(--space-md);"></div>
      <p class="empty-state-text">Cargando publicaciones...</p>
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

function submitComment(container, postId, refresh) {
  const input = container.querySelector(`.post-comment-input[data-post-id="${postId}"]`);
  const text = input?.value?.trim();
  if (!text) { showToast('Escribe un comentario', 'error'); return; }
  store.addComment(postId, text);
  showToast('Comentario publicado 💬', 'success');
  refresh();
}

// Optimistic local removal after an admin soft-delete: drop the row from the
// store so the next refresh() repaint doesn't show it. RLS already hides it
// from the next server hydration; this just makes the admin's own view
// instant. Authorization is enforced by the SECURITY DEFINER RPC, not here.
function removePostFromStore(postId) {
  store.setState({ posts: store.getState().posts.filter(p => p.id !== postId) });
}

function removeCommentFromStore(commentId) {
  const posts = store.getState().posts.map(p =>
    (p.comments && p.comments.some(c => c.id === commentId))
      ? { ...p, comments: p.comments.filter(c => c.id !== commentId) }
      : p
  );
  store.setState({ posts });
}

/**
 * Wire the click + Enter delegation for ANY container that renders
 * post cards (wall, party detail, etc). The `refresh` callback is what
 * gets called after like / comment so the host page repaints itself —
 * the wall passes renderWall(container); party-detail passes
 * renderPartyDetail(container, params). This is the single source of
 * truth for post-card interaction so the two surfaces stay in sync.
 */
export function bindPostCardActions(container, root, refresh) {
  const actions = {
    like(action) {
      store.toggleLike(action.dataset.postId);
      refresh();
    },
    'like-comment'(action) {
      store.toggleCommentLike(action.dataset.postId, action.dataset.commentId);
      refresh();
    },
    'view-profile'(action) {
      const userId = action.dataset.userId;
      store.setState({ viewingUserId: userId });
      router.navigate('profile-other', { userId });
    },
    'view-party'(action) {
      const partyId = action.dataset.partyId;
      store.setState({ viewingPartyId: partyId });
      router.navigate('party-detail', { partyId });
    },
    'send-comment'(action) {
      submitComment(container, action.dataset.postId, refresh);
    },
    'toggle-comments'(action) {
      const input = container.querySelector(`.post-comment-input[data-post-id="${action.dataset.postId}"]`);
      input?.focus();
    },
    'view-all-comments'(action) {
      showAllCommentsModal(container, action.dataset.postId, refresh);
    },
    'question-author'(action) {
      showQuestionModal(container, action.dataset.userId);
    },
    'report-post'(action) {
      showReportModal(action.dataset.postId);
    },
    'admin-delete-post'(action) {
      const postId = action.dataset.postId;
      confirmAdminDelete({
        title: 'Eliminar publicación',
        message: 'Se ocultará para todos. Queda en la papelera del panel y puedes restaurarla.',
        onConfirm: async (reason) => {
          await adminSoftDeletePost(postId, reason);
          removePostFromStore(postId);
          showToast('Publicación eliminada (admin) 🛡️', 'success');
          refresh();
        },
      });
    },
    'admin-delete-comment'(action) {
      const commentId = action.dataset.commentId;
      confirmAdminDelete({
        title: 'Eliminar comentario',
        message: 'Se ocultará para todos. Queda en la papelera del panel.',
        onConfirm: async (reason) => {
          await adminSoftDeleteComment(commentId, reason);
          removeCommentFromStore(commentId);
          showToast('Comentario eliminado (admin) 🛡️', 'success');
          refresh();
        },
      });
    },
  };

  root.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]');
    if (!action) return;
    actions[action.dataset.action]?.(action);
  });

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const input = e.target.closest('.post-comment-input');
    if (!input) return;
    e.preventDefault();
    submitComment(container, input.dataset.postId, refresh);
  });
}

const REPORT_REASONS = [
  { id: 'spam',           emoji: '🚫', label: 'Spam' },
  { id: 'offensive',      emoji: '😡', label: 'Ofensivo o discurso de odio' },
  { id: 'misinformation', emoji: '❌', label: 'Información falsa' },
  { id: 'self_promotion', emoji: '📢', label: 'Autopromoción' },
  { id: 'harassment',     emoji: '⚠️', label: 'Acoso o intimidación' },
  { id: 'other',          emoji: '📁', label: 'Otro' },
];

export function showReportModal(postId) {
  const overlay = createModal(`
    <div class="modal" style="max-height:80dvh;">
      <div class="modal-handle"></div>
      <div class="modal-title">Reportar publicación</div>
      <p style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-md);">
        ¿Por qué reportas esta publicación? Si recibe 10 reportes se ocultará automáticamente.
      </p>
      <div style="display:flex;flex-direction:column;gap:var(--space-sm);">
        ${REPORT_REASONS.map(r => `
          <button class="report-reason-btn" data-reason="${r.id}">
            <span class="report-reason-emoji">${r.emoji}</span>
            <span>${r.label}</span>
          </button>
        `).join('')}
      </div>
      <button class="btn btn-ghost btn-sm" id="cancel-report" style="width:100%;margin-top:var(--space-md);">Cancelar</button>
    </div>
  `);

  overlay.querySelector('#cancel-report').addEventListener('click', () => overlay.close());

  overlay.querySelectorAll('.report-reason-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const reason = btn.dataset.reason;
      overlay.close();
      try {
        const result = await reportPost(postId, reason);
        if (result?.hidden) {
          showToast(`Reporte registrado. La publicación fue ocultada (${result.count} reportes).`, 'success', 4500);
        } else {
          showToast(`Reporte registrado (${result?.count || '?'}/${result?.threshold || 10}).`, 'success');
        }
      } catch (err) {
        const msg = err?.message || '';
        if (msg.includes('cannot_report_own_post')) {
          showToast('No puedes reportar tu propia publicación.', 'error');
        } else if (msg.includes('post_not_found')) {
          showToast('La publicación ya no existe.', 'error');
        } else {
          showToast('No se pudo reportar la publicación.', 'error');
          console.warn('[report-post]', err);
        }
      }
    });
  });
}

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

  // Single delegated handler for post-card interactions, shared with
  // party-detail. After every action it refreshes by re-rendering the
  // wall — same as before the extraction.
  bindPostCardActions(container, root, () => renderWall(container));

  // Self-contained nav binding: the shared action handler can call
  // renderWall(container) (after like / send comment), which wipes the
  // bottom-nav DOM along with the rest. Re-bind here so the nav
  // buttons keep working regardless of how we got rendered. The
  // router wrapper still calls bindNavEvents() too — it's idempotent.
  bindNavEvents();
}

function showAllCommentsModal(container, postId, refresh) {
  const post = store.getState().posts.find(p => p.id === postId);
  if (!post) return;
  const comments = post.comments || [];
  const isAdmin = currentUserIsAdmin();

  const overlay = createModal(`
    <div class="modal" style="max-height:70dvh;">
      <div class="modal-handle"></div>
      <div class="modal-title">Comentarios (${comments.length})</div>
      <div style="display:flex;flex-direction:column;gap:var(--space-md);max-height:50dvh;overflow-y:auto;">
        ${comments.map(c => {
          const commenter = store.getUserById(c.userId);
          if (!commenter && !isAdmin) return '';
          const canModerate = isAdmin && !c._pending && !c._syncFailed;
          return `
            <div style="display:flex;gap:var(--space-sm);align-items:flex-start;">
              ${commenter ? `
                <span data-action="view-profile" data-user-id="${commenter.id}" style="cursor:pointer;display:inline-flex;">
                  ${avatarHTML(commenter, 'avatar-sm')}
                </span>
              ` : ''}
              <div style="flex:1;">
                <div ${commenter ? `data-action="view-profile" data-user-id="${commenter.id}" style="cursor:pointer;font-size:var(--text-sm);font-weight:600;"` : 'style="font-size:var(--text-sm);font-weight:600;opacity:0.7;"'}>${commenter ? sanitize(commenter.name) : 'Usuario'}</div>
                <div style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.5;">${sanitize(c.text)}</div>
                <div style="display:flex;align-items:center;gap:8px;margin-top:2px;">
                  <span style="font-size:var(--text-xs);color:var(--text-tertiary);">${formatRelative(new Date(c.createdAt))}</span>
                  ${commentLikeBtn(postId, c)}
                </div>
              </div>
              ${canModerate ? `<button data-action="admin-delete-comment" data-comment-id="${c.id}" title="Eliminar (admin)" style="background:transparent;border:none;color:#dc2626;cursor:pointer;padding:2px;align-self:flex-start;line-height:1;">🗑️</button>` : ''}
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
    refresh();
  };

  overlay.querySelector('#modal-comment-send').addEventListener('click', sendModalComment);
  overlay.querySelector('#modal-comment-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendModalComment();
  });

  // Clicks on a commenter's avatar/name → open their profile. The wall's
  // root-level delegate doesn't reach modals (they live in document.body),
  // so we wire a local delegate here.
  overlay.addEventListener('click', (e) => {
    const likeC = e.target.closest('[data-action="like-comment"]');
    if (likeC) {
      store.toggleCommentLike(likeC.dataset.postId, likeC.dataset.commentId);
      // toggleCommentLike repaints the wall BEHIND the modal (repaintIfNeeded),
      // but not the modal itself — swap just this button in place so its
      // heart/count update without closing the open comments sheet.
      const post = store.getState().posts.find(p => p.id === likeC.dataset.postId);
      const c = post?.comments?.find(x => x.id === likeC.dataset.commentId);
      if (c) likeC.outerHTML = commentLikeBtn(likeC.dataset.postId, c);
      return;
    }
    const del = e.target.closest('[data-action="admin-delete-comment"]');
    if (del) {
      const commentId = del.dataset.commentId;
      confirmAdminDelete({
        title: 'Eliminar comentario',
        message: 'Se ocultará para todos. Queda en la papelera del panel.',
        onConfirm: async (reason) => {
          await adminSoftDeleteComment(commentId, reason);
          removeCommentFromStore(commentId);
          showToast('Comentario eliminado (admin) 🛡️', 'success');
          overlay.close();
          refresh();
        },
      });
      return;
    }
    const trigger = e.target.closest('[data-action="view-profile"]');
    if (!trigger) return;
    const userId = trigger.dataset.userId;
    if (!userId) return;
    overlay.close();
    store.setState({ viewingUserId: userId });
    router.navigate('profile-other', { userId });
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
