// ============================================
// FEEDBACK — Simple SPA Router
// ============================================

class Router {
  constructor() {
    this.routes = Object.create(null);
    this.currentRoute = null;
    this.currentParams = {};
    this.navigating = false;          // guard against re-entrant navigation
    this._refreshTimer = null;        // debounce token for refreshCurrentRoute
  }

  register(name, renderFn) {
    this.routes[name] = renderFn;
  }

  navigate(name, params = {}) {
    // Re-entrancy guard: a renderer that calls router.navigate() inside
    // a click handler (e.g. nav button) could collide with another click
    // that fires mid-render. Drop the second call instead of corrupting
    // the route stack.
    if (this.navigating) return;

    const render = this.routes[name];
    if (!render) {
      console.warn(`Route "${name}" not found`);
      return;
    }
    const app = document.getElementById('app');
    if (!app) return;

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
      this.currentParams = params || {};
      window.scrollTo(0, 0);
      render(app, params);
    } finally {
      this.navigating = false;
    }
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
