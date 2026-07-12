// ============================================
// FEEDBACK — Profile Page (Own + Other)
// ============================================

import { store, ICONS, POINTS_RULES, formatRelative } from '../data/mock-data.js';
import { router } from '../router.js';
import { showToast, showPointsToast } from '../utils/toast.js';
import { avatarHTML, roleLabel, roleBadgeClass, roleTitle, sanitize, debounce } from '../utils/helpers.js';
import { createModal } from '../utils/dom.js';
import { renderBottomNav, bindNavEvents } from '../components/nav.js';
import { isSupabaseConfigured, supabase } from '../data/supabase.js';
import { createSupportTicket } from '../data/api.js';
import { signOut } from '../data/auth.js';
import { clearLocalSession, requireCurrentUser, patchProfile } from '../data/profile-sync.js';
import { flushCloudSave } from '../data/cloud-state.js';
import { unsubscribeFromPush } from '../notifications/push.js';
import { showPermissionModal, clearPushDecision } from '../notifications/permission-modal.js';
import { fileToResizedDataURL } from '../utils/image.js';

const CITY_OPTIONS = ['Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Cartagena', 'Otra'];

// Display order + emoji for the "¿Cómo ganar puntos?" guide shown in the
// points tab. Source of truth for the values themselves is POINTS_RULES.
const POINTS_EARN_GUIDE = [
  { key: 'attendParty',     emoji: '🎉' },
  { key: 'firstPost',       emoji: '✍️' },
  { key: 'ratePartySunday', emoji: '⭐' },
  { key: 'answerQuestion',  emoji: '💬' },
  { key: 'followConnection',emoji: '🤝' },
  { key: 'featuredPost',    emoji: '🔥' },
  { key: 'validatedReport', emoji: '🛡️' },
];

export function renderProfile(container, params = {}) {
  if (!requireCurrentUser(container)) return;
  const user = store.getState().currentUser;
  store.applyTheme(user.theme || 'dark');
  renderProfileView(container, user, true, params.tab);
}

export function renderProfileOther(container, params = {}) {
  const state = store.getState();
  const userId = params.userId || state.viewingUserId;
  const user = store.getUserById(userId);
  if (!user) { router.navigate('wall'); return; }
  const isOwn = state.currentUser && state.currentUser.id === userId;
  if (isOwn) store.applyTheme(user.theme || 'dark');
  // params.tab forwarded so deep-links (e.g. the "your question was
  // answered" notification) can open this profile straight on the
  // Questions tab where the answered Q&A lives.
  renderProfileView(container, user, isOwn, params.tab);
}

function renderSocialLinks(user) {
  const social = user.social || {};
  const links = [];

  // Handles are user-controlled input: strip any leading "@", URL-encode
  // for the href (quotes/slashes can't break the attribute or redirect
  // off-domain) and escape for the visible text.
  const handleOf = (raw) => String(raw || '').trim().replace(/^@+/, '');

  if (social.instagram) {
    const h = handleOf(social.instagram);
    links.push(`
      <a href="https://instagram.com/${encodeURIComponent(h)}" target="_blank" rel="noopener" class="social-link social-instagram" title="Instagram">
        <span class="social-icon">${ICONS.instagram}</span>
        <span class="social-handle">@${sanitize(h)}</span>
      </a>
    `);
  }
  if (social.tiktok) {
    const h = handleOf(social.tiktok);
    links.push(`
      <a href="https://tiktok.com/@${encodeURIComponent(h)}" target="_blank" rel="noopener" class="social-link social-tiktok" title="TikTok">
        <span class="social-icon">${ICONS.tiktok}</span>
        <span class="social-handle">@${sanitize(h)}</span>
      </a>
    `);
  }
  if (social.twitter) {
    const h = handleOf(social.twitter);
    links.push(`
      <a href="https://x.com/${encodeURIComponent(h)}" target="_blank" rel="noopener" class="social-link social-twitter" title="X (Twitter)">
        <span class="social-icon">${ICONS.twitter}</span>
        <span class="social-handle">@${sanitize(h)}</span>
      </a>
    `);
  }
  
  if (links.length === 0) return '';
  
  return `
    <div class="social-links">
      ${links.join('')}
    </div>
  `;
}

function renderProfileView(container, user, isOwn, initialTab) {
  const state = store.getState();
  const currentUser = state.currentUser;
  const followers = store.getFollowerCount(user.id);
  const following = store.getFollowingCount(user.id);
  const isFollowing = currentUser && !isOwn ? store.isFollowing(currentUser.id, user.id) : false;
  const userPosts = state.posts.filter(p => p.userId === user.id);
  const userParties = user.partiesAttended || [];
  const currentTheme = (isOwn ? user.theme : currentUser?.theme) || 'dark';

  container.innerHTML = `
    <div class="page" id="profile-page">
      ${!isOwn ? `
        <button class="back-btn" id="back-btn">
          ${ICONS.back}
          <span>Volver</span>
        </button>
      ` : ''}

      <!-- Theme Toggle (own profile only) -->
      ${isOwn ? `
        <div class="theme-toggle-wrapper">
          <button class="theme-toggle-btn" id="theme-toggle" title="${currentTheme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}">
            <span class="theme-icon theme-icon-sun ${currentTheme === 'light' ? 'active' : ''}">${ICONS.sun}</span>
            <span class="theme-icon theme-icon-moon ${currentTheme === 'dark' ? 'active' : ''}">${ICONS.moon}</span>
          </button>
        </div>
      ` : ''}

      <!-- Profile Header -->
      <div class="profile-header">
        <div class="profile-info">
          ${isOwn ? `
            <div class="avatar-edit-wrapper">
              ${avatarHTML(user, 'avatar-2xl', 'avatar-orange')}
              <button class="avatar-edit-btn" id="avatar-edit-btn" type="button"
                      aria-label="Cambiar foto de perfil" title="Cambiar foto">
                ${ICONS.edit}
              </button>
              <input type="file" id="avatar-edit-input" accept="image/*" hidden />
            </div>
          ` : avatarHTML(user, 'avatar-2xl', 'avatar-orange')}
          
          <div style="display:flex;align-items:center;gap:var(--space-sm);margin-top:var(--space-md);">
            <h1 class="profile-name">${sanitize(user.name)}</h1>
            ${user.premium ? '<span class="premium-badge">PRO</span>' : ''}
          </div>
          
          <p class="profile-username">${sanitize(user.username)}</p>
          
          <span class="badge ${roleBadgeClass(user.role)}">${roleLabel(user.role)}</span>
          
          <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
            <span style="width:14px;height:14px;display:inline-flex;color:var(--text-primary);">${ICONS.location}</span>
            <span style="font-size:var(--text-sm);color:var(--text-primary);">${sanitize(user.city)}</span>
          </div>

          ${user.bio ? `<p class="profile-bio">${sanitize(user.bio)}</p>` : ''}

          <!-- Social Media Links -->
          ${renderSocialLinks(user)}

          <!-- Points -->
          <div class="points-display" style="margin-top:var(--space-md);">
            ${ICONS.zap}
            <span>${user.points} pts</span>
          </div>

          <!-- Stats -->
          <div class="profile-stats">
            <div class="profile-stat">
              <span class="profile-stat-value">${followers}</span>
              <span class="profile-stat-label">Seguidores</span>
            </div>
            <div class="profile-stat">
              <span class="profile-stat-value">${following}</span>
              <span class="profile-stat-label">Siguiendo</span>
            </div>
            <div class="profile-stat">
              <span class="profile-stat-value">${userParties.length}</span>
              <span class="profile-stat-label">Fiestas</span>
            </div>
          </div>

          <!-- Actions -->
          <div style="display:flex;gap:var(--space-sm);margin-top:var(--space-lg);width:100%;">
            ${isOwn ? `
              <button class="btn btn-secondary btn-full btn-sm" id="edit-profile" style="gap:6px;">
                <span style="width:16px;height:16px;display:inline-flex;">${ICONS.edit}</span>
                Editar perfil
              </button>
              <button class="btn btn-ghost btn-icon btn-sm" id="settings-btn" style="width:40px;height:40px;">
                <span style="width:18px;height:18px;display:inline-flex;">${ICONS.settings}</span>
              </button>
            ` : `
              <button class="btn ${isFollowing ? 'btn-secondary following' : 'btn-primary'} follow-btn" id="follow-btn" style="flex:1;" data-user-id="${user.id}">
                ${isFollowing ? 'Siguiendo ✓' : 'Seguir'}
              </button>
              ${currentUser ? `
                <button class="btn btn-outline btn-sm" id="dm-btn" data-user-id="${user.id}" title="Enviar mensaje">
                  Mensaje
                </button>
              ` : ''}
              <button class="btn btn-outline btn-sm" id="ask-btn" data-user-id="${user.id}">
                ${ICONS.question}
              </button>
            `}
          </div>
        </div>
      </div>

      ${isOwn && store.getState().currentUser?.isAdmin ? `
        <!-- Centered in the gap between the edit-profile actions and the
             profile search. Solid silver (no gradient) per request. -->
        <div style="margin:var(--space-md) 0;">
          <button class="btn btn-full btn-sm btn-shine" id="superuser-btn" style="background:#c7c8cd;color:#1b1b22;border:1px solid rgba(0,0,0,0.18);gap:8px;font-weight:700;">
            <span style="width:16px;height:16px;display:inline-flex;">${ICONS.shield}</span>
            SUPERUSUARIO
          </button>
        </div>
      ` : ''}

      ${isOwn ? `
        <!-- Search Profiles — between the edit-profile action and the
             Publicaciones/Preguntas/Puntos tabs. Symmetric vertical
             margin so it sits exactly in the middle of the gap. -->
        <div style="margin-top:var(--space-md);margin-bottom:var(--space-md);">
          <div class="search-bar">
            ${ICONS.search}
            <input type="text" id="profile-search" placeholder="Buscar perfiles..." autocomplete="off" />
          </div>
          <div id="search-results"></div>
        </div>
      ` : ''}

      <!-- Tabs. initialTab (defaulting to 'posts') decides which one
           starts active — this is what makes the "tap notification →
           land on Preguntas" deep-link work. -->
      <div class="tab-bar" id="profile-tabs">
        <button class="tab-item ${(initialTab || 'posts') === 'posts' ? 'active' : ''}" data-tab="posts">Publicaciones</button>
        <button class="tab-item ${initialTab === 'questions' ? 'active' : ''}" data-tab="questions">Preguntas</button>
        <button class="tab-item ${initialTab === 'puntos' ? 'active' : ''}" data-tab="puntos">Puntos</button>
      </div>

      <!-- Tab Content -->
      <div id="profile-tab-content">
        ${
          initialTab === 'questions'
            ? renderQuestionsTab(store.getQuestionsForUser(user.id), isOwn, user.id)
            : initialTab === 'puntos'
              ? renderPointsTab(user)
              : renderPostsTab(userPosts)
        }
      </div>
    </div>

    ${renderBottomNav(isOwn ? 'profile' : '')}
  `;

  bindProfileEvents(container, user, isOwn);
  // If the page opened straight onto the Questions tab (e.g. from a
  // notification), bind the answer-submit + ask-input handlers now —
  // otherwise they only get wired when the user clicks the tab.
  if (initialTab === 'questions') bindQuestionEvents(container, user.id);
}

function renderPostsTab(posts) {
  if (posts.length === 0) {
    return `
      <div class="empty-state" style="padding:var(--space-xl);">
        <div style="font-size:2rem;margin-bottom:var(--space-sm);">📝</div>
        <h3 class="empty-state-title">Sin publicaciones</h3>
        <p class="empty-state-text">Las publicaciones aparecerán aquí</p>
      </div>
    `;
  }
  return posts.map(post => {
    const party = store.getPartyById(post.partyId);
    // Card becomes a navigation affordance ONLY when the parent party
    // still exists locally — taps would otherwise route to a missing
    // detail page. The data-action / data-party-id mirror the wall's
    // view-party contract so the page-level delegate below catches it.
    const clickAttrs = party
      ? `data-action="view-party" data-party-id="${party.id}" style="cursor:pointer;animation:fadeInUp 0.3s var(--ease-out);"`
      : `style="animation:fadeInUp 0.3s var(--ease-out);"`;
    return `
      <div class="card mb-md" ${clickAttrs}>
        ${party ? `
          <div class="post-party-tag" style="margin-bottom:var(--space-sm);">
            ${ICONS.location} ${sanitize(party.name)}
          </div>
        ` : ''}
        <p style="font-size:var(--text-sm);line-height:1.6;">${sanitize(post.content)}</p>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:var(--space-sm);">
          <span style="font-size:var(--text-xs);color:var(--text-tertiary);">${formatRelative(new Date(post.createdAt))}</span>
          <span style="font-size:var(--text-xs);color:var(--text-tertiary);">❤️ ${post.likes}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderQuestionsTab(questions, isOwn, userId) {
  const answeredQ = questions.filter(q => q.answer);
  const unansweredQ = questions.filter(q => !q.answer);

  // Ask box ALWAYS at the top for non-own profiles so the visitor's
  // intent ("ask something") never gets buried under previous Q&A.
  const askBox = !isOwn ? `
    <div style="margin-bottom:var(--space-lg);">
      <h4 style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-md);">Haz una pregunta anónima</h4>
      <div style="display:flex;gap:var(--space-sm);">
        <input type="text" class="input" id="inline-question-input" placeholder="Tu pregunta..." style="flex:1;font-size:var(--text-sm);" maxlength="200" />
        <button class="btn btn-primary btn-sm" id="inline-question-send" data-user-id="${userId}">${ICONS.send}</button>
      </div>
    </div>
  ` : '';

  // Section heading helper — both sections share the same look (small
  // caps, accent colour, counter) so visually they form a clear "top
  // half / bottom half" split per the requested layout.
  const sectionTitle = (label, count, color = 'var(--orange)') => `
    <h4 style="
      display:flex;align-items:center;gap:var(--space-xs);
      font-size:var(--text-sm);font-weight:700;letter-spacing:0.04em;
      text-transform:uppercase;color:${color};
      margin-bottom:var(--space-md);
    ">
      <span>${label}</span>
      <span style="
        font-size:var(--text-xs);font-weight:600;
        background:rgba(255,106,0,0.12);color:${color};
        padding:2px 8px;border-radius:999px;
      ">${count}</span>
    </h4>
  `;

  // Divider between the two sections.
  const divider = `<div style="height:1px;background:var(--border-subtle);margin:var(--space-xl) 0;"></div>`;

  let listHtml = '';

  // ===== TOP: questions made to this user =====
  // Owner sees pending (unanswered) here. Visitors only ever see
  // answered Q&A (RLS hides unanswered from them anyway), so the top
  // section is only meaningful on the owner's view.
  // Owner-only delete affordance. The RLS questions_delete policy (0017)
  // already allowed the target to remove harassing questions — this is
  // the UI that was missing for it.
  const deleteBtn = (q) => `
    <button class="question-delete-btn" data-question-id="${q.id}"
            title="Eliminar pregunta" aria-label="Eliminar pregunta"
            style="background:none;border:none;cursor:pointer;padding:2px 6px;color:var(--text-tertiary);line-height:1;"><span style="width:15px;height:15px;display:inline-flex;">${ICONS.trash}</span></button>
  `;

  if (isOwn && unansweredQ.length > 0) {
    listHtml += sectionTitle('Te han hecho', unansweredQ.length);
    listHtml += unansweredQ.map(q => `
      <div class="question-card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-sm);">
          <div class="question-anonymous">Anónimo · ${formatRelative(new Date(q.createdAt))}</div>
          ${deleteBtn(q)}
        </div>
        <div class="question-text">${sanitize(q.question)}</div>
        <div style="display:flex;gap:var(--space-sm);">
          <input type="text" class="input" placeholder="Tu respuesta..." data-question-id="${q.id}" style="flex:1;padding:10px 14px;font-size:var(--text-sm);" />
          <button class="btn btn-primary btn-sm answer-btn" data-question-id="${q.id}">${ICONS.send}</button>
        </div>
      </div>
    `).join('');
  }

  // ===== BOTTOM: questions this user has answered =====
  if (answeredQ.length > 0) {
    if (listHtml) listHtml += divider;
    listHtml += sectionTitle(
      isOwn ? 'Has respondido' : 'Respondidas',
      answeredQ.length,
      'var(--text-secondary)'
    );
    listHtml += answeredQ.map(q => `
      <div class="question-card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-sm);">
          <div class="question-anonymous">Anónimo · ${formatRelative(new Date(q.createdAt))}</div>
          ${isOwn ? deleteBtn(q) : ''}
        </div>
        <div class="question-text">${sanitize(q.question)}</div>
        <div class="question-answer">${sanitize(q.answer)}</div>
      </div>
    `).join('');
  }

  if (questions.length === 0 || (!isOwn && answeredQ.length === 0)) {
    // Hide pending-only state on foreign profiles (those rows are
    // invisible to the visitor anyway under RLS).
    listHtml = `
      <div class="empty-state" style="padding:var(--space-xl);">
        <div style="font-size:2rem;margin-bottom:var(--space-sm);">💬</div>
        <h3 class="empty-state-title">Sin preguntas aún</h3>
        <p class="empty-state-text">${isOwn ? 'Cuando te hagan preguntas aparecerán aquí' : 'Sé el primero en preguntar'}</p>
      </div>
    `;
  }

  return askBox + listHtml;
}

function renderPointsTab(user) {
  const points = user.points || 0;
  const guideItems = POINTS_EARN_GUIDE
    .map(({ key, emoji }) => {
      const rule = POINTS_RULES[key];
      if (!rule) return '';
      return `
        <li class="points-earn-item">
          <span class="points-earn-emoji">${emoji}</span>
          <span class="points-earn-label">${rule.label}</span>
          <span class="points-earn-value">+${rule.points}</span>
        </li>
      `;
    })
    .join('');

  return `
    <div class="points-tab">
      <div class="points-hero">
        <span class="points-hero-icon">${ICONS.zap}</span>
        <div class="points-hero-value">${points.toLocaleString('es')}</div>
        <div class="points-hero-label">${points === 1 ? 'punto acumulado' : 'puntos acumulados'}</div>
      </div>

      <h4 class="points-section-title">¿Cómo ganar más puntos?</h4>
      <ul class="points-earn-list">
        ${guideItems}
      </ul>

      <p class="points-tip">
        💡 Mantén tu racha: publica, califica las fiestas el domingo y responde preguntas para subir más rápido.
      </p>
    </div>
  `;
}

function bindProfileEvents(container, user, isOwn) {
  // Single page-level delegate for `data-action="view-party"` clicks
  // (currently only on post cards in the Publicaciones tab, but the
  // delegate works for any future card too). Lives on #profile-tab-content
  // so swapping the tab content via innerHTML doesn't lose the binding.
  const tabContent = container.querySelector('#profile-tab-content');
  if (tabContent) {
    tabContent.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-action="view-party"]');
      if (!trigger) return;
      const partyId = trigger.dataset.partyId;
      if (!partyId) return;
      store.setState({ viewingPartyId: partyId });
      router.navigate('party-detail', { partyId });
    });
  }

  // Back
  const backBtn = container.querySelector('#back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => router.navigate('wall'));
  }

  // Avatar pencil — only present on the user's own profile. Tapping the
  // pencil opens the OS file picker; on selection we resize to ~256px,
  // patch the profiles row (`avatar_url`) and re-render so the new image
  // shows up everywhere it's read from currentUser/users[].
  const avatarBtn = container.querySelector('#avatar-edit-btn');
  const avatarInput = container.querySelector('#avatar-edit-input');
  if (avatarBtn && avatarInput) {
    avatarBtn.addEventListener('click', () => avatarInput.click());
    avatarInput.addEventListener('change', async () => {
      const file = avatarInput.files?.[0];
      if (!file) return;
      // Disable while uploading so a double-tap doesn't fire two patches.
      avatarBtn.disabled = true;
      try {
        const dataURL = await fileToResizedDataURL(file, 256, 0.82);
        await patchProfile({ avatar_url: dataURL });
        showToast('Foto actualizada ✨', 'success');
        renderProfile(container);
      } catch (err) {
        console.warn('[profile] avatar upload failed', err);
        showToast('No se pudo actualizar la foto', 'error');
        avatarBtn.disabled = false;
      } finally {
        // Clear so picking the same file again still fires `change`.
        avatarInput.value = '';
      }
    });
  }

  // Theme toggle
  const themeToggle = container.querySelector('#theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      store.toggleTheme();
      // Re-render to update the toggle button state
      renderProfile(container);
    });
  }

  // Follow
  const followBtn = container.querySelector('#follow-btn');
  if (followBtn) {
    followBtn.addEventListener('click', () => {
      const result = store.toggleFollow(user.id) || {};
      const isNowFollowing = store.isFollowing(store.getState().currentUser.id, user.id);
      followBtn.className = `btn ${isNowFollowing ? 'btn-secondary following' : 'btn-primary'} follow-btn`;
      followBtn.style.flex = '1';
      followBtn.textContent = isNowFollowing ? 'Siguiendo ✓' : 'Seguir';

      if (result.awarded) {
        // Mutual connection achieved (both parties follow each other now).
        showPointsToast(10, `Conectados con ${user.name} 🤝`);
      } else {
        showToast(isNowFollowing ? `Siguiendo a ${user.name}` : `Dejaste de seguir a ${user.name}`, 'info');
      }
    });
  }

  // Mensaje privado (perfil ajeno): create_dm dedupea por dm_key, así que
  // abrir el chat con alguien con quien ya hablas reutiliza el hilo. El
  // spinner evita el doble-tap mientras la RPC responde; el error ya sale
  // en toast desde el store (createDM devuelve null).
  const dmBtn = container.querySelector('#dm-btn');
  if (dmBtn) {
    dmBtn.addEventListener('click', async () => {
      if (dmBtn.disabled) return;
      dmBtn.disabled = true;
      const originalLabel = dmBtn.innerHTML;
      dmBtn.innerHTML = '<span class="btn-spinner"></span>';
      const conversationId = await store.createDM(user.id);
      if (conversationId) {
        router.navigate('chat-conversation', { conversationId });
        return;
      }
      dmBtn.disabled = false;
      dmBtn.innerHTML = originalLabel;
    });
  }

  // Ask button
  const askBtn = container.querySelector('#ask-btn');
  if (askBtn) {
    askBtn.addEventListener('click', () => {
      const tabBtns = container.querySelectorAll('.tab-item');
      tabBtns.forEach(t => t.classList.remove('active'));
      tabBtns[1].classList.add('active'); // questions tab
      const content = container.querySelector('#profile-tab-content');
      const questions = store.getQuestionsForUser(user.id);
      content.innerHTML = renderQuestionsTab(questions, false, user.id);
      bindQuestionEvents(container, user.id);
    });
  }

  // Edit profile
  const editBtn = container.querySelector('#edit-profile');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      showEditProfileModal(container, user);
    });
  }

  // Settings / Logout
  const settingsBtn = container.querySelector('#settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      showSettingsModal();
    });
  }

  // Super-admin: open the moderation panel. Button only rendered for
  // currentUser.isAdmin; the /admin route + every admin RPC re-check
  // server-side, so this is a cosmetic shortcut.
  const superuserBtn = container.querySelector('#superuser-btn');
  if (superuserBtn) {
    superuserBtn.addEventListener('click', () => router.navigate('admin'));
  }

  // Tabs
  const tabs = container.querySelectorAll('.tab-item');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const content = container.querySelector('#profile-tab-content');
      switch (tab.dataset.tab) {
        case 'posts':
          content.innerHTML = renderPostsTab(store.getState().posts.filter(p => p.userId === user.id));
          break;
        case 'questions':
          content.innerHTML = renderQuestionsTab(store.getQuestionsForUser(user.id), isOwn, user.id);
          bindQuestionEvents(container, user.id);
          break;
        case 'puntos':
          content.innerHTML = renderPointsTab(user);
          break;
      }
    });
  });

  // Profile search
  const searchInput = container.querySelector('#profile-search');
  if (searchInput) {
    searchInput.addEventListener('input', debounce((e) => {
      const query = e.target.value.trim();
      const results = store.searchUsers(query);
      const resultsDiv = container.querySelector('#search-results');
      if (!query) {
        resultsDiv.innerHTML = '';
        return;
      }
      resultsDiv.innerHTML = results.length > 0
        ? results.filter(u => u.id !== user.id).map(u => `
          <div class="card mb-sm" style="display:flex;align-items:center;gap:var(--space-md);cursor:pointer;padding:var(--space-sm) var(--space-md);" data-action="view-profile" data-user-id="${u.id}">
            ${avatarHTML(u, 'avatar-sm')}
            <div style="flex:1;">
              <div style="font-size:var(--text-sm);font-weight:600;">${sanitize(u.name)}</div>
              <div style="font-size:var(--text-xs);color:var(--text-tertiary);">${sanitize(u.username)} · ${sanitize(u.city)}</div>
            </div>
            <span class="badge ${roleBadgeClass(u.role)}" style="font-size:0.5625rem;padding:2px 6px;">${roleTitle(u.role)}</span>
          </div>
        `).join('')
        : `<p style="font-size:var(--text-sm);color:var(--text-tertiary);text-align:center;padding:var(--space-lg);">No se encontraron perfiles</p>`;

      // Bind profile clicks
      resultsDiv.querySelectorAll('[data-action="view-profile"]').forEach(el => {
        el.addEventListener('click', () => {
          const userId = el.dataset.userId;
          store.setState({ viewingUserId: userId });
          router.navigate('profile-other', { userId });
        });
      });
    }, 250));
  }

  // Nav — single shared handler. The previous implementation also called
  // `bindNavFromContainer` here, doubling up with main.js and triggering two
  // router.navigate() calls per tap.
  bindNavEvents();
}

function bindQuestionEvents(container, userId) {
  // Answer buttons
  container.querySelectorAll('.answer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const qId = btn.dataset.questionId;
      const input = container.querySelector(`input[data-question-id="${qId}"]`);
      const answer = input?.value?.trim();
      if (!answer) { showToast('Escribe tu respuesta', 'error'); return; }
      store.answerQuestion(qId, answer);
      showToast('Respuesta enviada +5 pts ⚡', 'points');
      // Re-render questions tab
      const content = container.querySelector('#profile-tab-content');
      const questions = store.getQuestionsForUser(userId);
      const state = store.getState();
      const isOwn = state.currentUser && state.currentUser.id === userId;
      content.innerHTML = renderQuestionsTab(questions, isOwn, userId);
      bindQuestionEvents(container, userId);
    });
  });

  // Delete buttons (own profile only — the markup is gated by isOwn and
  // RLS questions_delete restricts the DELETE to target_id = auth.uid()).
  container.querySelectorAll('.question-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      store.deleteQuestion(btn.dataset.questionId);
      showToast('Pregunta eliminada', 'info');
      const content = container.querySelector('#profile-tab-content');
      const questions = store.getQuestionsForUser(userId);
      const state = store.getState();
      const isOwn = state.currentUser && state.currentUser.id === userId;
      content.innerHTML = renderQuestionsTab(questions, isOwn, userId);
      bindQuestionEvents(container, userId);
    });
  });

  // Inline question
  const sendBtn = container.querySelector('#inline-question-send');
  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      const input = container.querySelector('#inline-question-input');
      const text = input?.value?.trim();
      if (!text) { showToast('Escribe tu pregunta', 'error'); return; }
      store.addQuestion(userId, text);
      showToast('Pregunta enviada 📨', 'success');
      input.value = '';
    });
  }
}

function showEditProfileModal(container, user) {
  const social = user.social || {};
  const overlay = createModal(`
    <div class="modal">
      <div class="modal-handle"></div>
      <h2 class="modal-title">Editar perfil</h2>

      <div class="input-group mb-md">
        <label class="input-label">Nombre</label>
        <input type="text" class="input" id="edit-name" value="${sanitize(user.name)}" maxlength="30" />
      </div>
      <div class="input-group mb-md">
        <label class="input-label">Bio</label>
        <textarea class="input textarea" id="edit-bio" maxlength="150" style="min-height:80px;">${sanitize(user.bio || '')}</textarea>
      </div>
      <div class="input-group mb-md">
        <label class="input-label">Ciudad</label>
        <select class="input" id="edit-city">
          ${CITY_OPTIONS.map(c =>
            `<option value="${c}" ${user.city === c ? 'selected' : ''}>${c}</option>`
          ).join('')}
        </select>
      </div>

      <!-- Social Media -->
      <div style="margin-bottom:var(--space-md);">
        <label class="input-label" style="margin-bottom:var(--space-sm);display:block;">Redes sociales</label>
        <div class="input-group mb-sm">
          <div style="display:flex;align-items:center;gap:var(--space-sm);">
            <span class="social-edit-icon" style="width:20px;height:20px;color:var(--text-secondary);display:inline-flex;">${ICONS.instagram}</span>
            <input type="text" class="input" id="edit-instagram" value="${sanitize(social.instagram || '')}" placeholder="usuario de Instagram" style="flex:1;" />
          </div>
        </div>
        <div class="input-group mb-sm">
          <div style="display:flex;align-items:center;gap:var(--space-sm);">
            <span class="social-edit-icon" style="width:20px;height:20px;color:var(--text-secondary);display:inline-flex;">${ICONS.tiktok}</span>
            <input type="text" class="input" id="edit-tiktok" value="${sanitize(social.tiktok || '')}" placeholder="usuario de TikTok" style="flex:1;" />
          </div>
        </div>
        <div class="input-group mb-sm">
          <div style="display:flex;align-items:center;gap:var(--space-sm);">
            <span class="social-edit-icon" style="width:20px;height:20px;color:var(--text-secondary);display:inline-flex;">${ICONS.twitter}</span>
            <input type="text" class="input" id="edit-twitter" value="${sanitize(social.twitter || '')}" placeholder="usuario de X (Twitter)" style="flex:1;" />
          </div>
        </div>
      </div>

      <div style="display:flex;gap:var(--space-sm);">
        <button class="btn btn-secondary" id="cancel-edit" style="flex:1;">Cancelar</button>
        <button class="btn btn-primary" id="save-edit" style="flex:1;">Guardar</button>
      </div>
    </div>
  `);

  overlay.querySelector('#cancel-edit').addEventListener('click', () => overlay.close());

  overlay.querySelector('#save-edit').addEventListener('click', async () => {
    const name = overlay.querySelector('#edit-name').value.trim();
    const bio = overlay.querySelector('#edit-bio').value.trim();
    const city = overlay.querySelector('#edit-city').value;
    const stripAt = (v) => v.trim().replace(/^@+/, '');
    const instagram = stripAt(overlay.querySelector('#edit-instagram').value);
    const tiktok = stripAt(overlay.querySelector('#edit-tiktok').value);
    const twitter = stripAt(overlay.querySelector('#edit-twitter').value);
    if (!name) { showToast('El nombre es obligatorio', 'error'); return; }

    const saveBtn = overlay.querySelector('#save-edit');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando…';
    try {
      // Persist to public.profiles FIRST — this was a silent-data-loss
      // bug: the old handler only did store.setState, but currentUser is
      // excluded from the cloud blob, so syncProfileIntoStore() reverted
      // the edit on the next boot. patchProfile() (same path the avatar
      // flow uses) writes the row AND merges it back into the store.
      if (isSupabaseConfigured()) {
        await patchProfile({ name, bio: bio || null, city, social: { instagram, tiktok, twitter } });
      } else {
        const updatedUser = { ...user, name, bio, city, social: { instagram, tiktok, twitter } };
        const users = store.getState().users.map(u => u.id === user.id ? updatedUser : u);
        store.setState({ currentUser: updatedUser, users });
      }
      store.setState({ selectedCity: city });
      overlay.close();
      showToast('Perfil actualizado ✅', 'success');
      renderProfile(container);
    } catch (err) {
      console.error('[profile] save failed', err);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Guardar';
      showToast('No se pudo guardar el perfil. Intenta de nuevo.', 'error');
    }
  });
}

function showSettingsModal() {
  const overlay = createModal(`
    <div class="modal" style="max-height:70dvh;">
      <div class="modal-handle"></div>
      <h2 class="modal-title">Configuración</h2>

      <div style="display:flex;flex-direction:column;gap:var(--space-sm);">
        <button class="btn btn-secondary btn-full" id="btn-notifications" style="justify-content:flex-start;align-items:flex-start;flex-direction:column;gap:3px;height:auto;padding:12px 16px;text-align:left;">
          <span style="display:inline-flex;align-items:center;gap:8px;font-weight:600;">
            <span style="width:18px;height:18px;display:inline-flex;">${ICONS.bell}</span>
            Notificaciones
          </span>
          <span style="font-size:0.78rem;color:var(--text-tertiary);font-weight:400;line-height:1.35;padding-left:26px;">
            Activa las notificaciones push en este dispositivo
          </span>
        </button>
        <button class="btn btn-secondary btn-full" id="btn-support" style="justify-content:flex-start;align-items:flex-start;flex-direction:column;gap:3px;height:auto;padding:12px 16px;text-align:left;">
          <span style="display:inline-flex;align-items:center;gap:8px;font-weight:600;">
            <span style="width:18px;height:18px;display:inline-flex;">${ICONS.help}</span>
            Habla con soporte
          </span>
          <span style="font-size:0.78rem;color:var(--text-tertiary);font-weight:400;line-height:1.35;padding-left:26px;">
            ¿Se te presentó un error o tienes una petición?
          </span>
        </button>
        <button class="btn btn-secondary btn-full" id="btn-logout" style="justify-content:flex-start;color:var(--orange);">
          ${ICONS.logout}
          Cerrar sesión
        </button>
      </div>
    </div>
  `);

  overlay.querySelector('#btn-notifications').addEventListener('click', () => {
    overlay.close();
    // force: the user explicitly asked — bypass the "Ahora no" snooze and
    // explain blocked/already-active states instead of returning silently.
    const uid = store.getState().currentUser?.id;
    if (uid) showPermissionModal(uid, { force: true });
  });

  overlay.querySelector('#btn-support').addEventListener('click', () => {
    overlay.close();
    showSupportModal(store.getState().currentUser);
  });

  overlay.querySelector('#btn-logout').addEventListener('click', async () => {
    overlay.close();
    if (isSupabaseConfigured()) {
      // Force any debounced cloud save before we lose the session — the
      // user's last actions should still be in Supabase when they log
      // back in from another device.
      try { await flushCloudSave(store.getState()); } catch { /* noop */ }
      // Drop this device's push registration while the JWT is still
      // valid (the RPC needs auth). Without this, the device keeps
      // receiving the logged-out user's private notifications — worst
      // case, in front of whoever uses the phone next.
      try { await unsubscribeFromPush(); } catch { /* best-effort */ }
      await signOut();
    }
    // The push decision is device-scoped: without this, the NEXT account
    // on this device inherits the previous user's "Ahora no" snooze /
    // install-guide backoff and never gets offered notifications.
    clearPushDecision();
    clearLocalSession();
    router.navigate('login');
  });
}

// Dedicated "Habla con soporte" form: name / email / message → one row in
// public.support_tickets (the team reads them from the Supabase dashboard).
// Name is prefilled from the profile; email from the auth session (it's
// not stored on the profile, so we fill it asynchronously after the modal
// mounts). Both stay editable.
function showSupportModal(user) {
  const overlay = createModal(`
    <div class="modal" style="max-height:85dvh;overflow-y:auto;">
      <div class="modal-handle"></div>
      <h2 class="modal-title">Habla con soporte</h2>
      <p style="color:var(--text-secondary);font-size:0.9rem;line-height:1.5;margin:0 0 var(--space-lg);">
        ¿Se te presentó un error o tienes una petición? Cuéntanos y te respondemos lo antes posible.
      </p>

      <div class="input-group mb-md">
        <label class="input-label">Nombre</label>
        <input type="text" class="input" id="support-name" value="${sanitize(user?.name || '')}" maxlength="80" placeholder="Tu nombre" />
      </div>
      <div class="input-group mb-md">
        <label class="input-label">Correo</label>
        <input type="email" class="input" id="support-email" inputmode="email" autocomplete="email" maxlength="160" placeholder="tucorreo@ejemplo.com" />
      </div>
      <div class="input-group mb-md">
        <label class="input-label">Petición o mejora</label>
        <textarea class="input textarea" id="support-message" maxlength="2000" style="min-height:120px;" placeholder="Describe el error que viste o la mejora que te gustaría…"></textarea>
      </div>

      <div style="display:flex;gap:var(--space-sm);">
        <button class="btn btn-secondary" id="support-cancel" style="flex:1;">Cancelar</button>
        <button class="btn btn-primary" id="support-send" style="flex:1;">Enviar</button>
      </div>
    </div>
  `);

  // Prefill the email from the auth session (not stored on the profile).
  // Fired after mount so the modal opens instantly; the value lands a tick
  // later (usually instant — the session is cached).
  if (isSupabaseConfigured()) {
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        const email = session?.user?.email;
        const input = overlay.querySelector('#support-email');
        if (email && input && !input.value) input.value = email;
      })
      .catch(() => { /* noop — user can type it */ });
  }

  overlay.querySelector('#support-cancel').addEventListener('click', () => overlay.close());

  overlay.querySelector('#support-send').addEventListener('click', async () => {
    const name = overlay.querySelector('#support-name').value.trim();
    const email = overlay.querySelector('#support-email').value.trim();
    const message = overlay.querySelector('#support-message').value.trim();

    if (!name) { showToast('Escribe tu nombre', 'error'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Escribe un correo válido', 'error'); return; }
    if (!message) { showToast('Cuéntanos tu petición o el error', 'error'); return; }

    const sendBtn = overlay.querySelector('#support-send');
    sendBtn.disabled = true;
    sendBtn.textContent = 'Enviando…';
    try {
      await createSupportTicket({ name, email, message });
      overlay.close();
      showToast('¡Mensaje enviado! Te responderemos pronto 🙌', 'success', 4000);
    } catch (err) {
      console.error('[support] send failed', err);
      sendBtn.disabled = false;
      sendBtn.textContent = 'Enviar';
      showToast('No se pudo enviar. Intenta de nuevo.', 'error');
    }
  });
}

