-- =====================================================================
-- FEEDBACK — Posts no longer expire from the wall
-- =====================================================================
-- Up to here `posts.expires_at` (default `now() + 7 days`) was filtered
-- by the `posts_read` RLS policy, so once a post passed the 7-day mark
-- it became invisible to EVERYONE, including the author. New accounts
-- joining a quiet week saw a completely empty wall.
--
-- Product decision: the wall should always show every post to every
-- user. We drop the expires_at filter from `posts_read` (keeping the
-- hidden_at carve-out from migration 0014), backfill existing rows so
-- they aren't already "expired", and change the column default so new
-- posts don't auto-expire either. The column stays for backwards
-- compatibility — nothing else queries it, and dropping it would break
-- listPosts()'s SELECT list.
-- =====================================================================

-- 0) Defensive: if migration 0014 (post_reports) was skipped, the
--    hidden_at / hidden_reason columns this policy depends on don't
--    exist yet, and the CREATE POLICY below would fail with
--    "column hidden_at does not exist". Idempotently add them here so
--    0018 can run regardless of whether 0014 was applied. When 0014
--    later runs (or already ran) the IF NOT EXISTS guards make it a
--    no-op for these specific columns; the rest of 0014 (post_reports
--    table, report_post RPC, etc.) still applies normally.
alter table public.posts
  add column if not exists hidden_at     timestamptz,
  add column if not exists hidden_reason text;
create index if not exists posts_hidden_idx on public.posts(hidden_at);

-- 1) Replace posts_read: only the hidden_at carve-out matters now.
drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts
  for select to authenticated
  using (hidden_at is null or user_id = auth.uid());

-- 2) Backfill existing rows so their stale 7-day expiry doesn't keep
--    them invisible in the client cache (cleanExpiredPosts used to drop
--    them locally; we removed that, but the cached expires_at value
--    would still race the new RLS if we left it). 9999-12-31 is the
--    canonical "far future" Postgres + JS Date both round-trip cleanly.
update public.posts
   set expires_at = '9999-12-31'::timestamptz
 where expires_at < '9999-12-31'::timestamptz;

-- 3) New posts inherit the same far-future default — keeps the column
--    NOT NULL without forcing every insert path to set it explicitly.
alter table public.posts
  alter column expires_at set default '9999-12-31'::timestamptz;
