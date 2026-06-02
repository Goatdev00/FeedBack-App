// =====================================================================
// FEEDBACK — Background hydration orchestrator
// =====================================================================
// Single source of truth for "go re-fetch everything from Supabase and
// reconcile it into the store". Lives in its own module so the entry
// point (main.js) AND individual pages (wall.js's empty-state fallback,
// pull-to-refresh) can call the SAME idempotent function without
// importing main.js (which would create a circular dependency).
//
// PERFORMANCE NOTE (the reason this file looks the way it does):
//   The wall was taking ~20s to show content because the old code did
//   `await Promise.all([parties, posts, follows, attendees, profiles])`
//   inside hydrateAll() and only THEN setState'd. Posts — the main wall
//   content — were gated on the SLOWEST of the five queries (usually
//   listProfiles(), which pulls every profile row, or listAttendees()).
//
//   Now each query is fired independently and writes its own slice into
//   the store + refreshes the route THE MOMENT it lands:
//     * posts   → paint immediately (each post carries its author inline,
//                 so we do NOT need profiles to render the feed). This is
//                 what flips state.hydrated.
//     * parties → paint as soon as parties+attendees resolve.
//     * follows → independent.
//     * profiles→ DEFERRED: only needed for users[] lookups (comment
//                 authors, other-profile pages), never to paint the wall.
//     * cloud   → low-priority preferences blob.
//   Wall-critical data no longer waits behind table-scan queries.
//
// Re-entrancy guard: simultaneous callers (boot + pull-to-refresh +
// wall's auto-trigger) are coalesced into one in-flight refresh.
// =====================================================================

import { store } from './mock-data.js';
import {
  listParties,
  listPosts,
  listFollows,
  listAttendees,
  listProfiles,
  listQuestions,
  subscribeRealtime,
} from './api.js';
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
let _refreshScheduled = false;

// Coalesce refresh calls: each hydration phase (posts, parties, profile,
// profiles, cloud) lands in its own microtask and used to call
// router.refreshCurrentRoute() directly. That re-rendered the whole
// #app innerHTML 4–5 times in quick succession, wiping and re-painting
// the bottom nav each pass — visible as a "jumping" menu on first boot,
// especially on iOS where the lava filter also competes for the main
// thread. Coalescing into a single rAF tick paints once per frame.
function maybeRefreshRoute() {
  if (!DATA_DRIVEN_ROUTES.has(router.getCurrentRoute())) return;
  if (_refreshScheduled) return;
  _refreshScheduled = true;
  requestAnimationFrame(() => {
    _refreshScheduled = false;
    if (DATA_DRIVEN_ROUTES.has(router.getCurrentRoute())) {
      router.refreshCurrentRoute();
    }
  });
}

function flipHydrated() {
  if (!store.getState().hydrated) store.setState({ hydrated: true });
}

export function refreshFromSupabaseInBackground(knownSession) {
  if (_inFlight) return;
  _inFlight = true;

  const t0 = performance.now();
  const mark = (label) => console.info(`[hydrate] ${label} +${Math.round(performance.now() - t0)}ms`);

  // Realtime is fire-and-forget. Open the WS up front so server-pushed
  // changes stream in while the initial fetch is still running.
  try { subscribeRealtime(store); } catch (e) { console.warn('[hydrate] realtime failed', e); }

  // --- profile sync (auth-dependent, independent of the feed) ---
  // Refresh the current route once the profile lands: without this, pPosts
  // can win the race, paint the wall while state.users is still empty,
  // and the user's own posts silently disappear (renderPostCard falls back
  // to post.author, but comments and other users[] lookups also wake up
  // here). Foreign users' posts render fine in the meantime because their
  // authors arrived inline with the posts query.
  const pProfile = syncProfileIntoStore(knownSession)
    .then(() => { maybeRefreshRoute(); mark('profile'); })
    .catch((e) => console.warn('[hydrate] profile sync failed', e));

  // --- POSTS: the main wall content; paint the instant it lands ---
  // Posts carry their author inline (postFromRow → author), so the feed
  // renders fully WITHOUT waiting on listProfiles(). This is what flips
  // state.hydrated and swaps skeletons for real cards.
  const pPosts = listPosts()
    .then((posts) => {
      store.setState({ posts, hydrated: true });
      maybeRefreshRoute();
      mark(`posts (${posts.length})`);
    })
    .catch((e) => {
      console.warn('[hydrate] posts failed', e);
      flipHydrated();
      maybeRefreshRoute();
    });

  // --- PARTIES (+ attendees folded in) ---
  const pParties = Promise.all([listParties(), listAttendees()])
    .then(([parties, attendees]) => {
      const byParty = new Map(parties.map((p) => [p.id, p]));
      for (const a of attendees) {
        const p = byParty.get(a.party_id);
        if (p) p.attendees.push(a.user_id);
      }
      store.setState({ parties });
      maybeRefreshRoute();
      mark(`parties (${parties.length})`);
    })
    .catch((e) => console.warn('[hydrate] parties failed', e));

  // --- FOLLOWS (social graph) ---
  const pFollows = listFollows()
    .then((follows) => {
      store.setState({ follows });
      mark(`follows (${follows.length})`);
    })
    .catch((e) => console.warn('[hydrate] follows failed', e));

  // --- QUESTIONS (anonymous Q&A) ---
  // RLS returns: questions targeted at the current user (any state),
  // questions the current user asked (any state), and any answered
  // question (public Q&A on profile pages). The notifications feed
  // and the profile Questions tab both consume state.questions.
  const pQuestions = listQuestions()
    .then((questions) => {
      store.setState({ questions });
      maybeRefreshRoute();
      mark(`questions (${questions.length})`);
    })
    .catch((e) => console.warn('[hydrate] questions failed', e));

  // --- PROFILES (users[] for lookups) — DEFERRED, not wall-critical ---
  const pProfiles = listProfiles()
    .then((profiles) => {
      const state = store.getState();
      const profilesById = new Map(profiles.map((u) => [u.id, u]));
      // Keep any legacy mock users + the live currentUser that aren't in
      // the fetched profile set.
      const extras = state.users.filter((u) => !profilesById.has(u.id));
      store.setState({ users: [...profiles, ...extras] });
      maybeRefreshRoute();
      mark(`profiles (${profiles.length})`);
    })
    .catch((e) => console.warn('[hydrate] profiles failed', e));

  // --- CLOUD STATE blob (preferences) — lowest priority ---
  const pCloud = loadCloudState(knownSession)
    .then((cloud) => {
      if (cloud) {
        store.hydrateFromCloud(stripCloudExclusions(cloud));
        maybeRefreshRoute();
      }
      mark('cloud');
    })
    .catch((e) => console.warn('[hydrate] cloud-state load failed', e));

  Promise.allSettled([pProfile, pPosts, pParties, pFollows, pProfiles, pQuestions, pCloud]).finally(() => {
    _inFlight = false;
    flipHydrated();
    mark('ALL DONE');
  });
}
