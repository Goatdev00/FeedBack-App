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
import { bindNavEvents, mountBottomNav, setBottomNav } from './components/nav.js';
import { initLavaLamp } from './utils/lava-lamp.js';
import { initImageProtection } from './utils/image-protection.js';
import { createModal } from './utils/dom.js';
import { isSupabaseConfigured } from './data/supabase.js';
import { onAuthChange } from './data/auth.js';
import { syncProfileIntoStore, clearLocalSession } from './data/profile-sync.js';
import { loadCloudState, flushCloudSave, stripCloudExclusions } from './data/cloud-state.js';
import { hydrateAll } from './data/api.js';
import { setupPullToRefresh } from './utils/pull-to-refresh.js';
import { refreshFromSupabaseInBackground } from './data/hydration.js';
import { showPermissionModal } from './notifications/permission-modal.js';
import { resyncPushSubscription, swUrl } from './notifications/push.js';

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
import { renderAdmin } from './pages/admin.js';

// --- Register Routes ---
// setBottomNav() runs after every page render to flip the active tab on
// the persistent bottom nav (mounted once in index.html). Pages no
// longer embed the nav in their innerHTML, so they don't paint over it
// on each refresh — the result is a flicker-free nav across hydration
// repaints, navigations, and realtime updates. `null` hides it
// (auth/onboarding/create flows / single-purpose detail pages).
router.register('login',         (c, p) => { renderLogin(c, p);          setBottomNav(null);     });
router.register('onboarding',    (c, p) => { renderOnboarding(c, p);     setBottomNav(null);     });
router.register('wall',          (c, p) => { renderWall(c, p);           setBottomNav('wall');   });
router.register('profile',       (c, p) => { renderProfile(c, p);        setBottomNav('profile');});
router.register('profile-other', (c, p) => { renderProfileOther(c, p);   setBottomNav('');       });
router.register('parties',       (c, p) => { renderParties(c, p);        setBottomNav('parties');});
router.register('party-detail',  (c, p) => { renderPartyDetail(c, p);    setBottomNav(null);     });
router.register('select-party',  (c, p) => { renderSelectParty(c, p);    setBottomNav(null);     });
router.register('create-post',   (c, p) => { renderCreatePost(c, p);     setBottomNav(null);     });
router.register('create-party',  (c, p) => { renderCreateParty(c, p);    setBottomNav(null);     });
router.register('sunday-rating', (c, p) => { renderSundayRating(c, p);   setBottomNav(null);     });
router.register('notifications', (c, p) => { renderNotifications(c, p);  setBottomNav('');       });
router.register('chat-hub',      (c, p) => { renderChatHub(c, p);        setBottomNav('');       });
router.register('chat-parties',  (c, p) => { renderChatParties(c, p);    setBottomNav('');       });
router.register('chat-general',  (c, p) => { renderChatGeneral(c, p);    setBottomNav(null);     });
router.register('chat-party',    (c, p) => { renderChatParty(c, p);      setBottomNav(null);     });
router.register('admin',         (c, p) => { renderAdmin(c, p);          setBottomNav('');       });

// Hash routing (back button / deep links / refresh). Must come AFTER all
// register() calls — a hashchange that fires before registration would
// hit "route not found" and drop the navigation.
router.setSessionCheck(() => !!store.getState().currentUser);
router.initHashRouting();

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
    // swUrl() appends ?vapid=<public key> so sw.js can re-subscribe in
    // its pushsubscriptionchange handler (Chrome doesn't expose
    // event.oldSubscription, so the key can't come from the event).
    navigator.serviceWorker.register(swUrl()).catch((e) => {
      console.warn('[sw] registration failed', e);
    });
  });
}

// Lava lamp background — LOCKED design. Full rationale + invariants at
// the top of src/utils/lava-lamp.js. The default args target the
// <canvas id="lava-canvas"> in index.html; don't pass anything unless
// you've also renamed the element and updated main.css accordingly.
initLavaLamp();

// Block long-press "save/copy image" + drag-to-save on all photos.
// Delegated on document so it also covers images injected by later route
// re-renders. Pairs with the img CSS rules in main.css (iOS callout).
initImageProtection();

// Persistent bottom nav — populate the <nav id="bottom-nav"> element in
// index.html once. From here on each route's setBottomNav(tab) only
// toggles the active class, so the bar stops flickering on page swaps.
mountBottomNav();

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
        // Cold boot with a deep link but no session: navigate('login')
        // replaceState's #/login OVER the deep-link hash, destroying it
        // before the user can authenticate. Stash it first; it's
        // consumed (with a TTL) once the session lands.
        stashPendingDeepLink();
        clearLocalSession();
        router.navigate('login');
      }
      routedUserId = null;
      return;
    }

    if (newUserId !== routedUserId) {
      // Genuine sign-in or initial-session-restored. Pass the session we
      // already have straight down so the boot path never re-calls
      // getSession() (which serializes behind supabase-js's auth lock).
      routedUserId = newUserId;
      await routeAfterSession(session);
    }
    // Same user, different event (TOKEN_REFRESHED, USER_UPDATED). Stay
    // on whatever route the user is on.
  });
} else {
  // Legacy demo mode: no Supabase wired up, send straight to the
  // localStorage-backed login flow.
  router.navigate('login');
}

async function routeAfterSession(session) {
  // ALWAYS kick off hydration first — it doesn't block. Previously this
  // sat behind early `return` branches, so a new user going through
  // /onboarding → /wall never triggered the hydrate, leaving the wall
  // visibly empty (state.hydrated stayed false forever).
  refreshFromSupabaseInBackground(session);

  // FAST PATH: returning user with cached profile. Navigate immediately
  // using whatever state we have; the background hydrate just refreshes
  // the visible data once it lands.
  const cached = store.getState();
  if (cached.currentUser && cached.onboardingComplete) {
    navigateFromHashOrWall();
    return;
  }

  // SLOW PATH (first sign-in or onboarding incomplete): we need the
  // profile row to decide onboarding vs wall, so wait for it. Single
  // round-trip is acceptable here.
  let profile = await syncProfileIntoStore(session);
  // Retry once after a short delay: the `handle_new_user` trigger that
  // creates public.profiles from auth.users isn't always settled by the
  // time the OAuth callback fires (we've seen ~300ms gaps in practice).
  // Without this, brand-new users land on /wall with currentUser=null
  // and every page that needs it (profile, chats, notifications) bails.
  if (!profile) {
    await new Promise(r => setTimeout(r, 400));
    profile = await syncProfileIntoStore(session);
  }
  if (!profile) {
    console.warn('[routeAfterSession] session present but profile row missing — pages will use requireCurrentUser fallback');
    navigateFromHashOrWall();
    return;
  }
  if (!profile.onboardingComplete) {
    router.navigate('onboarding');
    return;
  }
  navigateFromHashOrWall();
  // (we already kicked off refreshFromSupabaseInBackground at the top of
  // this function — the _inFlight guard would coalesce a second call,
  // but firing it again is just noise.)
}

// ---------------------------------------------------------------------
// Pending deep link — survives the login round-trip. When a cold boot
// carries a deep-link hash but no session, the redirect to #/login
// destroys the hash; we stash it (localStorage so it also survives the
// OAuth full-page redirect) and replay it once the session lands.
// ---------------------------------------------------------------------
const PENDING_LINK_KEY = 'feedback.pendingDeepLink';
const PENDING_LINK_TTL_MS = 30 * 60 * 1000;

function stashPendingDeepLink() {
  try {
    const match = router.matchHash(window.location.hash);
    if (!match || match.name === 'login' || match.name === 'onboarding') return;
    localStorage.setItem(PENDING_LINK_KEY, JSON.stringify({
      hash: window.location.hash,
      at: Date.now(),
    }));
  } catch { /* ignore */ }
}

function consumePendingDeepLink() {
  try {
    const raw = localStorage.getItem(PENDING_LINK_KEY);
    if (!raw) return null;
    localStorage.removeItem(PENDING_LINK_KEY);
    const { hash, at } = JSON.parse(raw);
    if (!hash || Date.now() - (at || 0) > PENDING_LINK_TTL_MS) return null;
    return router.matchHash(hash);
  } catch { return null; }
}

// Routes whose render needs hydrated store data to resolve their param
// (they bounce to a list page when the row is missing). On a cold boot,
// navigating to them BEFORE hydration means the bounce — paint the wall
// first and jump once the data lands.
const DATA_DEEPLINK_ROUTES = new Set(['party-detail', 'chat-party', 'profile-other', 'create-post']);

/**
 * Resolve the landing route once the session is settled. Priority:
 * (1) a deep link stashed before the login round-trip, (2) the current
 * hash (#/party/x, #/u/y, #/wall?post=z — shared links and tapped push
 * notifications), (3) the usual wall (+ Sunday prompt). Auth-flow
 * hashes are never deep-link targets.
 */
function navigateFromHashOrWall() {
  const target = consumePendingDeepLink() || router.matchHash(window.location.hash);
  if (target && target.name !== 'login' && target.name !== 'onboarding') {
    if (DATA_DEEPLINK_ROUTES.has(target.name) && !store.getState().hydrated) {
      // Cold store: the target page would bounce ("party not found").
      // Paint the wall now, jump to the target when hydration lands.
      // refreshFromSupabaseInBackground was already kicked off by
      // routeAfterSession — this returns the SAME in-flight promise.
      router.navigate('wall');
      Promise.resolve(refreshFromSupabaseInBackground()).then(() => {
        router.navigate(target.name, target.params);
      });
    } else {
      router.navigate(target.name, target.params);
    }
    schedulePushOffer();
    return;
  }
  routeWallOrSunday();
}

function routeWallOrSunday() {
  if (isSunday) {
    const sundayKey = `sunday_${new Date().toISOString().split('T')[0]}`;
    if (!sessionStorage.getItem(sundayKey)) {
      sessionStorage.setItem(sundayKey, '1');
      router.navigate('wall');
      setTimeout(showSundayPrompt, 1500);
      schedulePushOffer();
      return;
    }
  }
  router.navigate('wall');
  schedulePushOffer();
}

// Offer/maintain web push once the landing page has had a moment to
// paint. Two halves:
//   * resyncPushSubscription — SILENT. If permission is already granted,
//     re-register the (possibly rotated) endpoint with the server. This
//     is what keeps notifications alive long-term: push services rotate
//     endpoints and iOS/Chrome can drop subscriptions; without a boot
//     resync those users silently stop receiving pushes forever.
//   * showPermissionModal — self-inhibits per its own decision/EXPIRY
//     logic, handles the iOS install-first flow, and no-ops where push
//     isn't supported.
function schedulePushOffer() {
  setTimeout(() => {
    const uid = store.getState().currentUser?.id;
    if (!uid) return;
    resyncPushSubscription(uid);
    // Only interrupt with UI on the wall — a session that landed on a
    // shared deep link (#/party/x) shouldn't get the content covered by
    // a permission modal or the iOS install guide.
    if (router.getCurrentRoute() === 'wall') showPermissionModal(uid);
  }, 1500);
}

// refreshFromSupabaseInBackground moved to src/data/hydration.js so
// other modules (wall.js empty-state fallback, pull-to-refresh) can
// import it without creating a cycle with main.js.

// ---------------------------------------------------------------------
// Resume refetch — hydration only ran at BOOT. When a suspended PWA/tab
// comes back to the foreground (e.g. the user taps a push notification
// and the service worker merely FOCUSES the already-open window),
// realtime events missed during suspension are gone forever and every
// list is stale: a question that arrived while the app slept simply
// isn't in state ("me llegó el push pero no veo la pregunta").
// refreshFromSupabaseInBackground coalesces concurrent calls and paints
// once at the end; the throttle keeps rapid tab-switching cheap.
// ---------------------------------------------------------------------
let _lastResumeRefresh = Date.now(); // boot hydrates already — skip the first window
function refreshOnResume() {
  if (document.visibilityState !== 'visible') return;
  if (!store.getState().currentUser?.id) return; // no session → nothing to fetch
  const now = Date.now();
  if (now - _lastResumeRefresh < 15_000) return;
  _lastResumeRefresh = now;
  refreshFromSupabaseInBackground();
}
document.addEventListener('visibilitychange', refreshOnResume);
// bfcache restores (iOS back-forward) don't fire visibilitychange.
window.addEventListener('pageshow', (e) => { if (e.persisted) refreshOnResume(); });

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
