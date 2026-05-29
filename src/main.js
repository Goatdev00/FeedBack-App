// ============================================
// FEEDBACK — Main Application Entry Point
// ============================================
// "Live the Scene" — Tu radar social de fiestas en tiempo real
//
// Social network for parties, rave culture & nightlife.
// Built mobile-first with vanilla JS + Vite + Supabase.
// ============================================

import { initDebugOverlay } from './utils/debug-overlay.js';
// Must run before anything logs — visiting partyrate.site/?debug shows an
// on-screen console (iPhone has no reachable DevTools). No-op otherwise.
initDebugOverlay();

import { router } from './router.js';
import { store, isSunday, registerErrorSurface } from './data/mock-data.js';
import { showToast } from './utils/toast.js';

// Wire failed Supabase writes to visible toasts. Without this, an API
// rejection (FK violation, RLS denial, network) would just be a console
// warning the user never sees — they'd think "my post disappeared".
registerErrorSurface((msg) => showToast(msg, 'error', 4500));
import { bindNavEvents } from './components/nav.js';
import { initLavaLamp } from './utils/lava-lamp.js';
import { createModal } from './utils/dom.js';
import { isSupabaseConfigured } from './data/supabase.js';
import { onAuthChange } from './data/auth.js';
import { syncProfileIntoStore, clearLocalSession } from './data/profile-sync.js';
import { loadCloudState, flushCloudSave, stripCloudExclusions } from './data/cloud-state.js';
import { hydrateAll } from './data/api.js';
import { setupPullToRefresh } from './utils/pull-to-refresh.js';
import { refreshFromSupabaseInBackground } from './data/hydration.js';

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

// Apply the user's preferred theme SYNCHRONOUSLY from a dedicated
// top-level localStorage key BEFORE anything async happens — otherwise
// the page paints in the default theme for a beat, then flips when
// Supabase auth + profile sync complete (visible "flash of wrong theme").
try {
  const cachedTheme = localStorage.getItem('feedback.theme');
  if (cachedTheme === 'light' || cachedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', cachedTheme);
  }
} catch { /* localStorage might be denied in private mode */ }

// Register the service worker. This is what makes "Add to home screen"
// mint a modern WebAPK on Android — without a SW, Chrome falls back to a
// legacy install targeting an old Android SDK, which Google Play Protect
// blocks ("built for an older version of Android"). Registered after load
// so it never competes with the first paint. Dev (localhost over Vite) is
// fine too, but we guard on https/localhost to avoid noisy failures.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => {
      console.warn('[sw] registration failed', e);
    });
  });
}

initLavaLamp('lava-bg');

// Instagram-style pull-to-refresh: drag down from the top of any feed
// page to re-fetch the world from Supabase. Skips chat rooms / forms.
setupPullToRefresh(async () => {
  if (!isSupabaseConfigured()) return;
  try {
    const [realR, cloudR] = await Promise.allSettled([
      hydrateAll(),
      loadCloudState(),
    ]);
    const real  = realR.status  === 'fulfilled' ? realR.value  : null;
    const cloud = cloudR.status === 'fulfilled' ? cloudR.value : null;

    if (real) {
      const state = store.getState();
      const profilesById = new Map(real.profiles.map(u => [u.id, u]));
      const legacyUsers = state.users.filter(u => !profilesById.has(u.id) && u.id.startsWith('u'));
      // No more `real.parties.length ? real : cached` fallback: after the
      // 0012 wipe, an empty Supabase response is the TRUTH, not a stale
      // signal to fall back to localStorage. Show empty state honestly.
      store.setState({
        parties: real.parties,
        posts: real.posts,
        follows: real.follows,
        users: [...real.profiles, ...legacyUsers],
      });
    }
    if (cloud) {
      store.hydrateFromCloud(stripCloudExclusions(cloud));
    }

    // Re-render the page so the new state is reflected. This uses the
    // tracked currentParams so routes that need them (party-detail,
    // profile-other) don't lose their context.
    router.refreshCurrentRoute();
  } catch (e) {
    console.warn('[ptr] refresh failed', e);
  }
});

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
  // ALWAYS kick off hydration first — it doesn't block. Previously this
  // sat behind early `return` branches, so a new user going through
  // /onboarding → /wall never triggered the hydrate, leaving the wall
  // visibly empty (state.hydrated stayed false forever).
  refreshFromSupabaseInBackground();

  // FAST PATH: returning user with cached profile. Navigate immediately
  // using whatever state we have; the background hydrate just refreshes
  // the visible data once it lands.
  const cached = store.getState();
  if (cached.currentUser && cached.onboardingComplete) {
    routeWallOrSunday();
    return;
  }

  // SLOW PATH (first sign-in or onboarding incomplete): we need the
  // profile row to decide onboarding vs wall, so wait for it. Single
  // round-trip is acceptable here.
  let profile = await syncProfileIntoStore();
  // Retry once after a short delay: the `handle_new_user` trigger that
  // creates public.profiles from auth.users isn't always settled by the
  // time the OAuth callback fires (we've seen ~300ms gaps in practice).
  // Without this, brand-new users land on /wall with currentUser=null
  // and every page that needs it (profile, chats, notifications) bails.
  if (!profile) {
    await new Promise(r => setTimeout(r, 400));
    profile = await syncProfileIntoStore();
  }
  if (!profile) {
    console.warn('[routeAfterSession] session present but profile row missing — pages will use requireCurrentUser fallback');
    router.navigate('wall');
    return;
  }
  if (!profile.onboardingComplete) {
    router.navigate('onboarding');
    return;
  }
  routeWallOrSunday();
  // (we already kicked off refreshFromSupabaseInBackground at the top of
  // this function — the _inFlight guard would coalesce a second call,
  // but firing it again is just noise.)
}

function routeWallOrSunday() {
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

// refreshFromSupabaseInBackground moved to src/data/hydration.js so
// other modules (wall.js empty-state fallback, pull-to-refresh) can
// import it without creating a cycle with main.js.

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
