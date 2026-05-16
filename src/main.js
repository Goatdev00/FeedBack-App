// ============================================
// FEEDBACK — Main Application Entry Point
// ============================================
// "Live the Scene" — Tu radar social de fiestas en tiempo real
//
// Social network for parties, rave culture & nightlife.
// Built mobile-first with vanilla JS + Vite + Supabase.
// ============================================

import { router } from './router.js';
import { store, isSunday } from './data/mock-data.js';
import { bindNavEvents } from './components/nav.js';
import { initLavaLamp } from './utils/lava-lamp.js';
import { createModal } from './utils/dom.js';
import { isSupabaseConfigured } from './data/supabase.js';
import { onAuthChange } from './data/auth.js';
import { syncProfileIntoStore, clearLocalSession } from './data/profile-sync.js';
import { loadCloudState, flushCloudSave, stripCloudExclusions } from './data/cloud-state.js';
import { hydrateAll, subscribeRealtime } from './data/api.js';

// --- Pages ---
import { renderLogin } from './pages/login.js';
import { renderOnboarding } from './pages/onboarding.js';
import { renderWall } from './pages/wall.js';
import { renderProfile, renderProfileOther } from './pages/profile.js';
import { renderParties } from './pages/parties.js';
import { renderPartyDetail } from './pages/party-detail.js';
import { renderSelectParty } from './pages/select-party.js';
import { renderCreatePost } from './pages/create-post.js';
import { renderCreateParty } from './pages/create-party.js';
import { renderSundayRating } from './pages/sunday-rating.js';
import { renderNotifications } from './pages/notifications.js';
import { renderChatHub } from './pages/chat-hub.js';
import { renderChatParties } from './pages/chat-parties.js';
import { renderChatGeneral, renderChatParty } from './pages/chat.js';

// --- Register Routes ---
router.register('login', renderLogin);
router.register('onboarding', renderOnboarding);
router.register('wall', (container) => { renderWall(container); bindNavEvents(); });
router.register('profile', (container) => { renderProfile(container); bindNavEvents(); });
router.register('profile-other', (container, params) => { renderProfileOther(container, params); bindNavEvents(); });
router.register('parties', (container) => { renderParties(container); bindNavEvents(); });
router.register('party-detail', renderPartyDetail);
router.register('select-party', renderSelectParty);
router.register('create-post', renderCreatePost);
router.register('create-party', renderCreateParty);
router.register('sunday-rating', renderSundayRating);
router.register('notifications', (container) => { renderNotifications(container); bindNavEvents(); });
router.register('chat-hub', (container) => { renderChatHub(container); bindNavEvents(); });
router.register('chat-parties', (container) => { renderChatParties(container); bindNavEvents(); });
router.register('chat-general', renderChatGeneral);
router.register('chat-party', renderChatParty);

// =====================================================================
// Initialization
//
// Boot order:
//   1. Start the lava-lamp background.
//   2. If Supabase is configured, attach onAuthChange. supabase-js fires
//      INITIAL_SESSION once at boot (with either the persisted session or
//      null) so a single listener handles both first-load and live
//      sign-in/out events — no manual bootstrap call required.
//   3. If Supabase isn't configured, fall back to legacy demo mode.
//
// Routing rules inside `routeAfterSession`:
//   * No session                                      → /login
//   * Session, profile.onboarding_complete = false    → /onboarding
//   * Session, complete                               → /wall
//   * Today is Sunday and first time today           → /wall + Sunday modal
// =====================================================================

initLavaLamp('lava-bg');

// Force-flush any debounced cloud save before the tab closes. Without
// this, an action taken in the last 1.5s before closing would never
// reach Supabase. `pagehide` is more reliable than `beforeunload` on
// iOS Safari, but we register both as belt-and-suspenders.
if (isSupabaseConfigured()) {
  const flush = () => { flushCloudSave(store.getState()); };
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
}

if (isSupabaseConfigured()) {
  // Track which user the SPA is currently routing for. supabase-js fires
  // onAuthChange not only on sign-in / sign-out but ALSO on every
  // TOKEN_REFRESHED event (~every 50 min). Without this guard, every
  // refresh would force-navigate the user back to /wall, even if they
  // were mid-chat or mid-checkout. We only route when the user identity
  // actually transitions.
  let routedUserId = null;

  onAuthChange(async (session) => {
    const newUserId = session?.user?.id || null;

    if (!newUserId) {
      // Signed out (or initial null). Only reset + navigate if we had a
      // previously-routed user; otherwise we're just booting cold.
      if (routedUserId !== null || router.getCurrentRoute() === null) {
        clearLocalSession();
        router.navigate('login');
      }
      routedUserId = null;
      return;
    }

    if (newUserId !== routedUserId) {
      // Genuine sign-in or initial-session-restored.
      routedUserId = newUserId;
      await routeAfterSession();
    }
    // Same user, different event (TOKEN_REFRESHED, USER_UPDATED). Stay
    // on whatever route the user is on.
  });
} else {
  // Legacy demo mode: no Supabase wired up, send straight to the
  // localStorage-backed login flow.
  router.navigate('login');
}

async function routeAfterSession() {
  // Try a few times before giving up — a single network blip during the
  // first paint after OAuth shouldn't kick an authenticated user back to
  // the login screen.
  let profile = null;
  for (let attempt = 0; attempt < 3 && !profile; attempt++) {
    profile = await syncProfileIntoStore();
    if (!profile && attempt < 2) {
      await new Promise(r => setTimeout(r, 400 * (attempt + 1))); // 400ms, 800ms
    }
  }

  if (!profile) {
    // We KNOW the session is valid (onAuthChange already validated it).
    // The profile row just isn't reachable right now. Park on /wall —
    // it'll re-fetch when the user interacts, and the legacy localStorage
    // store keeps the UI functional in the meantime. Forcing /login here
    // would be a worse experience than a partially-empty wall.
    router.navigate('wall');
    return;
  }

  if (!profile.onboardingComplete) {
    router.navigate('onboarding');
    return;
  }

  // Hydrate the normalized entities (parties, posts, follows, profiles,
  // attendance) from Supabase. These are the source of truth in Phase 3.
  try {
    const real = await hydrateAll();
    if (real) {
      const state = store.getState();
      // Merge: real parties/posts replace the legacy mock; the legacy
      // mock users stay alongside real profiles so DJ/promotor avatars
      // for old seeds keep rendering until Phase 4 deprecates them.
      const profilesById = new Map(real.profiles.map(u => [u.id, u]));
      const legacyUsers = state.users.filter(u => !profilesById.has(u.id) && u.id.startsWith('u'));
      const mergedUsers = [...real.profiles, ...legacyUsers];

      store.setState({
        parties: real.parties.length ? real.parties : state.parties,
        posts: real.posts,
        follows: real.follows,
        users: mergedUsers,
      });
    }
  } catch (e) {
    console.warn('[main] supabase hydration failed', e);
  }

  // Subscribe to realtime changes — new posts / likes / comments from
  // OTHER users will appear in the wall without a refresh. Safe to call
  // multiple times: subscribeRealtime is idempotent.
  try { subscribeRealtime(store); } catch (e) { console.warn('[main] realtime failed', e); }

  // Hydrate the non-normalized leftovers (chat, ratings, questions,
  // awardedFollows, lastNotificationsViewed, etc.) from user_app_state.
  // Phase 4 will fold these into proper tables. Strip any keys that
  // belong to migrated entities (posts/parties/follows/users) before
  // merging — otherwise a stale blob would overwrite the shared feed.
  try {
    const cloud = await loadCloudState();
    if (cloud) store.hydrateFromCloud(stripCloudExclusions(cloud));
  } catch (e) {
    console.warn('[main] cloud hydration failed', e);
  }

  if (isSunday) {
    const sundayKey = `sunday_${new Date().toISOString().split('T')[0]}`;
    if (!sessionStorage.getItem(sundayKey)) {
      sessionStorage.setItem(sundayKey, '1');
      router.navigate('wall');
      setTimeout(showSundayPrompt, 1500);
      return;
    }
  }
  router.navigate('wall');
}

function showSundayPrompt() {
  const overlay = createModal(`
    <div class="modal" style="text-align:center;padding:var(--space-2xl);">
      <div style="font-size:3rem;margin-bottom:var(--space-md);">🏆</div>
      <h2 style="font-family:var(--font-display);font-size:var(--text-2xl);font-weight:700;background:linear-gradient(135deg,#FF6A00,#3F0A74);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:var(--space-sm);">
        ¡Es domingo de puntuación!
      </h2>
      <p style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-xl);line-height:1.6;">
        Califica las fiestas de esta semana y gana <strong style="color:#FF6A00;">+10 pts</strong> por cada una.
      </p>
      <div style="display:flex;gap:var(--space-sm);">
        <button class="btn btn-ghost" id="sunday-later" style="flex:1;">Más tarde</button>
        <button class="btn btn-primary" id="sunday-go" style="flex:1;">¡Vamos! 🎉</button>
      </div>
    </div>
  `);

  overlay.querySelector('#sunday-later').addEventListener('click', () => overlay.close());
  overlay.querySelector('#sunday-go').addEventListener('click', () => {
    overlay.close();
    router.navigate('sunday-rating');
  });
}
