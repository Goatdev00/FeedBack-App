-- =====================================================================
-- FEEDBACK — Remove party_attendees from the realtime publication
-- =====================================================================
-- AUDIT FINDING (jun-2026, crítico C19/privacidad): party_attendees was
-- in supabase_realtime (0004) and the client subscribed to its INSERT/
-- DELETE events with NO filter. Every connected client therefore
-- received, the instant it happened, "<user> confirmed attendance at
-- <party>" — and parties carries the real venue, date and time. In a
-- nightlife app that is a live stalking feed: an attacker just leaves a
-- tab open and learns where their target will physically be tonight.
--
-- WHAT CHANGES:
--   * No more CDC broadcast of attendance. Attendance still hydrates on
--     boot via listAttendees(); the user's own toggles update local
--     state optimistically. Others' attendance now appears on the next
--     hydration instead of live — an acceptable trade until a per-party,
--     relationship-scoped channel exists.
--   * The matching client listeners were removed from api.js in the same
--     commit (they would simply never fire after this).
--
-- NOTE: the attendees_read RLS policy (using party_visible()) is still
-- world-readable within the 7-day window — restricting it by
-- relationship is Fase 1 work (needs product decisions about counters
-- and the attendee avatar strip). This migration removes the LIVE feed,
-- which is the cheap, zero-UX-cost part.
--
-- Idempotent: only drops if currently present in the publication.
-- =====================================================================

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'party_attendees'
  ) then
    alter publication supabase_realtime drop table public.party_attendees;
  end if;
end $$;
