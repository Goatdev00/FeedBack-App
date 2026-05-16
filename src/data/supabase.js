// =====================================================================
// FEEDBACK — Supabase client
// One client instance for the whole SPA. Anonymous key + RLS protects
// reads/writes per row; service-role calls live in Edge Functions, never
// in the browser.
// =====================================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Loud, early failure. The legacy localStorage demo still works because
  // pages don't import from this module until Phase 2 migrates them.
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing. ' +
    'See SETUP.md to provision a project.'
  );
}

// Explicit storage adapter: in environments where window.localStorage is
// unavailable (SSR, sandboxed iframes), `persistSession` would silently
// fall back to memory and the user would appear logged-out on next load.
// By being explicit + guarded, we fail loudly instead of mysteriously.
const safeLocalStorage = (() => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return undefined;
    const probeKey = '__supabase_probe__';
    window.localStorage.setItem(probeKey, '1');
    window.localStorage.removeItem(probeKey);
    return window.localStorage;
  } catch {
    console.warn('[supabase] localStorage unavailable — sessions will not persist.');
    return undefined;
  }
})();

export const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,    // OAuth hash → session
        flowType: 'implicit',        // default for SPA OAuth via fragment
        storage: safeLocalStorage,
        // Letting supabase-js pick the storageKey (sb-<ref>-auth-token)
        // avoids the "I bumped the key and logged everyone out" footgun.
      },
      realtime: {
        params: { eventsPerSecond: 10 },
      },
      global: {
        headers: { 'x-client': 'feedback-web' },
      },
    })
  : null;

export function isSupabaseConfigured() {
  return supabase !== null;
}
