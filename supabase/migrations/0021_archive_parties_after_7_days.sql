-- =====================================================================
-- FEEDBACK — Auto-archive parties 7 days after their date
-- =====================================================================
-- WHAT THE USER ASKED FOR
--   "Quiero que todo se archive a los 7 días pero que no quede visible
--    para nadie, solo accesible desde la base de datos."
--   + "endurécelos [chat/ratings/asistentes]."
--   + (revised) "que no quede nada después de 7 días visible para
--      absolutamente nadie" — the earlier creator carve-out was DROPPED.
--   → 7 days after a party's date, the party AND everything hanging off
--     it disappears from the APP for EVERYONE — including its own
--     creator, no exceptions. The rows always stay in the database
--     (service_role / SQL editor bypass RLS), so the team can
--     export/inspect archived data anytime.
--
-- WHY RLS-ONLY (no archived_at column, no cron job)
--   The cutoff is computed at READ TIME inside the policies, so there's
--   no scheduled job to fail or drift, no backfill, and it's fully
--   reversible (flip the predicate back to `true`). A party becomes
--   invisible the instant its party_date crosses the 7-day line.
--
-- THE VISIBILITY RULE (single source of truth = party_visible())
--   A party P is visible  ⟺  P.party_date >= current_date - interval '7 days'
--   No creator exception. Everything that hangs off a party (posts,
--   comments, likes, chat, attendees, djs) inherits that exact rule via
--   party_visible(), so the whole unit appears/disappears together and
--   the rule can never drift between tables.
--
-- THE 7-DAY BOUNDARY
--   Visible through the entire 7th day after the event; drops off on day
--   8. To change it, edit the interval in party_visible() AND in the
--   parties_read predicate below (kept inline there to avoid the function
--   recursing on its own table).
-- =====================================================================

-- Defensive (same guard as 0018): posts_read references hidden_at, added
-- by 0014/0018. Add it idempotently so this migration runs regardless of
-- order; a no-op once those ran.
alter table public.posts
  add column if not exists hidden_at     timestamptz,
  add column if not exists hidden_reason text;

-- Backs the date-window predicate evaluated on every parties read.
create index if not exists parties_date_idx on public.parties(party_date);

-- ---------------------------------------------------------------------
-- party_visible(party_id): the ONE place the archive rule lives. Every
-- dependent table's read policy calls this so they stay in lock-step.
--
--   * SECURITY DEFINER: runs as the function owner so the inner read of
--     public.parties bypasses RLS — no recursion with parties_read, and
--     the rule is self-contained (doesn't lean on another policy being
--     correct).
--   * NULL party_id → TRUE: the global chat room (chat_rooms.party_id IS
--     NULL since 0009) is not party-scoped, so it must never be archived.
--   * STABLE: depends only on current_date, constant within a statement —
--     lets the planner cache it per row-batch.
--
-- HARD CUTOFF, NO EXCEPTIONS: 7 days after a party's date it disappears
-- from the app for EVERYONE — including its own creator. (The earlier
-- `or promoter_id = auth.uid()` creator carve-out was removed by owner
-- decision: nothing must stay visible to anyone after the window.) The
-- rows still live in the DB; service_role / the SQL editor bypass RLS.
-- ---------------------------------------------------------------------
create or replace function public.party_visible(p_party_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_party_id is null
    or exists (
      select 1
      from public.parties pa
      where pa.id = p_party_id
        and pa.party_date >= current_date - interval '7 days'
    );
$$;

grant execute on function public.party_visible(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- parties: ONLY inside the 7-day window — no creator exception. (Inline,
-- not via party_visible(), so the policy doesn't query its own table
-- through a definer function for every row.) Was `using (true)` since
-- 0003.
-- ---------------------------------------------------------------------
drop policy if exists parties_read on public.parties;
create policy parties_read on public.parties
  for select to authenticated
  using (party_date >= current_date - interval '7 days');

-- ---------------------------------------------------------------------
-- posts: keep the moderation carve-out from 0018 (hidden posts stay
-- hidden except to their author) AND require the parent party visible.
-- posts.party_id is NOT NULL (0001), so party_visible never sees a NULL
-- here. Once a party is archived, even the author stops seeing the post
-- on the wall (intended; the creator sees it again via the party page).
-- ---------------------------------------------------------------------
drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts
  for select to authenticated
  using (
    (hidden_at is null or user_id = auth.uid())
    and public.party_visible(party_id)
  );

-- ---------------------------------------------------------------------
-- post_likes / post_comments: inherit visibility from their post's party.
-- Was `using (true)` since 0003.
-- ---------------------------------------------------------------------
drop policy if exists likes_read on public.post_likes;
create policy likes_read on public.post_likes
  for select to authenticated
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_id and public.party_visible(p.party_id)
    )
  );

drop policy if exists comments_read on public.post_comments;
create policy comments_read on public.post_comments
  for select to authenticated
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_id and public.party_visible(p.party_id)
    )
  );

-- ---------------------------------------------------------------------
-- party_attendees / party_djs: directly party-scoped. Both were
-- `using (true)` since 0003.
--
-- NOTE: live_ratings is intentionally NOT hardened here. Migration 0027
-- (drop_live_ratings) removes that table for good. An earlier draft of
-- this file redefined a ratings_read policy on public.live_ratings —
-- removed because, applied to a DB that already ran 0027, the CREATE
-- POLICY errors with "relation public.live_ratings does not exist" and
-- aborts the whole migration. There is nothing left to secure there.
-- ---------------------------------------------------------------------
drop policy if exists attendees_read on public.party_attendees;
create policy attendees_read on public.party_attendees
  for select to authenticated
  using (public.party_visible(party_id));

drop policy if exists party_djs_read on public.party_djs;
create policy party_djs_read on public.party_djs
  for select to authenticated
  using (public.party_visible(party_id));

-- ---------------------------------------------------------------------
-- chat_messages: a message inherits its room's party visibility. The
-- global public room has party_id NULL → party_visible(NULL)=TRUE, so the
-- global chat is never archived. Party-scoped rooms follow the window /
-- creator rule.
--   * messages_read_public — latest def from 0003.
--   * messages_read_back    — latest def from 0009.
-- ---------------------------------------------------------------------
drop policy if exists messages_read_public on public.chat_messages;
create policy messages_read_public on public.chat_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.chat_rooms r
      where r.id = room_id
        and r.type = 'public'
        and public.party_visible(r.party_id)
    )
  );

drop policy if exists messages_read_back on public.chat_messages;
create policy messages_read_back on public.chat_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.chat_rooms r
      where r.id = room_id
        and r.type = 'back_private'
        and public.party_visible(r.party_id)
    )
  );

-- ---------------------------------------------------------------------
-- Flush PostgREST's policy/function cache so the new predicates and
-- party_visible() take effect on the next request (not after the TTL).
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
