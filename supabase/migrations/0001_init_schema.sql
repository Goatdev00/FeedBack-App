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
