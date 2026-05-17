// =====================================================================
// FEEDBACK — Background hydration orchestrator
// =====================================================================
// Single source of truth for "go re-fetch everything from Supabase and
// reconcile it into the store". Lives in its own module so the entry
// point (main.js) AND individual pages (wall.js's empty-state fallback,
// pull-to-refresh) can call the SAME idempotent function without
// importing main.js (which would create a circular dependency).
//
// What it does:
//   1. In parallel: re-fetch the user's profile, all normalized
//      entities (parties / posts / follows / attendees / profiles), and
//      the legacy cloud blob.
//   2. Merge profiles + legacy mock users into state.users.
//   3. setState the migrated entities authoritatively (no cache merge).
//   4. Apply the cloud blob with migrated keys stripped.
//   5. Subscribe to realtime (idempotent).
//   6. Flip state.hydrated to true so skeleton loaders swap to real data.
//   7. Re-render the current page if it's in DATA_DRIVEN_ROUTES.
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

export function refreshFromSupabaseInBackground() {
  if (_inFlight) return;
  _inFlight = true;

  Promise.allSettled([
    syncProfileIntoStore(),
    hydrateAll(),
    loadCloudState(),
  ]).then(([profileR, realR, cloudR]) => {
    const real  = realR.status  === 'fulfilled' ? realR.value  : null;
    const cloud = cloudR.status === 'fulfilled' ? cloudR.value : null;

    if (real) {
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
      });
    } else if (realR.status === 'rejected') {
      console.warn('[hydrate] failed', realR.reason);
    }

    if (cloud) {
      store.hydrateFromCloud(stripCloudExclusions(cloud));
    }

    if (profileR.status === 'rejected') {
      console.warn('[hydrate] profile sync failed', profileR.reason);
    }

    try { subscribeRealtime(store); } catch (e) { console.warn('[hydrate] realtime failed', e); }

    // First hydration done — flips off any skeleton loaders. We do this
    // even when individual queries failed so the user doesn't stare at
    // a spinner forever; the empty state is at least honest.
    if (!store.getState().hydrated) {
      store.setState({ hydrated: true });
    }

    if (DATA_DRIVEN_ROUTES.has(router.getCurrentRoute())) {
      router.refreshCurrentRoute();
    }
  }).finally(() => {
    _inFlight = false;
  });
}
