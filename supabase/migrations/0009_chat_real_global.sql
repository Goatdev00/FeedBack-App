-- =====================================================================
-- FEEDBACK — Real global chat room (Phase 3.6)
-- =====================================================================
-- Problems being fixed:
--
-- 1) The Phase 3.5 design hosted the global chat on a synthetic
--    "party row" with id ffff...ffff. That worked but it required
--    filtering that row out everywhere parties are listed — a hack
--    we're paying for in every party query.
--
-- 2) The chat write policy from migration 0003 gates inserts behind
--    `current_tier(uid) in ('vip','back')`. That's the long-term
--    monetization design, but until Bold/memberships are live in
--    Phase 4 EVERY user is tier 'general' → nobody can chat → the
--    feature is broken in production for general-tier users.
--
-- Fix:
--   * chat_rooms.party_id is now nullable; a NULL party_id means it's
--     the global room. Partial unique indices preserve the constraint
--     that there's at most one room per (party, type) and exactly one
--     global room per type.
--   * The synthetic global party from 0008 is removed; ON DELETE CASCADE
--     cleans its (party-scoped) chat_rooms automatically.
--   * The public-chat write policy drops the tier check. Phase 4 will
--     re-introduce it once memberships flow through Bold.
-- =====================================================================

-- 1. Allow chat_rooms.party_id to be NULL (global rooms have no party).
alter table public.chat_rooms alter column party_id drop not null;

-- 2. Replace the existing unique(party_id, type) constraint with two
--    partial unique indices. Postgres can't have a single unique cover
--    both NULL and non-NULL semantics cleanly, so we split them.
do $$ begin
  if exists (
    select 1 from pg_constraint
    where conname = 'chat_rooms_party_id_type_key'
      and conrelid = 'public.chat_rooms'::regclass
  ) then
    alter table public.chat_rooms drop constraint chat_rooms_party_id_type_key;
  end if;
end $$;

create unique index if not exists chat_rooms_party_unique
  on public.chat_rooms (party_id, type) where party_id is not null;

create unique index if not exists chat_rooms_global_unique
  on public.chat_rooms (type) where party_id is null;

-- 3. Drop the synthetic global party (cascade deletes its 2 chat_rooms).
--    Safe even if the party never existed (no rows match).
delete from public.parties
where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

-- 4. Create the real global public chat room. Idempotent: only inserts
--    if there's no existing global room of that type.
insert into public.chat_rooms (party_id, type)
select null::uuid, 'public'::chat_room_type
where not exists (
  select 1 from public.chat_rooms
  where party_id is null and type = 'public'
);

-- 5. Relax the public-room write policy. The tier check from 0003 made
--    the feature unusable for general-tier users (everyone right now).
--    The mute check stays so moderators can still silence specific users.
drop policy if exists messages_write_public on public.chat_messages;
create policy messages_write_public on public.chat_messages
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.chat_rooms r
      where r.id = room_id and r.type = 'public'
    )
    and not exists (
      select 1 from public.chat_mutes m
      where m.room_id = chat_messages.room_id
        and m.user_id = auth.uid()
        and m.muted_until > now()
    )
  );

-- 6. Same relaxation for the back_private room write policy. Today the
--    UI doesn't differentiate the back room, so blocking it just blocks
--    a feature that doesn't exist yet. Phase 4 will restore the
--    Back-tier-only / host-only check when the UI surfaces the private
--    lounge as a distinct space.
drop policy if exists messages_write_back on public.chat_messages;
create policy messages_write_back on public.chat_messages
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.chat_rooms r
      where r.id = room_id and r.type = 'back_private'
    )
    and not exists (
      select 1 from public.chat_mutes m
      where m.room_id = chat_messages.room_id
        and m.user_id = auth.uid()
        and m.muted_until > now()
    )
  );

-- 7. Same for back_private read. Otherwise users couldn't fetch their
--    own back room messages until memberships exist.
drop policy if exists messages_read_back on public.chat_messages;
create policy messages_read_back on public.chat_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.chat_rooms r
      where r.id = room_id and r.type = 'back_private'
    )
  );
