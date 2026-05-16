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

export const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,    // needed for OAuth redirect handling
        storageKey: 'feedback.auth.v1',
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
