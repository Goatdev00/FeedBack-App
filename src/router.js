// ============================================
// FEEDBACK — Simple SPA Router
// ============================================

class Router {
  constructor() {
    this.routes = Object.create(null);
    this.currentRoute = null;
  }

  register(name, renderFn) {
    this.routes[name] = renderFn;
  }

  navigate(name, params = {}) {
    const render = this.routes[name];
    if (!render) {
      console.warn(`Route "${name}" not found`);
      return;
    }
    const app = document.getElementById('app');
    if (!app) return;
    this.currentRoute = name;
    window.scrollTo(0, 0);
    render(app, params);
  }

  getCurrentRoute() {
    return this.currentRoute;
  }
}

export const router = new Router();
