// =====================================================================
// FEEDBACK — Profile sync
// Bridges Supabase `public.profiles` rows with the legacy in-memory
// `store.currentUser` shape used by wall/parties/profile pages.
//
// Phase 2 keeps wall/parties/profile reading from the localStorage store
// so they don't all need to be rewritten at once. This module is the
// single point where the Supabase user materializes as the legacy
// `currentUser` object.
// =====================================================================

import { supabase, isSupabaseConfigured } from './supabase.js';
import { store } from './mock-data.js';
import { router } from '../router.js';

/**
 * Map a Supabase profiles row → the shape the legacy UI expects.
 * Keep this function dumb: pure transformation, no I/O.
 */
export function profileRowToCurrentUser(p) {
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    username: p.username?.startsWith('@') ? p.username : `@${p.username}`,
    role: p.role,
    city: p.city,
    bio: p.bio || '',
    avatar: p.avatar_url || null,
    points: p.points ?? 0,
    followers: 0, // computed elsewhere; legacy fields kept for compat
    following: 0,
    badges: [],
    partiesAttended: [],
    postsToday: 0,
    premium: p.membership_tier !== 'general',
    tier: p.membership_tier || 'general',
    social: p.social || { instagram: '', tiktok: '', twitter: '' },
    theme: p.theme || 'dark',
    onboardingComplete: !!p.onboarding_complete,
  };
}

/**
 * Load the signed-in user's profile and push it into the legacy store
 * so existing pages render against real user data. Also merges the row
 * into `state.users` so look-ups by user id work for the user's own
 * posts/comments/etc.
 *
 * Returns the mapped currentUser (or null if no session / no profile).
 */
export async function syncProfileIntoStore() {
  if (!isSupabaseConfigured()) return null;

  // getSession() reads from localStorage (no network); getUser() round-trips
  // to /auth/v1/user every time. On boot we were paying ~1-3s per call.
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  if (error) {
    console.warn('[profile-sync] failed', error);
    return null;
  }

  const currentUser = profileRowToCurrentUser(profile);
  if (!currentUser) {
    // Edge case: auth.users row exists but public.profiles row doesn't
    // (e.g., the handle_new_user trigger silently failed). Returning
    // null lets routeAfterSession fall through to /wall with whatever
    // session-derived state we have, instead of crashing here.
    console.warn('[profile-sync] no profile row for this auth user');
    return null;
  }
  const state = store.getState();
  const existingUsers = state.users.filter(u => u.id !== currentUser.id && u.id !== 'u_self');
  store.setState({
    isLoggedIn: true,
    onboardingComplete: currentUser.onboardingComplete,
    currentUser,
    users: [currentUser, ...existingUsers],
  });
  store.applyTheme(currentUser.theme);
  return currentUser;
}

/**
 * Update both Supabase and the legacy store after the user edits their
 * profile (onboarding, edit-profile modal). Patches must use DB column
 * names (snake_case), not the legacy camelCase.
 */
export async function patchProfile(patch) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error('not_authenticated');

  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', user.id)
    .select('*')
    .single();
  if (error) throw error;

  const currentUser = profileRowToCurrentUser(data);
  const state = store.getState();
  const existingUsers = state.users.filter(u => u.id !== currentUser.id);
  store.setState({
    currentUser,
    onboardingComplete: currentUser.onboardingComplete,
    users: [currentUser, ...existingUsers],
  });
  return currentUser;
}

/**
 * Pages that depend on `state.currentUser` (profile, chats, notifications)
 * call this at the top of their render. Three outcomes:
 *
 *   1. currentUser is already populated → returns true, page renders normally.
 *   2. currentUser is null but a Supabase session exists → paints a
 *      "Cargando perfil..." scaffold, fires syncProfileIntoStore in the
 *      background, and on success refreshes the current route so the page
 *      re-renders WITH the populated user. Returns false (caller bails).
 *   3. No session at all → schedules a navigate('login') on the next tick
 *      (outside the current navigate frame so the re-entrancy guard in
 *      the router doesn't swallow it). Returns false.
 *
 * Before this helper existed, pages did:
 *   if (!user) { router.navigate('login'); return; }
 * which silently dropped (the outer navigate was still in progress, so the
 * inner navigate('login') hit the re-entrancy guard) — the page render
 * aborted without touching the container, leaving whatever was on screen
 * before (usually the wall) and making the nav button feel broken.
 */
export function requireCurrentUser(container) {
  if (store.getState().currentUser) return true;

  if (container) {
    container.innerHTML = `
      <div class="page">
        <div class="empty-state" style="margin:auto;">
          <div class="empty-state-icon">⏳</div>
          <p class="empty-state-text">Cargando perfil...</p>
        </div>
      </div>
    `;
  }

  syncProfileIntoStore()
    .then(profile => {
      if (profile && store.getState().currentUser) {
        router.refreshCurrentRoute();
      } else {
        // Session is gone or profile row missing — bounce out cleanly.
        // setTimeout breaks us out of the current navigate frame so the
        // router's re-entrancy guard doesn't drop this call.
        console.warn('[require-user] sync returned no profile, redirecting to login');
        setTimeout(() => router.navigate('login'), 0);
      }
    })
    .catch(e => {
      console.warn('[require-user] sync threw', e);
      setTimeout(() => router.navigate('login'), 0);
    });

  return false;
}

/**
 * Clear the local session-derived state without touching Supabase.
 * Call AFTER `supabase.auth.signOut()` so the UI flips back to login.
 */
export function clearLocalSession() {
  store.setState({
    isLoggedIn: false,
    onboardingComplete: false,
    currentUser: null,
    viewingUserId: null,
    viewingPartyId: null,
  });
}
