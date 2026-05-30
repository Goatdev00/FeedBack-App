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

  // The SW is registered at app boot in main.js. If it isn't (e.g. the
  // helper is called before that registration resolves), do it here so
  // callers don't have to coordinate.
  let registration;
  try {
    registration = await navigator.serviceWorker.ready;
  } catch {
    registration = await navigator.serviceWorker.register('/sw.js');
    registration = await navigator.serviceWorker.ready;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { granted: false, permission };
  }

  // Re-use the existing subscription when there is one. The browser
  // tracks it across sessions; calling subscribe() again would return
  // the same one, but checking first avoids a needless prompt on some
  // engines.
  let sub = await registration.pushManager.getSubscription();
  if (!sub) {
    sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  // Upsert by endpoint — a user re-subscribing on the same device
  // refreshes the row instead of piling up duplicates.
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: userId,
        endpoint: sub.endpoint,
        subscription: sub.toJSON(),
      },
      { onConflict: 'endpoint' }
    );
  if (error) throw error;

  return { granted: true, subscription: sub };
}

// ---------------------------------------------------------------------
// unsubscribeFromPush(userId)
// Tears down the subscription on THIS device only — other devices the
// user has registered keep working. We delete by endpoint (not by
// user_id) for the same reason.
// ---------------------------------------------------------------------
export async function unsubscribeFromPush(_userId) {
  if (!isPushSupported()) return { unsubscribed: false };

  const registration = await navigator.serviceWorker.ready;
  const sub = await registration.pushManager.getSubscription();
  if (!sub) return { unsubscribed: false };

  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch (e) {
    console.warn('[push] sub.unsubscribe() threw', e);
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint);
  if (error) console.warn('[push] delete row failed', error);

  return { unsubscribed: true };
}
