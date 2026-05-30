// =====================================================================
// FEEDBACK — Service Worker
// =====================================================================
// Purpose is twofold:
//   1. Installability: a SW with a fetch handler is what makes Chrome
//      mint a *modern* WebAPK when the user taps "Add to home screen".
//      Without it, Chrome falls back to a legacy install that targets an
//      old Android SDK — which Google Play Protect then blocks with
//      "This app was built for an older version of Android".
//   2. A thin offline shell so a flaky connection still paints the last
//      view instead of the browser's dino page.
//
// Strategy: NETWORK-FIRST for same-origin GETs (so a deploy is picked up
// immediately — no stale bundle), falling back to cache only when the
// network fails. Cross-origin requests (Supabase REST/Realtime/Auth,
// Google, fonts) are left completely untouched: we never want a cached
// or intercepted auth/realtime response.
// =====================================================================

const CACHE = 'feedback-runtime-v1';

self.addEventListener('install', () => {
  // Activate this SW immediately on first install instead of waiting for
  // all tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GETs are cacheable; let POST/PUT/etc. pass straight through.
  if (request.method !== 'GET') return;

  // Leave cross-origin (Supabase, Google OAuth, CDNs) entirely alone.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Stash a copy of successful same-origin responses for offline.
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match('/'))
      )
  );
});

// =====================================================================
// Web Push notifications (added with migration 0015)
// =====================================================================
// The Edge Function `send-push` constructs the JSON payload server-side
// — see supabase/functions/send-push/index.ts — so this listener only
// has to parse it defensively and surface it as a system notification.
// Network-first caching above stays untouched.
// =====================================================================

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Some pushes arrive with no payload (raw signaling); show a generic
    // notification rather than dropping the event entirely.
    payload = {};
  }

  const title = payload.title || 'PartyRate';
  const body  = payload.body  || '';
  const url   = payload.url   || '/';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      data: { url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  const targetAbs = new URL(target, self.location.origin).href;

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    // Prefer a window already open on the exact target URL.
    let match = all.find((c) => c.url === targetAbs);

    // Otherwise fall back to any same-origin window so the user lands in
    // the app instead of opening a duplicate tab.
    if (!match) {
      match = all.find((c) => {
        try { return new URL(c.url).origin === self.location.origin; }
        catch { return false; }
      });
    }

    if (match) {
      try { await match.focus(); } catch { /* ignore */ }
      // If we focused a window that isn't on the target URL, try to
      // navigate it. Some engines (notably older Safari) don't
      // implement Client.navigate, so we silently ignore the failure.
      if (match.url !== targetAbs && 'navigate' in match) {
        try { await match.navigate(targetAbs); } catch { /* ignore */ }
      }
      return;
    }

    await self.clients.openWindow(targetAbs);
  })());
});
