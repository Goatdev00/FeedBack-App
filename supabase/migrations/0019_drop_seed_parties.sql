-- =====================================================================
-- FEEDBACK — Drop the 5 seed parties from migration 0007
-- =====================================================================
-- Migration 0007 seeded five hardcoded parties (NEXUS, PULSE, BASS,
-- ECLIPSE, FREKVENCIA) so the wall had something to attach posts to on
-- day one. They have promoter_id = NULL because they were never tied to
-- a real auth.users row, which means:
--   * Nobody can edit or delete them through the UI (RLS requires
--     promoter_id = auth.uid()).
--   * They show up to every user forever as ghost events.
--
-- Now that real users are creating real parties, we wipe the seeds.
-- The IDs are stable UUIDs from 0007, so this migration is idempotent:
-- re-running it after the rows are gone is a no-op.
--
-- Cascade cleanup (defined in 0001):
--   * posts.party_id      → ON DELETE CASCADE: any post attached to a
--                           seed party (none in production, but possible
--                           from testing) gets removed along with the
--                           party.
--   * party_attendees     → ON DELETE CASCADE.
--   * party_djs           → ON DELETE CASCADE.
--   * chat_rooms.party_id → ON DELETE CASCADE: the per-party chat_room
--                           and all its chat_messages disappear too.
--
-- If we ever need similar ghost-data cleanup again, follow the same
-- pattern: stable UUID list + plain DELETE, let the FK cascades do the
-- recursive cleanup, no need to manually walk dependent tables.
-- =====================================================================

delete from public.parties
where id in (
  'a1111111-1111-4111-8111-111111111111',  -- NEXUS — Underground Session
  'a2222222-2222-4222-8222-222222222222',  -- PULSE — House & Disco
  'a3333333-3333-4333-8333-333333333333',  -- BASS CATHEDRAL
  'a4444444-4444-4444-8444-444444444444',  -- ECLIPSE — Melodic Techno
  'a5555555-5555-4555-8555-555555555555'   -- FREKVENCIA
);
