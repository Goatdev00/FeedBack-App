-- =====================================================================
-- FEEDBACK — Initial schema (Phase 1)
-- Targets: Supabase managed Postgres (16+)
-- =====================================================================
-- Conventions:
--   * UUIDs (uuid_generate_v4 is replaced by gen_random_uuid in pg13+).
--   * Money is stored as integer COP (Colombian peso has no decimals).
--   * Timestamps are timestamptz, stored in UTC.
--   * Author tier/role on chat_messages is denormalized for cheap reads
--     (a moderator should not have to JOIN to color a bubble).
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('raver', 'dj', 'promotor');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.membership_tier as enum ('general', 'vip', 'back');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.membership_status as enum ('pending', 'active', 'cancelled', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.transaction_status as enum ('pending', 'approved', 'rejected', 'refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.billing_cycle as enum ('monthly', 'yearly');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.party_status as enum ('upcoming', 'live', 'finished');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.rating_factor as enum ('sound', 'vibe', 'set', 'energy', 'organization', 'safety', 'location', 'crowd');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.chat_room_type as enum ('public', 'back_private');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.message_status as enum ('visible', 'hidden', 'featured');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- profiles
-- 1:1 with auth.users — the only table we mutate from the client.
-- membership_tier and membership_active_until are denormalized from
-- `memberships`, kept in sync by activate_membership() / cron.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                       uuid primary key references auth.users(id) on delete cascade,
  username                 citext unique not null,
  name                     text not null,
  role                     user_role not null default 'raver',
  city                     text not null default 'Bogotá',
  bio                      text,
  avatar_url               text,
  social                   jsonb not null default '{}'::jsonb,
  theme                    text not null default 'dark' check (theme in ('dark','light')),
  membership_tier          membership_tier not null default 'general',
  membership_active_until  timestamptz,
  points                   integer not null default 50,
  created_at               timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists profiles_city_idx on public.profiles(city);

-- ---------------------------------------------------------------------
-- parties
-- ---------------------------------------------------------------------
create table if not exists public.parties (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  venue        text not null,
  city         text not null,
  party_date   date not null,
  start_time   time not null,
  end_time     time not null,
  genres       text[] not null default '{}',
  promoter_id  uuid references public.profiles(id) on delete set null,
  flyer_url    text,
  description  text,
  sponsored    boolean not null default false,
  status       party_status not null default 'upcoming',
  created_at   timestamptz not null default now()
);

create index if not exists parties_date_idx     on public.parties(party_date);
create index if not exists parties_city_idx     on public.parties(city);
create index if not exists parties_promoter_idx on public.parties(promoter_id);
create index if not exists parties_status_idx   on public.parties(status);

-- party_djs (M2M)
create table if not exists public.party_djs (
  party_id  uuid not null references public.parties(id) on delete cascade,
  dj_id     uuid not null references public.profiles(id) on delete cascade,
  primary key (party_id, dj_id)
);
create index if not exists party_djs_dj_idx on public.party_djs(dj_id);

-- attendees (M2M)
create table if not exists public.party_attendees (
  party_id     uuid not null references public.parties(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  attended_at  timestamptz not null default now(),
  primary key (party_id, user_id)
);
create index if not exists attendees_user_idx on public.party_attendees(user_id);

-- ---------------------------------------------------------------------
-- posts (wall posts) — expire in 7 days
-- ---------------------------------------------------------------------
create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  party_id    uuid not null references public.parties(id) on delete cascade,
  content     text not null,
  image_url   text,
  type        text not null default 'text' check (type in ('text','photo')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '7 days')
);
create index if not exists posts_party_idx   on public.posts(party_id);
create index if not exists posts_user_idx    on public.posts(user_id);
create index if not exists posts_expires_idx on public.posts(expires_at);
create index if not exists posts_created_idx on public.posts(created_at desc);

create table if not exists public.post_likes (
  post_id     uuid not null references public.posts(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.post_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists post_comments_post_idx on public.post_comments(post_id, created_at);

-- ---------------------------------------------------------------------
-- questions (ask.fm style)
-- ---------------------------------------------------------------------
create table if not exists public.questions (
  id              uuid primary key default gen_random_uuid(),
  target_user_id  uuid not null references public.profiles(id) on delete cascade,
  asker_id        uuid references public.profiles(id) on delete set null,
  question        text not null,
  answer          text,
  anonymous       boolean not null default true,
  created_at      timestamptz not null default now(),
  answered_at     timestamptz
);
create index if not exists questions_target_idx on public.questions(target_user_id);

-- ---------------------------------------------------------------------
-- follows
-- ---------------------------------------------------------------------
create table if not exists public.follows (
  follower_id   uuid not null references public.profiles(id) on delete cascade,
  following_id  uuid not null references public.profiles(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index if not exists follows_following_idx on public.follows(following_id);

-- ---------------------------------------------------------------------
-- live_ratings — per-factor, weighted by tier at submission time
-- weight is the SNAPSHOT (x1 general, x2 vip, x3 back) so a user that
-- upgrades later doesn't retroactively boost old ratings.
-- ---------------------------------------------------------------------
create table if not exists public.live_ratings (
  party_id    uuid not null references public.parties(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  factor      rating_factor not null,
  value       smallint not null check (value between 1 and 5),
  weight      smallint not null default 1 check (weight in (1,2,3)),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (party_id, user_id, factor)
);
create index if not exists live_ratings_party_idx on public.live_ratings(party_id);

-- ---------------------------------------------------------------------
-- memberships
-- One active row per user (enforced by partial unique index).
-- "general" never has a row — absence of an active row implies general.
-- ---------------------------------------------------------------------
create table if not exists public.memberships (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  tier            membership_tier not null check (tier in ('vip','back')),
  status          membership_status not null default 'pending',
  billing_cycle   billing_cycle not null default 'monthly',
  price_cop       integer not null check (price_cop > 0),
  starts_at       timestamptz not null default now(),
  renews_at       timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists memberships_user_idx     on public.memberships(user_id, status);
create unique index if not exists memberships_one_active_per_user
  on public.memberships(user_id) where status = 'active';

-- ---------------------------------------------------------------------
-- membership_transactions
-- Bold's order_id is our idempotency key.
-- ---------------------------------------------------------------------
create table if not exists public.membership_transactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  membership_id     uuid references public.memberships(id) on delete set null,
  bold_order_id     text unique,
  bold_payment_id   text,
  tier              membership_tier not null,
  billing_cycle     billing_cycle not null,
  amount_cop        integer not null check (amount_cop > 0),
  status            transaction_status not null default 'pending',
  payment_method    text,
  raw_payload       jsonb,
  created_at        timestamptz not null default now(),
  confirmed_at      timestamptz
);
create index if not exists transactions_user_idx       on public.membership_transactions(user_id);
create index if not exists transactions_bold_order_idx on public.membership_transactions(bold_order_id);

-- ---------------------------------------------------------------------
-- chat_rooms — one (party_id, type) unique pair
-- ---------------------------------------------------------------------
create table if not exists public.chat_rooms (
  id          uuid primary key default gen_random_uuid(),
  party_id    uuid not null references public.parties(id) on delete cascade,
  type        chat_room_type not null,
  created_at  timestamptz not null default now(),
  unique (party_id, type)
);

-- ---------------------------------------------------------------------
-- chat_messages
-- author_tier / author_role / is_host are snapshotted via trigger so
-- a tier change doesn't retroactively restyle old bubbles.
-- ---------------------------------------------------------------------
create table if not exists public.chat_messages (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.chat_rooms(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  content       text not null check (length(content) between 1 and 500),
  author_tier   membership_tier not null default 'general',
  author_role   user_role not null default 'raver',
  is_host       boolean not null default false,
  status        message_status not null default 'visible',
  created_at    timestamptz not null default now()
);
create index if not exists chat_messages_room_idx on public.chat_messages(room_id, created_at desc);
create index if not exists chat_messages_user_idx on public.chat_messages(user_id);

-- chat_mutes — moderation (hosts only)
create table if not exists public.chat_mutes (
  room_id      uuid not null references public.chat_rooms(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  muted_by     uuid references public.profiles(id) on delete set null,
  muted_until  timestamptz not null,
  reason       text,
  primary key (room_id, user_id)
);

-- ---------------------------------------------------------------------
-- View: aggregate live rating per party / factor (weighted average).
-- Subscribed by the realtime client on the party-detail page.
-- ---------------------------------------------------------------------
create or replace view public.party_live_ratings as
  select
    party_id,
    factor,
    sum(value * weight)::numeric / nullif(sum(weight), 0) as weighted_avg,
    sum(weight) as total_weight,
    count(*)::int as raters
  from public.live_ratings
  group by party_id, factor;
-- =====================================================================
-- FEEDBACK — Functions & triggers (Phase 1)
-- All security-definer functions explicitly set search_path = public to
-- avoid the well-known "trojan schema" attack.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Resolve current tier of a user (general if no active membership).
-- Used by RLS policies on chat_messages and posts.
-- ---------------------------------------------------------------------
create or replace function public.current_tier(uid uuid)
returns membership_tier
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select tier from public.memberships
      where user_id = uid
        and status = 'active'
        and (renews_at is null or renews_at > now())
      order by case tier when 'back' then 1 when 'vip' then 2 else 3 end
      limit 1),
    'general'::membership_tier
  );
$$;

-- Numeric weight for live ratings.
create or replace function public.tier_weight(t membership_tier)
returns smallint
language sql
immutable
as $$
  select case t when 'back' then 3::smallint when 'vip' then 2::smallint else 1::smallint end;
$$;

-- ---------------------------------------------------------------------
-- Host detection: a user is a host of a party if they are the promoter
-- of record OR a registered DJ of that party.
-- ---------------------------------------------------------------------
create or replace function public.is_party_host(uid uuid, pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.parties      where id = pid and promoter_id = uid)
      or exists (select 1 from public.party_djs    where party_id = pid and dj_id = uid);
$$;

-- ---------------------------------------------------------------------
-- Posts created by a user *today* (server time, UTC by default).
-- Used by RLS to enforce general-tier daily limit.
-- ---------------------------------------------------------------------
create or replace function public.posts_today(uid uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.posts
  where user_id = uid
    and created_at >= date_trunc('day', now());
$$;

-- ---------------------------------------------------------------------
-- handle_new_user: auto-create a profile row on auth signup.
-- The frontend passes profile info via auth.signUp({ options.data }).
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username citext;
  v_name     text;
  v_role     user_role;
  v_city     text;
begin
  v_username := coalesce(
    nullif(new.raw_user_meta_data->>'username', '')::citext,
    ('@user_' || substr(new.id::text, 1, 8))::citext
  );
  v_name := coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1));
  v_role := coalesce((new.raw_user_meta_data->>'role')::user_role, 'raver');
  v_city := coalesce(nullif(new.raw_user_meta_data->>'city', ''), 'Bogotá');

  insert into public.profiles (id, username, name, role, city, avatar_url)
  values (
    new.id,
    v_username,
    v_name,
    v_role,
    v_city,
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Auto-create chat rooms when a party is inserted.
-- Public room is for everyone (read-only for general tier).
-- back_private is the artist's lounge — Back-tier-only + party hosts.
-- ---------------------------------------------------------------------
create or replace function public.create_party_chat_rooms()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.chat_rooms (party_id, type)
  values (new.id, 'public'),
         (new.id, 'back_private')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists after_party_insert on public.parties;
create trigger after_party_insert
  after insert on public.parties
  for each row execute function public.create_party_chat_rooms();

-- ---------------------------------------------------------------------
-- chat_messages: snapshot author tier/role/host at insert time.
-- Done BEFORE INSERT so the client can omit those columns; they are
-- derived authoritatively on the server.
-- ---------------------------------------------------------------------
create or replace function public.snapshot_message_meta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party_id uuid;
  v_role     user_role;
begin
  select role into v_role from public.profiles where id = new.user_id;
  select party_id into v_party_id from public.chat_rooms where id = new.room_id;
  new.author_tier := public.current_tier(new.user_id);
  new.author_role := v_role;
  new.is_host     := public.is_party_host(new.user_id, v_party_id);
  -- Back-tier messages and host messages render featured by default
  if new.author_tier = 'back' or new.is_host then
    new.status := coalesce(nullif(new.status, 'hidden'), 'visible');
  end if;
  return new;
end;
$$;

drop trigger if exists before_message_insert on public.chat_messages;
create trigger before_message_insert
  before insert on public.chat_messages
  for each row execute function public.snapshot_message_meta();

-- ---------------------------------------------------------------------
-- Auto-snapshot live_rating weight from the user's current tier.
-- Client may pass weight, but we override it to match server truth.
-- ---------------------------------------------------------------------
create or replace function public.snapshot_rating_weight()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.weight := public.tier_weight(public.current_tier(new.user_id));
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists before_rating_upsert on public.live_ratings;
create trigger before_rating_upsert
  before insert or update on public.live_ratings
  for each row execute function public.snapshot_rating_weight();

-- ---------------------------------------------------------------------
-- Membership lifecycle: activate / expire.
-- Called from the bold-webhook Edge Function via service_role.
-- ---------------------------------------------------------------------
create or replace function public.activate_membership(
  p_user_id        uuid,
  p_tier           membership_tier,
  p_billing_cycle  billing_cycle,
  p_price_cop      integer,
  p_bold_order_id  text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership_id uuid;
  v_renews_at     timestamptz;
begin
  if p_tier = 'general' then
    raise exception 'activate_membership called with general tier';
  end if;

  v_renews_at := case p_billing_cycle
    when 'yearly' then now() + interval '1 year'
    else               now() + interval '1 month'
  end;

  -- Cancel any prior active membership (one-active-per-user invariant).
  update public.memberships
     set status = 'cancelled',
         cancelled_at = now()
   where user_id = p_user_id
     and status = 'active';

  insert into public.memberships
    (user_id, tier, status, billing_cycle, price_cop, starts_at, renews_at)
  values
    (p_user_id, p_tier, 'active', p_billing_cycle, p_price_cop, now(), v_renews_at)
  returning id into v_membership_id;

  -- Denormalize onto profile so RLS and reads stay fast.
  update public.profiles
     set membership_tier = p_tier,
         membership_active_until = v_renews_at
   where id = p_user_id;

  -- Close the matching transaction.
  update public.membership_transactions
     set status = 'approved',
         confirmed_at = now(),
         membership_id = v_membership_id
   where bold_order_id = p_bold_order_id;

  return v_membership_id;
end;
$$;

revoke all on function public.activate_membership(uuid, membership_tier, billing_cycle, integer, text) from public, anon, authenticated;
grant execute on function public.activate_membership(uuid, membership_tier, billing_cycle, integer, text) to service_role;

-- ---------------------------------------------------------------------
-- Cancel: keep tier benefits until renews_at; flip status, no refund.
-- Callable by the owner via supabase.rpc('cancel_membership').
-- ---------------------------------------------------------------------
create or replace function public.cancel_membership()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.memberships
     set status = 'cancelled',
         cancelled_at = now()
   where user_id = auth.uid()
     and status = 'active';
end;
$$;

grant execute on function public.cancel_membership() to authenticated;

-- ---------------------------------------------------------------------
-- expire_memberships: called by pg_cron daily to flip lapsed rows.
-- ---------------------------------------------------------------------
create or replace function public.expire_memberships()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  with expired as (
    update public.memberships
       set status = 'expired'
     where status in ('active','cancelled')
       and renews_at is not null
       and renews_at <= now()
    returning user_id
  )
  update public.profiles p
     set membership_tier = 'general',
         membership_active_until = null
    from expired e
   where p.id = e.user_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_memberships() from public, anon, authenticated;
grant execute on function public.expire_memberships() to service_role;
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
-- =====================================================================
-- FEEDBACK — Realtime publication setup (Phase 1)
-- Tables exposed via supabase_realtime are broadcast via Postgres CDC
-- to subscribed clients. Keep this list intentional — every table here
-- pays a write-time cost.
-- =====================================================================

-- The supabase_realtime publication is created automatically by Supabase.
-- We just add (or replace) the table list to it.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$ 
declare
  t text;
begin
  for t in select unnest(array['chat_messages','live_ratings','parties','posts','post_likes','post_comments','party_attendees'])
  loop
    if not exists (
      select 1 from pg_publication_tables 
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
-- =====================================================================
-- FEEDBACK — Phase 2: onboarding flag + Bold-less dev mock activation
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Onboarding flag on profiles.
--    auth.users → handle_new_user creates a row with defaults; we need
--    to know whether the user has completed the role/city/bio step.
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists onboarding_complete boolean not null default false;

-- ---------------------------------------------------------------------
-- 2. dev_mock_activate_membership
--    Callable from the browser to simulate a successful Bold payment.
--    REMOVE OR REVOKE this function before going to production.
-- ---------------------------------------------------------------------
create or replace function public.dev_mock_activate_membership(
  p_tier          membership_tier,
  p_billing_cycle billing_cycle
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id       uuid;
  v_price         integer;
  v_order_id      text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;
  if p_tier = 'general' then
    raise exception 'cannot mock general tier';
  end if;

  v_price := case
    when p_tier = 'vip'  and p_billing_cycle = 'monthly' then 14900
    when p_tier = 'vip'  and p_billing_cycle = 'yearly'  then 149000
    when p_tier = 'back' and p_billing_cycle = 'monthly' then 29900
    when p_tier = 'back' and p_billing_cycle = 'yearly'  then 299000
  end;
  if v_price is null then
    raise exception 'price_unknown for tier %, cycle %', p_tier, p_billing_cycle;
  end if;

  v_order_id := 'mock-' || replace(gen_random_uuid()::text, '-', '');

  insert into public.membership_transactions
    (user_id, tier, billing_cycle, amount_cop, bold_order_id, status, payment_method)
  values
    (v_user_id, p_tier, p_billing_cycle, v_price, v_order_id, 'pending', 'mock');

  return public.activate_membership(v_user_id, p_tier, p_billing_cycle, v_price, v_order_id);
end;
$$;

grant execute on function public.dev_mock_activate_membership(membership_tier, billing_cycle) to authenticated;

-- Convenience companion: revert to general tier for testing.
create or replace function public.dev_mock_cancel_membership()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update public.memberships
     set status = 'cancelled', cancelled_at = now(), renews_at = now()
   where user_id = auth.uid() and status = 'active';
  update public.profiles
     set membership_tier = 'general', membership_active_until = null
   where id = auth.uid();
end;
$$;

grant execute on function public.dev_mock_cancel_membership() to authenticated;
-- =====================================================================
-- FEEDBACK — Per-user app state blob (Phase 2.5)
-- =====================================================================
-- MVP cross-device persistence: store the whole legacy localStorage
-- state as JSONB per user. The frontend hydrates from this on boot
-- and writes back (debounced) on every change.
--
-- Why not normalize into proper tables (posts/comments/likes/etc)?
--   * Phase 4 will do that and give us cross-user social.
--   * For now the user just wants their own data to survive across
--     devices — a per-user JSON blob solves that with one table.
--
-- The state column can be large (posts, comments, chat logs, etc).
-- Postgres JSONB caps a row at 1 GB which we will never approach.
-- =====================================================================

create table if not exists public.user_app_state (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  state        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

create index if not exists user_app_state_updated_idx
  on public.user_app_state(updated_at desc);

alter table public.user_app_state enable row level security;

-- Only the owner can read or upsert their own row.
drop policy if exists app_state_select_self on public.user_app_state;
create policy app_state_select_self on public.user_app_state
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists app_state_insert_self on public.user_app_state;
create policy app_state_insert_self on public.user_app_state
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists app_state_update_self on public.user_app_state;
create policy app_state_update_self on public.user_app_state
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Bump updated_at on every write — cheap audit trail and useful for
-- diagnosing "is the cloud sync actually running".
create or replace function public.touch_user_app_state()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists before_user_app_state_update on public.user_app_state;
create trigger before_user_app_state_update
  before update on public.user_app_state
  for each row execute function public.touch_user_app_state();
-- =====================================================================
-- FEEDBACK — Seed mock parties (Phase 3)
-- =====================================================================
-- The legacy localStorage mock had 5 parties + their mock posts/users.
-- For normalized cross-user persistence, we drop the mock POSTS/USERS
-- (real users will populate them through use) but keep the mock PARTIES
-- so the wall has something to attach posts to from day one.
--
-- promoter_id is NULL because the mock promoter (u3) was never a real
-- auth.users row; same for djs.
--
-- The party_id values here are stable UUIDs the frontend hard-codes in
-- src/data/mock-data.js so the two stay in sync.
-- =====================================================================

insert into public.parties
  (id, name, venue, city, party_date, start_time, end_time, genres,
   promoter_id, flyer_url, description, sponsored, status)
values
  ('a1111111-1111-4111-8111-111111111111',
   'NEXUS — Underground Session', 'Warehouse Club', 'Bogotá',
   current_date, '22:00', '06:00',
   array['Techno','Dark Techno'],
   null, null,
   'Una noche de techno puro en lo más profundo del underground bogotano.',
   false, 'upcoming'),

  ('a2222222-2222-4222-8222-222222222222',
   'PULSE — House & Disco', 'Terraza Nocturna', 'Bogotá',
   current_date, '21:00', '04:00',
   array['House','Disco','Deep House'],
   null, null,
   'La mejor selección de house y disco en la terraza más icónica de la ciudad.',
   true, 'upcoming'),

  ('a3333333-3333-4333-8333-333333333333',
   'BASS CATHEDRAL', 'Bodega 42', 'Bogotá',
   current_date, '23:00', '07:00',
   array['Drum & Bass','Jungle','Breakbeat'],
   null, null,
   'La catedral del bass te espera con los mejores DJs nacionales.',
   false, 'upcoming'),

  ('a4444444-4444-4444-8444-444444444444',
   'ECLIPSE — Melodic Techno', 'Club Astral', 'Medellín',
   current_date, '22:00', '05:00',
   array['Melodic Techno','Progressive'],
   null, null,
   'Viaje sonoro a través del melodic techno en el venue más premium de Medellín.',
   false, 'upcoming'),

  ('a5555555-5555-4555-8555-555555555555',
   'FREKVENCIA', 'La Factoría', 'Cali',
   current_date, '23:00', '06:00',
   array['Minimal','Tech House'],
   null, null,
   'Minimal vibes en el corazón de Cali.',
   false, 'upcoming')
on conflict (id) do nothing;
-- =====================================================================
-- FEEDBACK — Global chat party (Phase 3.5)
-- =====================================================================
-- The general live chat needs a `chat_rooms` row but our schema requires
-- party_id NOT NULL. Cheapest workaround: a synthetic "global" party row
-- with a known UUID that the frontend filters out of the parties list.
-- The trigger create_party_chat_rooms() then creates the public chat
-- room for it automatically.
-- =====================================================================

insert into public.parties
  (id, name, venue, city, party_date, start_time, end_time, genres,
   promoter_id, flyer_url, description, sponsored, status)
values
  ('ffffffff-ffff-4fff-8fff-ffffffffffff',
   'Chat General', 'Toda la escena', '—',
   current_date, '00:00', '23:59',
   array[]::text[],
   null, null,
   'Chat general de la escena — habla con todos en tiempo real.',
   false, 'live')
on conflict (id) do nothing;
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
-- =====================================================================
-- FEEDBACK — Production hardening (pre-launch)
-- =====================================================================
-- BEFORE this migration, two `dev_mock_*` RPCs were callable by ANY
-- authenticated user and let them self-grant tier 'vip' or 'back' for
-- free, bypassing the (future) Bold payment flow entirely:
--
--   public.dev_mock_activate_membership(tier, cycle)
--   public.dev_mock_cancel_membership()
--
-- This is fine in development, catastrophic in production: any user who
-- discovers the RPC name in the JS bundle (which they will — it's there
-- as `payments.js → supabase.rpc('dev_mock_activate_membership', ...)`)
-- can call it via the browser console.
--
-- This migration removes them entirely. Phase 4 will replace them with
-- the real Bold flow: edge function `create-bold-checkout` redirects
-- the user to Bold, Bold's webhook calls `activate_membership(...)` via
-- service_role on settlement — no user-callable RPC granting tier.
-- =====================================================================

drop function if exists public.dev_mock_activate_membership(public.membership_tier, public.billing_cycle);
drop function if exists public.dev_mock_cancel_membership();

-- Defense in depth: keep `activate_membership` reachable only by the
-- service_role (it's the real activation entry point used by the Bold
-- webhook edge function). This was already true in migration 0002,
-- restated here so production reviewers see it explicitly.
revoke execute on function public.activate_membership(uuid, public.membership_tier, public.billing_cycle, integer, text) from public, anon, authenticated;
grant execute on function public.activate_membership(uuid, public.membership_tier, public.billing_cycle, integer, text) to service_role;
