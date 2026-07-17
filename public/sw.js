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

  // The payload carries BOTH shapes: legacy top-level {title, body, url,
  // tag} (ours) and the Declarative Web Push wrapper {web_push: 8030,
  // notification: {title, body, navigate, tag, ...}}. On Safari 18.4+
  // the declarative member lets the SYSTEM display the notification even
  // if this SW was evicted (mutable: true keeps us in the loop when
  // alive). Here we prefer the notification member, falling back to the
  // legacy fields, so any combination of old/new server × old/new SW
  // still shows something correct.
  const n = payload.notification || {};
  const title = n.title || payload.title || 'PartyRate';
  const body  = (n.body != null ? n.body : payload.body) || '';
  const url   = (n.data && n.data.url) || payload.url || n.navigate || '/';
  const tag   = n.tag || payload.tag || undefined;

  const options = {
    body,
    // /logo-192.png is a real file in public/ (the old /icons/icon-192
    // and /icons/badge-72 never existed — every push showed a broken
    // generic icon). No `badge`: it requires a dedicated monochrome
    // 72px asset; omitting it falls back to the browser default.
    icon: '/logo-192.png',
    timestamp: Date.now(),
    data: { url },
  };
  // tag: same-conversation pushes REPLACE each other in the tray on
  // Chrome/Android instead of stacking; renotify keeps each replacement
  // audible. renotify without tag throws on Chrome — only set together.
  // iOS ignores both today (WebKit 258922) and simply stacks.
  if (tag) {
    options.tag = tag;
    options.renotify = true;
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

// ---------------------------------------------------------------------
// pushsubscriptionchange — the push service rotated or expired this
// device's endpoint. We re-subscribe so the binding stays alive;
// persisting the NEW endpoint to Supabase happens on the next app boot
// via resyncPushSubscription() (the SW holds no auth session). Until
// that boot, sends to the old endpoint 404/410 and get pruned
// server-side — by design.
//
// Key sourcing, in order:
//   1. event.oldSubscription.options.applicationServerKey — per spec,
//      but Chrome never implemented PushSubscriptionChangeEvent
//      (crbug 646721): there the event is a plain ExtendableEvent.
//   2. ?vapid=<key> in this SW's own registration URL (main.js
//      registers /sw.js?vapid=… precisely for this fallback).
// If neither is available, the boot-time resync remains the safety net.
// ---------------------------------------------------------------------
function vapidKeyFromRegistrationUrl() {
  try {
    const k = new URL(self.location.href).searchParams.get('vapid');
    if (!k) return null;
    const padding = '='.repeat((4 - (k.length % 4)) % 4);
    const b64 = (k + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const key = event.oldSubscription?.options?.applicationServerKey
        || vapidKeyFromRegistrationUrl();
      if (!key) return;
      await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
    } catch (e) {
      // Next boot's resync re-subscribes anyway; nothing else to do here.
      console.warn('[sw] pushsubscriptionchange resubscribe failed', e);
    }
  })());
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
