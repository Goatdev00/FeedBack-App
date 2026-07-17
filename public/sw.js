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
// Strategy (v2 — "apertura instantánea"):
//   * /assets/* (bundles con hash en el nombre): CACHE-FIRST. El hash
//     cambia con cada deploy, así que un asset cacheado es inmutable
//     por definición — servirlo de caché es siempre correcto e
//     instantáneo (antes: network-first = cada apertura esperaba la red
//     aunque tuviera el bundle idéntico en disco).
//   * Navegaciones (index.html): STALE-WHILE-REVALIDATE. Se sirve el
//     shell cacheado AL INSTANTE y se revalida en segundo plano — un
//     deploy nuevo se aplica en la SIGUIENTE apertura. Es el trade
//     estándar de PWA: arranque inmediato > estreno inmediato.
//   * Resto de GETs same-origin (logos, manifest): stale-while-revalidate.
//   * Media pública de Supabase Storage (fotos/videos subidos): CACHE-
//     FIRST con poda — cada subida usa un path único, así que también
//     son inmutables. Un flyer visto una vez carga de disco para siempre.
//   * Cualquier otro cross-origin (REST/Auth/Realtime/fuentes): intacto.
// =====================================================================

const SHELL_CACHE = 'feedback-shell-v2';
const MEDIA_CACHE = 'feedback-media-v1';
const MEDIA_MAX_ENTRIES = 120; // fotos recientes; se podan las más viejas
// SOLO el bucket de imágenes. Los VIDEOS quedan fuera a propósito: iOS
// pide <video> con headers Range y esperaría 206 Partial Content — un
// cache.match devolvería el 200 completo ignorando el rango y rompería
// la reproducción (bug clásico de PWA). El CDN de Storage ya sirve los
// videos con soporte de rangos + HTTP cache del navegador.
const IMAGES_PUBLIC_PATH = '/storage/v1/object/public/images/';

// ---------------------------------------------------------------------
// refreshShellCache — actualización ATÓMICA del shell. Cierra la ventana
// de PANTALLA BLANCA en despliegues: el index cacheado referencia bundles
// con hash (/assets/index-<hash>.js) y GitHub Pages BORRA los hashes
// viejos al desplegar — si alguna vez cacheamos un index cuyos assets no
// quedaron cacheados, la próxima apertura pinta en blanco (el bundle ya
// no existe en la red). Reglas:
//   1. El index se pide con cache:'no-cache' — GH Pages sirve max-age=600
//     y el HTTP cache podría devolver el index PRE-deploy justo después
//     de desplegar (sus assets ya borrados).
//   2. Los assets del index nuevo se descargan y cachean PRIMERO; si
//     CUALQUIERA falla, se aborta SIN tocar el index cacheado — el par
//     viejo (index+assets) sigue coherente.
//   3. Solo con todos los assets en caché se commitea el index nuevo, y
//     entonces se podan los assets de deploys anteriores.
// El caller SIEMPRE pasa esta promesa a event.waitUntil — sin eso el
// navegador puede matar el SW entre el put del index y los assets.
// ---------------------------------------------------------------------
function refreshShellCache(cache) {
  return fetch('/', { cache: 'no-cache' }).then((indexResp) => {
    if (!indexResp || !indexResp.ok) throw new Error('index_fetch_failed');
    const commit = indexResp.clone();
    return indexResp.text().then((html) => {
      const refs = Array.from(new Set(html.match(/\/assets\/[A-Za-z0-9_.~-]+/g) || []));
      // TODOS los assets primero; un fallo cualquiera aborta el commit.
      return Promise.all(refs.map((ref) =>
        cache.match(ref).then((hit) => {
          if (hit) return undefined;
          return fetch(ref).then((r) => {
            if (!r || !r.ok) throw new Error('asset_fetch_failed: ' + ref);
            return cache.put(ref, r);
          });
        })
      )).then(() => cache.put('/', commit)).then(() =>
        // Poda: assets no referenciados por el index recién commiteado
        // son de deploys anteriores — sin esto la caché crece por siempre.
        cache.keys().then((keys) => Promise.all(
          keys
            .filter((k) => new URL(k.url).pathname.startsWith('/assets/')
              && !refs.includes(new URL(k.url).pathname))
            .map((k) => cache.delete(k)),
        ))
      );
    });
  });
}

self.addEventListener('install', (event) => {
  // Precachear el shell + SUS assets (atómico) para que incluso la
  // primera apertura offline pinte la app. El catch mantiene el install
  // resoluble: el push necesita el SW instalado aunque el precacheo
  // falle — el runtime lo reintenta en cada navegación.
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => Promise.all([
        refreshShellCache(c).catch(() => {}),
        c.addAll([
          '/manifest.json',
          '/logo-192.png',
          // Poppins auto-hospedada: con esto la tipografía también es
          // offline-first desde la primera apertura.
          '/fonts/poppins-300.woff2',
          '/fonts/poppins-400.woff2',
          '/fonts/poppins-500.woff2',
          '/fonts/poppins-600.woff2',
          '/fonts/poppins-700.woff2',
          '/fonts/poppins-800.woff2',
          '/fonts/poppins-900.woff2',
        ]).catch(() => {}),
      ]))
      .catch(() => {})
  );
  // Activate this SW immediately on first install instead of waiting for
  // all tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== MEDIA_CACHE)
          .map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim())
  );
});

// stale-while-revalidate: caché al instante si existe; la red actualiza
// la caché en segundo plano para la próxima vez. Sin caché → red. El
// caller pasa `event` para que el refresh viva bajo waitUntil (sin eso
// el navegador puede matar el SW con el put a medias).
function staleWhileRevalidate(event, request, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(request).then((cached) => {
      const refresh = fetch(request)
        .then((response) => {
          if (response && response.ok && (response.type === 'basic' || response.type === 'cors')) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cached); // offline: lo cacheado (o el fallo original)
      event.waitUntil(refresh.catch(() => {}));
      return cached || refresh;
    })
  );
}

// cache-first para recursos inmutables (assets con hash, media de Storage).
function cacheFirst(request, cacheName, { prune = 0, corsRefetch = false } = {}) {
  return caches.open(cacheName).then((cache) =>
    cache.match(request).then((cached) => {
      if (cached) return cached;
      // corsRefetch: los <img>/<video> disparan requests no-cors → la
      // respuesta sería "opaque" y Chrome la infla ~7MB de cuota cada
      // una. Storage sirve CORS abierto, así que re-pedimos en modo cors
      // para cachear una respuesta limpia y liviana.
      const req = corsRefetch ? new Request(request.url, { mode: 'cors' }) : request;
      return fetch(req)
        .then((response) => {
          if (response && response.ok) {
            // put encadenado (no fire-and-forget): respondWith mantiene
            // vivo el SW hasta resolver — así el put nunca queda a medias.
            return cache.put(request, response.clone()).then(() => {
              if (prune) pruneCache(cache, prune);
              return response;
            });
          }
          return response;
        })
        .catch(() => (corsRefetch ? fetch(request) : Promise.reject(new Error('fetch_failed'))));
    })
  );
}

// Poda FIFO: las Cache API keys conservan orden de inserción; borrar las
// primeras aproxima un LRU barato sin metadata extra.
function pruneCache(cache, maxEntries) {
  cache.keys().then((keys) => {
    if (keys.length <= maxEntries) return;
    keys.slice(0, keys.length - maxEntries).forEach((k) => cache.delete(k));
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GETs are cacheable; let POST/PUT/etc. pass straight through.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    // Bundles de Vite: hash en el nombre → inmutables → cache-first.
    if (url.pathname.startsWith('/assets/')) {
      event.respondWith(cacheFirst(request, SHELL_CACHE));
      return;
    }
    // Navegación SPA (todas resuelven al index): shell cacheado AL
    // INSTANTE; la actualización atómica (index+assets o nada) corre en
    // segundo plano bajo waitUntil. Primera visita sin caché: index de
    // red normal mientras el refresh puebla la caché en paralelo.
    if (request.mode === 'navigate') {
      event.waitUntil(
        caches.open(SHELL_CACHE).then((c) => refreshShellCache(c)).catch(() => {})
      );
      event.respondWith(
        caches.open(SHELL_CACHE).then((cache) =>
          cache.match('/').then((cached) =>
            cached || fetch(request).catch(() => cache.match('/'))
          )
        )
      );
      return;
    }
    // Logos, manifest, etc.
    event.respondWith(staleWhileRevalidate(event, request, SHELL_CACHE));
    return;
  }

  // Imágenes públicas de Supabase Storage: inmutables por path único →
  // cache-first con poda. Videos y el resto de cross-origin (REST/Auth/
  // Realtime/fuentes) NO se tocan — ver nota de Range arriba.
  if (url.pathname.startsWith(IMAGES_PUBLIC_PATH) && url.hostname.endsWith('.supabase.co')) {
    event.respondWith(
      cacheFirst(request, MEDIA_CACHE, { prune: MEDIA_MAX_ENTRIES, corsRefetch: true })
    );
  }
});

// =====================================================================
// Web Push notifications (added with migration 0015)
// =====================================================================
// The Edge Function `send-push` constructs the JSON payload server-side
// — see supabase/functions/send-push/index.ts — so this listener only
// has to parse it defensively and surface it as a system notification.
// La estrategia de caché v2 de arriba (cache-first + SWR) no interviene
// en esta sección.
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
