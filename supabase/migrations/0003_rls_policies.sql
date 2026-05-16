-- =====================================================================
-- FEEDBACK — Row Level Security policies (Phase 1)
-- Rule of thumb: write paths are tight (auth.uid() ownership + tier
-- gates), read paths are open to all authenticated users. Anonymous
-- access is denied across the board.
-- =====================================================================

alter table public.profiles                enable row level security;
alter table public.parties                 enable row level security;
alter table public.party_djs               enable row level security;
alter table public.party_attendees         enable row level security;
alter table public.posts                   enable row level security;
alter table public.post_likes              enable row level security;
alter table public.post_comments           enable row level security;
alter table public.questions               enable row level security;
alter table public.follows                 enable row level security;
alter table public.live_ratings            enable row level security;
alter table public.memberships             enable row level security;
alter table public.membership_transactions enable row level security;
alter table public.chat_rooms              enable row level security;
alter table public.chat_messages           enable row level security;
alter table public.chat_mutes              enable row level security;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    -- prevent clients from self-promoting; tier flips happen via
    -- activate_membership() (service_role).
    and membership_tier = (select membership_tier from public.profiles where id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- parties
-- ---------------------------------------------------------------------
drop policy if exists parties_read on public.parties;
create policy parties_read on public.parties
  for select to authenticated using (true);

drop policy if exists parties_create on public.parties;
create policy parties_create on public.parties
  for insert to authenticated
  with check (
    (select role from public.profiles where id = auth.uid()) = 'promotor'
    and promoter_id = auth.uid()
  );

drop policy if exists parties_update_owner on public.parties;
create policy parties_update_owner on public.parties
  for update to authenticated
  using (promoter_id = auth.uid())
  with check (promoter_id = auth.uid());

drop policy if exists parties_delete_owner on public.parties;
create policy parties_delete_owner on public.parties
  for delete to authenticated
  using (promoter_id = auth.uid());

-- party_djs
drop policy if exists party_djs_read on public.party_djs;
create policy party_djs_read on public.party_djs
  for select to authenticated using (true);

drop policy if exists party_djs_manage on public.party_djs;
create policy party_djs_manage on public.party_djs
  for all to authenticated
  using (
    exists (select 1 from public.parties p where p.id = party_id and p.promoter_id = auth.uid())
  )
  with check (
    exists (select 1 from public.parties p where p.id = party_id and p.promoter_id = auth.uid())
  );

-- party_attendees
drop policy if exists attendees_read on public.party_attendees;
create policy attendees_read on public.party_attendees
  for select to authenticated using (true);

drop policy if exists attendees_attend on public.party_attendees;
create policy attendees_attend on public.party_attendees
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists attendees_leave on public.party_attendees;
create policy attendees_leave on public.party_attendees
  for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- posts (daily limit enforced for general tier)
-- ---------------------------------------------------------------------
drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts
  for select to authenticated
  using (expires_at > now());

drop policy if exists posts_create on public.posts;
create policy posts_create on public.posts
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      public.current_tier(auth.uid()) <> 'general'
      or public.posts_today(auth.uid()) < 5
    )
  );

drop policy if exists posts_update_owner on public.posts;
create policy posts_update_owner on public.posts
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists posts_delete_owner on public.posts;
create policy posts_delete_owner on public.posts
  for delete to authenticated
  using (user_id = auth.uid());

-- post_likes
drop policy if exists likes_read on public.post_likes;
create policy likes_read on public.post_likes
  for select to authenticated using (true);

drop policy if exists likes_like on public.post_likes;
create policy likes_like on public.post_likes
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists likes_unlike on public.post_likes;
create policy likes_unlike on public.post_likes
  for delete to authenticated
  using (user_id = auth.uid());

-- post_comments
drop policy if exists comments_read on public.post_comments;
create policy comments_read on public.post_comments
  for select to authenticated using (true);

drop policy if exists comments_create on public.post_comments;
create policy comments_create on public.post_comments
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists comments_delete_owner on public.post_comments;
create policy comments_delete_owner on public.post_comments
  for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- questions
-- ---------------------------------------------------------------------
drop policy if exists questions_read on public.questions;
create policy questions_read on public.questions
  for select to authenticated using (true);

drop policy if exists questions_ask on public.questions;
create policy questions_ask on public.questions
  for insert to authenticated
  with check (asker_id is null or asker_id = auth.uid());

drop policy if exists questions_answer on public.questions;
create policy questions_answer on public.questions
  for update to authenticated
  using (target_user_id = auth.uid())
  with check (target_user_id = auth.uid());

-- ---------------------------------------------------------------------
-- follows
-- ---------------------------------------------------------------------
drop policy if exists follows_read on public.follows;
create policy follows_read on public.follows
  for select to authenticated using (true);

drop policy if exists follows_follow on public.follows;
create policy follows_follow on public.follows
  for insert to authenticated
  with check (follower_id = auth.uid());

drop policy if exists follows_unfollow on public.follows;
create policy follows_unfollow on public.follows
  for delete to authenticated
  using (follower_id = auth.uid());

-- ---------------------------------------------------------------------
-- live_ratings — anyone can read; only owner upserts; weight forced by
-- the BEFORE trigger so a malicious client can't claim x3 on general.
-- ---------------------------------------------------------------------
drop policy if exists ratings_read on public.live_ratings;
create policy ratings_read on public.live_ratings
  for select to authenticated using (true);

drop policy if exists ratings_upsert on public.live_ratings;
create policy ratings_upsert on public.live_ratings
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists ratings_update_own on public.live_ratings;
create policy ratings_update_own on public.live_ratings
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- memberships — read your own only; writes only via service_role.
-- ---------------------------------------------------------------------
drop policy if exists memberships_read_self on public.memberships;
create policy memberships_read_self on public.memberships
  for select to authenticated
  using (user_id = auth.uid());

-- (no insert/update/delete policies → only service_role bypasses RLS)

-- ---------------------------------------------------------------------
-- membership_transactions — read your own only; writes via service_role.
-- ---------------------------------------------------------------------
drop policy if exists transactions_read_self on public.membership_transactions;
create policy transactions_read_self on public.membership_transactions
  for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- chat_rooms — read all (party context). Rooms are created by trigger.
-- ---------------------------------------------------------------------
drop policy if exists rooms_read on public.chat_rooms;
create policy rooms_read on public.chat_rooms
  for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- chat_messages
--   * public room: everyone reads; VIP+ or host writes; muted users blocked.
--   * back_private room: read+write only for Back tier or the party hosts.
--   * hosts can UPDATE to hide/feature messages (moderation).
-- ---------------------------------------------------------------------
drop policy if exists messages_read_public on public.chat_messages;
create policy messages_read_public on public.chat_messages
  for select to authenticated
  using (
    exists (select 1 from public.chat_rooms r where r.id = room_id and r.type = 'public')
  );

drop policy if exists messages_read_back on public.chat_messages;
create policy messages_read_back on public.chat_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.chat_rooms r
      where r.id = room_id
        and r.type = 'back_private'
        and (
          public.current_tier(auth.uid()) = 'back'
          or public.is_party_host(auth.uid(), r.party_id)
        )
    )
  );

drop policy if exists messages_write_public on public.chat_messages;
create policy messages_write_public on public.chat_messages
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.chat_rooms r where r.id = room_id and r.type = 'public')
    and (
      public.current_tier(auth.uid()) in ('vip','back')
      or public.is_party_host(
           auth.uid(),
           (select party_id from public.chat_rooms where id = room_id)
         )
    )
    and not exists (
      select 1 from public.chat_mutes m
      where m.room_id = chat_messages.room_id
        and m.user_id = auth.uid()
        and m.muted_until > now()
    )
  );

drop policy if exists messages_write_back on public.chat_messages;
create policy messages_write_back on public.chat_messages
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.chat_rooms r
      where r.id = room_id
        and r.type = 'back_private'
        and (
          public.current_tier(auth.uid()) = 'back'
          or public.is_party_host(auth.uid(), r.party_id)
        )
    )
  );

drop policy if exists messages_moderate on public.chat_messages;
create policy messages_moderate on public.chat_messages
  for update to authenticated
  using (
    exists (
      select 1 from public.chat_rooms r
      where r.id = room_id
        and public.is_party_host(auth.uid(), r.party_id)
    )
  )
  with check (true);

-- ---------------------------------------------------------------------
-- chat_mutes — readable by the target, managed by hosts of the room.
-- ---------------------------------------------------------------------
drop policy if exists mutes_read_self on public.chat_mutes;
create policy mutes_read_self on public.chat_mutes
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists mutes_manage_host on public.chat_mutes;
create policy mutes_manage_host on public.chat_mutes
  for all to authenticated
  using (
    exists (
      select 1 from public.chat_rooms r
      where r.id = room_id
        and public.is_party_host(auth.uid(), r.party_id)
    )
  )
  with check (
    exists (
      select 1 from public.chat_rooms r
      where r.id = room_id
        and public.is_party_host(auth.uid(), r.party_id)
    )
  );
