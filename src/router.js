// ============================================
// FEEDBACK — Simple SPA Router
// ============================================

class Router {
  constructor() {
    this.routes = Object.create(null);
    this.currentRoute = null;
    this.navigating = false;  // guard against re-entrant navigation
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

      this.currentRoute = name;
      window.scrollTo(0, 0);
      render(app, params);
    } finally {
      this.navigating = false;
    }
  }

  getCurrentRoute() {
    return this.currentRoute;
  }
}

export const router = new Router();
