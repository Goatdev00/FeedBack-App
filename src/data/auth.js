// =====================================================================
// FEEDBACK — Auth helpers (Phase 1)
// Thin wrapper around supabase-js auth. Pages should import from here
// instead of touching supabase.auth directly, so we have one place to
// add analytics, error normalization, etc.
// =====================================================================

import { supabase, isSupabaseConfigured } from './supabase.js';

const OAUTH_REDIRECT_PATH = '/';
const redirectTo = () => new URL(OAUTH_REDIRECT_PATH, window.location.origin).toString();

/**
 * Kick off the Google OAuth flow. Resolves once the redirect is queued
 * — the actual session lands on the next page load, picked up by
 * `getSession()` thanks to `detectSessionInUrl: true`.
 */
export async function signInWithGoogle() {
  if (!isSupabaseConfigured()) throw new Error('Supabase not configured');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectTo(),
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  });
  if (error) throw error;
}

/**
 * Email magic-link fallback. The user receives an email, clicks the link,
 * and lands back on the app with a session.
 */
export async function signInWithMagicLink(email) {
  if (!isSupabaseConfigured()) throw new Error('Supabase not configured');
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo() },
  });
  if (error) throw error;
}

export async function signOut() {
  if (!isSupabaseConfigured()) return;
  await supabase.auth.signOut();
}

export async function getSession() {
  if (!isSupabaseConfigured()) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getUser() {
  if (!isSupabaseConfigured()) return null;
  const { data } = await supabase.auth.getUser();
  return data.user;
}

/**
 * Fetch the row from `public.profiles` for the signed-in user.
 * Returns null if no session or no profile yet (e.g. during the first
 * render after signup, before the handle_new_user trigger settles).
 */
export async function getCurrentProfile() {
  if (!isSupabaseConfigured()) return null;
  const user = await getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  if (error) {
    console.warn('[auth] failed to load profile', error);
    return null;
  }
  return data;
}

/**
 * Subscribe to auth state changes. Returns an unsubscribe function.
 * Use in the app shell to react to login / logout / token refresh.
 */
export function onAuthChange(callback) {
  if (!isSupabaseConfigured()) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return () => data.subscription.unsubscribe();
}
