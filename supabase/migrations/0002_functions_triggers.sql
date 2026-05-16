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
