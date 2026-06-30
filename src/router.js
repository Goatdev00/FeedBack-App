// ============================================
// FEEDBACK — Simple SPA Router (hash-synced)
// ============================================
// Phase-1 upgrade: every route now mirrors itself into location.hash
// (#/party/<id>, #/u/<userId>, …). What that buys:
//   * Back/forward buttons work — the Android back gesture pops the hash
//     instead of closing the installed PWA.
//   * Deep links: a shared URL or a push notification can land directly
//     on a party / profile / post (the boot path in main.js resolves the
//     initial hash after the session settles).
//   * Refresh keeps you on the page you were on.
// Hash routing (not pushState) because GitHub Pages serves no rewrites:
// every #/... URL still physically loads /index.html.
//
// The page-facing API is unchanged: register(name, fn) /
// navigate(name, params) / refreshCurrentRoute() — pages never touch the
// hash themselves.
// ============================================

// ---------------------------------------------------------------------
// Route ⇄ hash mapping. Two structures kept side by side:
//   ROUTE_PATHS  : name + params → hash path (for navigate writes)
//   parseHash()  : hash path → { name, params } (for reads: boot,
//                  back/forward, manual edits, push deep links)
// Param values are encoded going out and decoded coming in, so ids and
// usernames survive special characters.
// ---------------------------------------------------------------------
const ROUTE_PATHS = {
  login:           () => '/login',
  onboarding:      () => '/onboarding',
  wall:            (p) => p?.post ? `/wall?post=${encodeURIComponent(p.post)}` : '/wall',
  profile:         (p) => p?.tab ? `/profile?tab=${encodeURIComponent(p.tab)}` : '/profile',
  'profile-other': (p) => `/u/${encodeURIComponent(p?.userId || '')}${p?.tab ? `?tab=${encodeURIComponent(p.tab)}` : ''}`,
  parties:         () => '/parties',
  'party-detail':  (p) => `/party/${encodeURIComponent(p?.partyId || '')}`,
  'select-party':  () => '/select-party',
  'create-post':   (p) => p?.partyId ? `/create-post/${encodeURIComponent(p.partyId)}` : '/create-post',
  'create-party':  () => '/create-party',
  'sunday-rating': () => '/sunday-rating',
  notifications:   () => '/notifications',
  'chat-hub':      () => '/chats',
  'chat-parties':  () => '/chats/parties',
  'chat-general':  () => '/chat/general',
  'chat-party':    (p) => `/chat/party/${encodeURIComponent(p?.partyId || '')}`,
  admin:           () => '/admin',
};

// Auth-flow routes use history.replaceState instead of a pushed hash:
// we don't want "back" from the wall to land on a stale /login entry.
const REPLACE_ROUTES = new Set(['login', 'onboarding']);

/**
 * Parse a location.hash value ("#/party/abc?x=y") into { name, params }
 * or null when it doesn't correspond to any known route. Exported via
 * router.matchHash for the boot path in main.js.
 */
function parseHash(hash) {
  if (!hash || hash === '#' || hash === '#/') return null;
  let raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw.startsWith('/')) raw = '/' + raw;

  const qIdx = raw.indexOf('?');
  const path = qIdx === -1 ? raw : raw.slice(0, qIdx);
  const query = {};
  if (qIdx !== -1) {
    for (const pair of raw.slice(qIdx + 1).split('&')) {
      if (!pair) continue;
      const [k, v = ''] = pair.split('=');
      try { query[decodeURIComponent(k)] = decodeURIComponent(v); } catch { /* skip bad pair */ }
    }
  }

  const seg = path.split('/').filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });

  // Static one-segment routes first.
  const STATIC = {
    login: 'login', onboarding: 'onboarding', wall: 'wall',
    profile: 'profile', parties: 'parties', 'select-party': 'select-party',
    'create-party': 'create-party', 'sunday-rating': 'sunday-rating',
    notifications: 'notifications', chats: 'chat-hub', admin: 'admin',
  };
  if (seg.length === 1 && STATIC[seg[0]]) {
    const name = STATIC[seg[0]];
    if (name === 'wall' && query.post)   return { name, params: { post: query.post } };
    if (name === 'profile' && query.tab) return { name, params: { tab: query.tab } };
    return { name, params: {} };
  }
  if (seg.length === 1 && seg[0] === 'create-post') return { name: 'create-post', params: {} };

  // Parameterised / nested routes.
  if (seg.length === 2) {
    const [a, b] = seg;
    if (a === 'u' && b)           return { name: 'profile-other', params: { userId: b, ...(query.tab ? { tab: query.tab } : {}) } };
    if (a === 'party' && b)       return { name: 'party-detail', params: { partyId: b } };
    if (a === 'create-post' && b) return { name: 'create-post', params: { partyId: b } };
    if (a === 'chats' && b === 'parties') return { name: 'chat-parties', params: {} };
    if (a === 'chat' && b === 'general')  return { name: 'chat-general', params: {} };
  }
  if (seg.length === 3 && seg[0] === 'chat' && seg[1] === 'party' && seg[2]) {
    return { name: 'chat-party', params: { partyId: seg[2] } };
  }
  return null;
}

class Router {
  constructor() {
    this.routes = Object.create(null);
    this.currentRoute = null;
    this.currentParams = {};
    this.navigating = false;          // guard against re-entrant navigation
    this._refreshTimer = null;        // debounce token for refreshCurrentRoute
    this._suppressHash = null;        // hash we just wrote → skip its hashchange echo
    this._hasSession = null;          // injected by main.js (avoids a store import cycle)
  }

  register(name, renderFn) {
    this.routes[name] = renderFn;
  }

  /**
   * Inject the "is someone signed in?" check used by the hashchange
   * listener. Lives in main.js (router can't import the store —
   * mock-data.js already imports router.js). Without this guard, BACK
   * after a logout would re-render authenticated pages from the history
   * stack with the store already cleared.
   */
  setSessionCheck(fn) {
    this._hasSession = fn;
  }

  /** Public hash parser — used by main.js to resolve the initial deep link. */
  matchHash(hash) {
    const match = parseHash(hash);
    // Only resolve to routes that are actually registered.
    return match && this.routes[match.name] ? match : null;
  }

  navigate(name, params = {}) {
    // A page render that requests a redirect MID-render (e.g.
    // party-detail bouncing to /parties when the row isn't in the store
    // yet) used to be DROPPED silently by the re-entrancy guard —
    // leaving #app blank on cold deep links. Defer it to the next tick
    // instead: the outer render finishes, then the redirect runs.
    if (this.navigating) {
      setTimeout(() => this.navigate(name, params), 0);
      return;
    }
    if (!this._render(name, params)) return;
    this._syncHash(name, params);
  }

  /**
   * Render a route WITHOUT writing the hash. Used by navigate() (which
   * syncs after) and by the hashchange listener (where the hash is
   * already correct — re-writing it would push a duplicate entry).
   * Returns true when the render actually happened.
   */
  _render(name, params = {}) {
    // Re-entrancy guard: a renderer that calls router.navigate() inside
    // a click handler (e.g. nav button) could collide with another click
    // that fires mid-render. Drop the second call instead of corrupting
    // the route stack.
    if (this.navigating) return false;

    const render = this.routes[name];
    if (!render) {
      console.warn(`Route "${name}" not found`);
      return false;
    }
    const app = document.getElementById('app');
    if (!app) return false;

    this.navigating = true;
    try {
      // Tear down any lingering overlay modals from the previous route.
      // createModal() appends to document.body, so they survive innerHTML
      // swaps on #app and end up covering the whole screen with z-index
      // 600 — blocking every tap on the new page.
      document.querySelectorAll('.modal-overlay').forEach((node) => node.remove());

      // Cancel any pending refresh: it was queued against the old route's
      // data and would either render the old route on top of the new one
      // or double-render the new route once it lands.
      if (this._refreshTimer) {
        clearTimeout(this._refreshTimer);
        this._refreshTimer = null;
      }

      this.currentRoute = name;
      // CLONE the params: pages may consume one-shot params (wall.js
      // deletes `post` after the highlight) and mutating the original
      // object would corrupt the hash _syncHash writes right after.
      this.currentParams = { ...(params || {}) };
      window.scrollTo(0, 0);
      render(app, this.currentParams);
    } finally {
      this.navigating = false;
    }
    return true;
  }

  /** Mirror the just-rendered route into location.hash. */
  _syncHash(name, params) {
    const toPath = ROUTE_PATHS[name];
    if (!toPath) return; // unmapped route: leave the hash alone
    const target = '#' + toPath(params);
    if (window.location.hash === target) return;
    // replaceState doesn't fire hashchange — no suppression needed for
    // either replace branch below.
    if (REPLACE_ROUTES.has(name)) {
      try { history.replaceState(null, '', target); } catch { /* ignore */ }
      return;
    }
    if (!window.location.hash) {
      // First route of a hash-less session: replace instead of push.
      // Pushing would leave a dead "/" entry behind — the first BACK
      // press would do nothing visible (URL desyncs to "/") and a
      // second press would be needed to leave the app.
      try { history.replaceState(null, '', target); return; } catch { /* fall through */ }
    }
    this._suppressHash = target;
    window.location.hash = target; // pushes a history entry (back button!)
  }

  /**
   * Wire the hashchange listener. Called ONCE from main.js after every
   * route is registered (a hashchange arriving before registration would
   * hit "route not found").
   */
  initHashRouting() {
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash;
      // Echo of our own _syncHash write → swallow it.
      if (this._suppressHash === hash) {
        this._suppressHash = null;
        return;
      }
      this._suppressHash = null;
      const match = this.matchHash(hash);
      if (!match) return; // unknown hash: stay where we are

      // Auth-flow routes are never valid BACK/deep targets: re-rendering
      // a completed onboarding form (and re-submitting it) or a stale
      // login from the history stack is always wrong. Repair the URL to
      // the route actually on screen and stay put.
      if (REPLACE_ROUTES.has(match.name)) {
        const cur = ROUTE_PATHS[this.currentRoute];
        if (cur) {
          try { history.replaceState(null, '', '#' + cur(this.currentParams)); } catch { /* ignore */ }
        }
        return;
      }

      // No session (logout left old #/wall, #/profile… entries in the
      // history stack, or someone typed an internal hash on the login
      // screen) → everything routes to login. Without this, BACK after
      // logout rendered the previous user's cached feed.
      if (this._hasSession && !this._hasSession() && this.routes['login']) {
        this._render('login', {});
        try { history.replaceState(null, '', '#/login'); } catch { /* ignore */ }
        return;
      }

      // Already on that exact route → nothing to do (e.g. manual retype).
      if (match.name === this.currentRoute
          && JSON.stringify(match.params) === JSON.stringify(this.currentParams)) return;
      this._render(match.name, match.params);
    });
  }

  getCurrentRoute() {
    return this.currentRoute;
  }

  getCurrentParams() {
    return this.currentParams || {};
  }

  /**
   * Re-render the current route without modal teardown / scroll reset.
   *
   * Debounced ~60ms: during boot the hydration pipeline lands five+ data
   * slices (profile, posts, parties, follows, profiles, questions, cloud)
   * across a short window, and the realtime channel fires UPDATE events
   * for likes/comments/posts/parties/questions on top. Without
   * coalescing, every one of those would wipe `#app.innerHTML` and
   * rebuild from scratch — visible as 3–5 successive flickers of the
   * bottom nav, post cards and lava lamp. With one timer reused for
   * concurrent calls, the heaviest hydration burst paints once.
   *
   * Interactive paths (likes, comments, post creation) don't go through
   * refreshCurrentRoute — they call the page's render fn directly — so
   * this debounce never delays a user-driven repaint. The 60ms ceiling
   * is below human latency perception (~100ms) for the few places that
   * DO use this for foreground updates (route-level data refresh after
   * a server confirm).
   */
  refreshCurrentRoute() {
    if (!this.currentRoute) return;
    // Already scheduled → fold this call into the pending paint. The
    // render function reads live state at fire time, so any data that
    // landed between the schedule and the fire is included for free.
    if (this._refreshTimer) return;
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      this._doRefresh();
    }, 60);
  }

  _doRefresh() {
    if (!this.currentRoute) return;
    const render = this.routes[this.currentRoute];
    const app = document.getElementById('app');
    if (!render || !app) return;
    render(app, this.currentParams || {});
  }
}

export const router = new Router();
