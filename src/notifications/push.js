// =====================================================================
// FEEDBACK / PartyRate — Web Push subscription helpers
// =====================================================================
// Single source of truth for "ask the browser for a Push subscription
// and store it in Supabase". The Edge Function `send-push` does the
// actual delivery later; this module only manages the registration side.
//
// Note: the spec assumes a `src/supabaseClient.js`. In this repo the
// initialized client lives at `src/data/supabase.js` (named export
// `supabase`), so we import from there. If you create a re-export
// shim at `src/supabaseClient.js`, update this path accordingly.
// =====================================================================

import { supabase } from '../data/supabase.js';

// VAPID public key — generate locally once with:
//   npx web-push generate-vapid-keys
// then expose the Public Key via .env as VITE_VAPID_PUBLIC_KEY (Vite
// inlines it at build time). Keep the Private Key OUT of the client and
// set it as a Supabase secret for the Edge Function (VAPID_PRIVATE_KEY).
export const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

// ---------------------------------------------------------------------
// VAPID public key arrives as URL-safe base64; PushManager.subscribe()
// wants the raw bytes as a Uint8Array.
// ---------------------------------------------------------------------
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function isPushSupported() {
  return typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && typeof window !== 'undefined'
    && 'PushManager' in window
    && 'Notification' in window;
}

// ---------------------------------------------------------------------
// The SW registration URL carries the VAPID public key as a query param
// so sw.js (which can't read the Vite bundle's env) can re-subscribe
// inside its pushsubscriptionchange handler even on engines that don't
// expose event.oldSubscription (Chrome — crbug 646721).
// ---------------------------------------------------------------------
export function swUrl() {
  return '/sw.js' + (VAPID_PUBLIC_KEY ? `?vapid=${encodeURIComponent(VAPID_PUBLIC_KEY)}` : '');
}

// ---------------------------------------------------------------------
// Resolve the SW registration WITHOUT navigator.serviceWorker.ready.
// `.ready` never rejects — if the boot registration failed (bad deploy,
// storage trouble), it stays pending FOREVER, and an await on it inside
// the logout path froze the whole sign-out flow. getRegistration()
// always settles; we fall back to registering ourselves.
// ---------------------------------------------------------------------
async function getSwRegistration() {
  try {
    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg) reg = await navigator.serviceWorker.register(swUrl());
    return reg || null;
  } catch (e) {
    console.warn('[push] no usable SW registration', e);
    return null;
  }
}

// ArrayBuffer → url-safe base64 (no padding), to compare a live
// subscription's applicationServerKey against VAPID_PUBLIC_KEY.
function bufToB64url(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------
// subscribeToPush(userId)
// Resolves to:
//   { granted: true,  subscription }   on success
//   { granted: false, permission }     when the user denied / dismissed
// Throws on real errors (unsupported browser, missing VAPID, DB write
// failed) so the caller can surface a message.
// ---------------------------------------------------------------------
export async function subscribeToPush(userId) {
  if (!isPushSupported()) throw new Error('push_not_supported');
  if (!VAPID_PUBLIC_KEY)  throw new Error('vapid_key_missing');
  if (!userId)            throw new Error('user_id_required');

  // Ask for permission FIRST, before any await that could outlive the
  // tap's transient user activation. On iOS standalone, requestPermission
  // must run under a live user gesture: if the first-ever launch is still
  // registering the SW and we await that first, the gesture is consumed
  // and WebKit auto-resolves 'denied' WITHOUT showing a prompt — the new
  // user gets "permiso denegado" having never been asked.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { granted: false, permission };
  }

  // The SW is registered at app boot in main.js. getSwRegistration()
  // re-registers if that failed, and never hangs (unlike `.ready`).
  const registration = await getSwRegistration();
  if (!registration) throw new Error('sw_unavailable');

  // Re-use the existing subscription when there is one. The browser
  // tracks it across sessions; calling subscribe() again would return
  // the same one, but checking first avoids a needless prompt on some
  // engines.
  let sub = await registration.pushManager.getSubscription();
  // Same VAPID-rotation guard as the boot resync: a leftover subscription
  // bound to an OLD public key looks alive but every send 403s forever.
  if (sub) {
    const liveKey = sub.options?.applicationServerKey;
    if (liveKey && bufToB64url(liveKey) !== VAPID_PUBLIC_KEY.replace(/=+$/, '')) {
      try { await sub.unsubscribe(); } catch { /* ignore */ }
      sub = null;
    }
  }
  if (!sub) {
    sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  await registerSubscriptionRow(sub);
  return { granted: true, subscription: sub };
}

// ---------------------------------------------------------------------
// registerSubscriptionRow(sub)
// Persists the subscription via the register_push_subscription RPC
// (migration 0029) instead of a direct upsert. The RPC is SECURITY
// DEFINER so it can also reassign an endpoint that previously belonged
// to ANOTHER account on this same device — the old direct upsert hit
// the update-own RLS policy in that case, failed, and left the previous
// user's row in place: device B kept receiving user A's private
// notifications. Endpoint ownership is device-level by design.
// ---------------------------------------------------------------------
async function registerSubscriptionRow(sub) {
  const { error } = await supabase.rpc('register_push_subscription', {
    p_endpoint: sub.endpoint,
    p_subscription: sub.toJSON(),
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------
// resyncPushSubscription(userId)
// SILENT maintenance, called on every boot once the session is settled
// (main.js schedulePushOffer). If notification permission is already
// granted, make sure (a) a browser-side subscription exists — push
// services rotate/expire endpoints and the sw.js pushsubscriptionchange
// handler may have re-subscribed while the app was closed — and (b) the
// server row points at the CURRENT endpoint and the CURRENT user.
// Never prompts; never throws (best-effort by design).
// ---------------------------------------------------------------------
export async function resyncPushSubscription(userId) {
  try {
    if (!isPushSupported() || !VAPID_PUBLIC_KEY || !userId) return;
    if (Notification.permission !== 'granted') return;

    const registration = await getSwRegistration();
    if (!registration) return;
    let sub = await registration.pushManager.getSubscription();

    // VAPID key rotation: a subscription bound to an OLD public key
    // looks alive but every send will 403 (key mismatch) forever. If the
    // live key differs from the bundle's, drop it and re-subscribe.
    if (sub) {
      const liveKey = sub.options?.applicationServerKey;
      if (liveKey && bufToB64url(liveKey) !== VAPID_PUBLIC_KEY.replace(/=+$/, '')) {
        try { await sub.unsubscribe(); } catch { /* ignore */ }
        sub = null;
      }
    }

    if (!sub) {
      // Permission granted but no (valid) subscription — rotated away,
      // cleared by the browser, or first boot after the user granted on
      // another path. Re-subscribing here needs no prompt.
      sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    await registerSubscriptionRow(sub);
  } catch (e) {
    console.warn('[push] resync failed (will retry next boot)', e);
  }
}

// ---------------------------------------------------------------------
// unsubscribeFromPush(userId)
// Tears down the subscription on THIS device only — other devices the
// user has registered keep working. We delete by endpoint (not by
// user_id) for the same reason.
// ---------------------------------------------------------------------
export async function unsubscribeFromPush(_userId) {
  if (!isPushSupported()) return { unsubscribed: false };

  // getRegistration (never hangs) instead of .ready: this runs in the
  // LOGOUT path — a forever-pending await here froze sign-out entirely
  // whenever the boot SW registration had failed.
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return { unsubscribed: false };
  const sub = await registration.pushManager.getSubscription();
  if (!sub) return { unsubscribed: false };

  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch (e) {
    console.warn('[push] sub.unsubscribe() threw', e);
  }

  // RPC (SECURITY DEFINER, 0029): removes the row by endpoint no matter
  // which account registered it — endpoint ownership is device-level.
  // Must run while still authenticated, i.e. BEFORE signOut() on logout.
  const { error } = await supabase.rpc('unregister_push_subscription', {
    p_endpoint: endpoint,
  });
  if (error) console.warn('[push] delete row failed', error);

  return { unsubscribed: true };
}
