-- =====================================================================
-- FEEDBACK — Read policies: admin sees all, everyone else loses
-- soft-deleted rows (FASE 0)
-- =====================================================================
-- Every moderatable table's read policy becomes:
--
--     is_admin(auth.uid())            -- the admin sees EVERYTHING,
--                                        including the trash, to moderate
--                                        and restore
--   OR ( <the EXACT existing predicate>   -- preserved verbatim so the
--        AND deleted_at is null )           7-day archive (0021), the
--                                           report-hide (0014) and the
--                                           Q&A privacy (0017) all keep
--                                           working unchanged
--
-- party_visible() is also tightened to treat a SOFT-DELETED party as
-- invisible, so deleting a party automatically pulls its posts, comments,
-- chat, attendees and DJs out of every non-admin view through the same
-- single rule they already inherit — no per-child party-deleted check.
-- The admin override sits ABOVE party_visible() in each child policy, so
-- admins still see the children of a deleted party.
-- =====================================================================

-- ---------------------------------------------------------------------
-- party_visible(): add `and pa.deleted_at is null`. SECURITY DEFINER, so
-- it still bypasses RLS reading parties. NULL party_id (global chat room)
-- stays TRUE. The 7-day window is unchanged.
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
        and pa.deleted_at is null
    );
$$;

-- ---------------------------------------------------------------------
-- parties — inline date window (kept off party_visible to avoid the
-- definer function querying its own table per row).
-- ---------------------------------------------------------------------
drop policy if exists parties_read on public.parties;
create policy parties_read on public.parties
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or (
      party_date >= current_date - interval '7 days'
      and deleted_at is null
    )
  );

-- ---------------------------------------------------------------------
-- posts — keep the report-hide carve-out (0014/0018) AND the parent
-- party visibility (0021), now plus own soft-delete.
-- ---------------------------------------------------------------------
drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or (
      (hidden_at is null or user_id = auth.uid())
      and public.party_visible(party_id)
      and deleted_at is null
    )
  );

-- ---------------------------------------------------------------------
-- post_likes — inherit from the post (no own soft-delete). Also require
-- the parent post not soft-deleted.
-- ---------------------------------------------------------------------
drop policy if exists likes_read on public.post_likes;
create policy likes_read on public.post_likes
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or exists (
      select 1 from public.posts p
      where p.id = post_id
        and public.party_visible(p.party_id)
        and p.deleted_at is null
    )
  );

-- ---------------------------------------------------------------------
-- post_comments — own soft-delete AND parent post visibility.
-- ---------------------------------------------------------------------
drop policy if exists comments_read on public.post_comments;
create policy comments_read on public.post_comments
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or (
      deleted_at is null
      and exists (
        select 1 from public.posts p
        where p.id = post_id
          and public.party_visible(p.party_id)
          and p.deleted_at is null
      )
    )
  );

-- ---------------------------------------------------------------------
-- party_attendees / party_djs — directly party-scoped; party_visible()
-- now also excludes deleted parties. No own soft-delete column.
-- ---------------------------------------------------------------------
drop policy if exists attendees_read on public.party_attendees;
create policy attendees_read on public.party_attendees
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or public.party_visible(party_id)
  );

drop policy if exists party_djs_read on public.party_djs;
create policy party_djs_read on public.party_djs
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or public.party_visible(party_id)
  );

-- ---------------------------------------------------------------------
-- chat_messages — inherit room's party visibility, plus own soft-delete.
-- The global public room (party_id NULL → party_visible TRUE) is never
-- archived; admin-deleting an individual global message still works via
-- its own deleted_at.
-- ---------------------------------------------------------------------
drop policy if exists messages_read_public on public.chat_messages;
create policy messages_read_public on public.chat_messages
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or (
      deleted_at is null
      and exists (
        select 1 from public.chat_rooms r
        where r.id = room_id
          and r.type = 'public'
          and public.party_visible(r.party_id)
      )
    )
  );

drop policy if exists messages_read_back on public.chat_messages;
create policy messages_read_back on public.chat_messages
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or (
      deleted_at is null
      and exists (
        select 1 from public.chat_rooms r
        where r.id = room_id
          and r.type = 'back_private'
          and public.party_visible(r.party_id)
      )
    )
  );

-- ---------------------------------------------------------------------
-- questions — own soft-delete on top of the Q&A privacy rule (0017).
-- ---------------------------------------------------------------------
drop policy if exists questions_read on public.questions;
create policy questions_read on public.questions
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or (
      deleted_at is null
      and (
        target_id = auth.uid()
        or asker_id = auth.uid()
        or answer is not null
      )
    )
  );

notify pgrst, 'reload schema';
