-- =====================================================================
-- FEEDBACK — Drop the dead live_ratings infrastructure
-- =====================================================================
-- AUDIT FINDING (jun-2026) + PRODUCT DECISION (owner, 2026-06-11):
-- the live-ratings feature is DISCARDED.
--
-- The table public.live_ratings, its weighted-average view
-- party_live_ratings, the snapshot_rating_weight() trigger and its slot
-- in the supabase_realtime publication were built in 0001/0002/0004 and
-- NEVER got a client consumer: grep of live_ratings/party_live_ratings
-- across src/ returns zero results. Meanwhile every table in the
-- realtime publication pays a write-time CDC cost, and 0016/0021 kept
-- spending maintenance effort hardening a feature nobody could use.
--
-- WHAT THIS DROPS:
--   * publication entry (first, so CDC stops cleanly)
--   * view public.party_live_ratings        (0001, security_invoker 0016)
--   * table public.live_ratings             (0001; CASCADE removes its
--     RLS policies from 0003/0021 and the before_rating_upsert trigger)
--   * function public.snapshot_rating_weight() (0002; only caller was
--     the dropped trigger)
--
-- WHAT THIS KEEPS (deliberately):
--   * enum public.rating_factor   — cheap, and a future ratings v2 may
--     reuse it; dropping enums risks unseen dependencies.
--   * function public.tier_weight(membership_tier) — generic tier→weight
--     mapping, one immutable SQL line, may be reused.
--   * the client-side sunday-rating page — it writes to the local store
--     only and never touched this table.
--
-- No data loss: the table was verified empty of any client write path
-- since day one (addQuestion-style API for ratings was never built).
-- =====================================================================

-- 1. Out of the realtime publication (idempotent).
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'live_ratings'
  ) then
    alter publication supabase_realtime drop table public.live_ratings;
  end if;
end $$;

-- 2. View first (depends on the table), then the table itself.
drop view if exists public.party_live_ratings;
drop table if exists public.live_ratings cascade;

-- 3. The trigger function (its only trigger died with the table).
drop function if exists public.snapshot_rating_weight();

notify pgrst, 'reload schema';
