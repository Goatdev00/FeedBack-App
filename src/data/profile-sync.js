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

  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) return null;

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
  const { data: { user } } = await supabase.auth.getUser();
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
