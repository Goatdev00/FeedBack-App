// =====================================================================
// FEEDBACK — Background hydration orchestrator
// =====================================================================
// Single source of truth for "go re-fetch everything from Supabase and
// reconcile it into the store". Lives in its own module so the entry
// point (main.js) AND individual pages (wall.js's empty-state fallback,
// pull-to-refresh) can call the SAME idempotent function without
// importing main.js (which would create a circular dependency).
//
// What it does (fully parallel, render-as-you-go):
//   - Fire all four side fetches at once: profile sync, hydrateAll,
//     loadCloudState, subscribeRealtime. Each resolves independently and
//     pushes its slice into the store + refreshes the route THE MOMENT it
//     lands. The old shape awaited Promise.allSettled before doing
//     anything, so the slowest query gated the first paint of EVERY
//     other slice — that was a big chunk of the 20-second boot.
//   - Realtime subscription starts in parallel too: no point waiting for
//     queries before opening the WebSocket.
//   - state.hydrated flips to true the moment hydrateAll resolves (real
//     data is on screen). Skeletons swap out as soon as data is real,
//     not when the slowest peripheral request also settles.
//
// Re-entrancy guard: simultaneous callers (boot + pull-to-refresh +
// wall's auto-trigger) are coalesced into one in-flight refresh. Extra
// calls during that window are no-ops.
// =====================================================================

import { store } from './mock-data.js';
import { hydrateAll, subscribeRealtime } from './api.js';
import { loadCloudState, stripCloudExclusions } from './cloud-state.js';
import { syncProfileIntoStore } from './profile-sync.js';
import { router } from '../router.js';

const DATA_DRIVEN_ROUTES = new Set([
  'wall',
  'parties',
  'party-detail',
  'profile',
  'profile-other',
  'notifications',
  'chat-hub',
  'chat-parties',
]);

let _inFlight = false;

function maybeRefreshRoute() {
  if (DATA_DRIVEN_ROUTES.has(router.getCurrentRoute())) {
    router.refreshCurrentRoute();
  }
}

export function refreshFromSupabaseInBackground() {
  if (_inFlight) return;
  _inFlight = true;

  // Realtime is fire-and-forget. Open the WS up front so server-pushed
  // changes can start streaming while the initial fetch is still in
  // flight; the subscribe helper is idempotent.
  try { subscribeRealtime(store); } catch (e) { console.warn('[hydrate] realtime failed', e); }

  // --- profile sync (independent) ---
  const profilePromise = syncProfileIntoStore()
    .catch(e => { console.warn('[hydrate] profile sync failed', e); return null; });

  // --- hydrateAll (the big one — controls when the wall stops being a skeleton) ---
  const hydratePromise = hydrateAll()
    .then(real => {
      if (!real) return;
      const state = store.getState();
      const profilesById = new Map(real.profiles.map(u => [u.id, u]));
      const legacyUsers = state.users.filter(u => !profilesById.has(u.id) && u.id.startsWith('u'));
      const mergedUsers = [...real.profiles, ...legacyUsers];

      console.info('[hydrate]', {
        parties: real.parties.length,
        posts: real.posts.length,
        follows: real.follows.length,
        profiles: real.profiles.length,
      });
      store.setState({
        parties: real.parties,
        posts: real.posts,
        follows: real.follows,
        users: mergedUsers,
        hydrated: true,
      });
      maybeRefreshRoute();
    })
    .catch(e => {
      console.warn('[hydrate] failed', e);
      // Still flip hydrated so the skeleton doesn't spin forever.
      if (!store.getState().hydrated) {
        store.setState({ hydrated: true });
        maybeRefreshRoute();
      }
    });

  // --- cloud state blob (low-priority, secondary) ---
  const cloudPromise = loadCloudState()
    .then(cloud => {
      if (!cloud) return;
      store.hydrateFromCloud(stripCloudExclusions(cloud));
      maybeRefreshRoute();
    })
    .catch(e => { console.warn('[hydrate] cloud-state load failed', e); });

  // Release the in-flight lock only when every branch is done, so the
  // next pull-to-refresh re-fires everything cleanly.
  Promise.allSettled([profilePromise, hydratePromise, cloudPromise]).finally(() => {
    _inFlight = false;
  });
}
