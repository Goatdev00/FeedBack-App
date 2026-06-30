-- =====================================================================
-- FEEDBACK — Super-admin identity + user moderation columns (FASE 0)
-- =====================================================================
-- Builds the foundation for the "FeedBack" super-admin. Three rules that
-- the rest of the admin system leans on live here:
--
--   1. is_admin is a BOOLEAN on profiles, NOT a 4th user_role value.
--      Adding 'admin' to user_role would pollute the signup whitelist
--      (0028), the role freeze (0023) and the chat badge snapshot
--      (chat_messages.author_role, 0002). A separate flag keeps roles
--      orthogonal to moderation power.
--
--   2. is_admin (and the moderation_* columns) are SERVER-ONLY. They are
--      frozen in profiles_update_self below, so no client UPDATE can
--      ever self-grant admin or self-unban. They flip ONLY via:
--        - service_role / SQL editor (seeding the FeedBack account), or
--        - the SECURITY DEFINER admin_* RPCs (later migrations), which
--          run as the function owner and bypass this policy.
--
--   3. The FeedBack account is identified by auth.users.email (immutable
--      server-side), NEVER by profiles.username (client-editable — a
--      full freeze on username would break profile editing, and anyone
--      could rename themselves "feedback"). See the seeding step at the
--      bottom (run once, by hand, with the real email).
--
-- moderation_status drives mute/ban. Expiry is evaluated at READ TIME via
-- is_muted()/is_banned() (moderation_until), so there is no cron to drift
-- — same philosophy as party_visible() in 0021.
-- =====================================================================

-- ---------------------------------------------------------------------
-- moderation_status enum: active (normal) / muted (can read, cannot
-- write) / banned (cannot log in, cannot write). Distinct from the
-- existing membership_status / message_status enums.
--
-- SCOPE OF EACH STATE (what actually enforces it, to avoid over-promising
-- — FASE-0 review note):
--   * muted/banned WRITE-blocking is enforced by write policies wired in
--     FASE 2 (posts/comments/chat insert gated on `not is_muted(...)`).
--   * banned LOGIN-blocking is enforced by the admin-moderate Edge
--     Function (auth.admin.updateUserById ban_duration), FASE 2.
--   * Hiding a banned user's ALREADY-POSTED content is NOT automatic in
--     the read policies (that would cost an is_banned() call per row on
--     the hot path). It happens because the ban RPC (admin_set_moderation,
--     FASE 2) bulk-soft-deletes the user's content through the same
--     restorable machinery as 0033 — so an un-ban restores it.
-- is_banned()/is_muted() below are the read-time predicates those FASE-2
-- pieces consume; they are intentionally not referenced by any 0032 read
-- policy.
-- ---------------------------------------------------------------------
do $$ begin
  create type public.moderation_status as enum ('active', 'muted', 'banned');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- New profiles columns. All server-controlled (frozen below).
--   * is_admin           — super-admin flag.
--   * moderation_status  — active/muted/banned.
--   * moderation_reason  — human-readable reason shown in the audit log.
--   * moderation_until   — NULL = permanent; a future ts = temporary
--                          (auto-expires at read time).
--   * moderation_by      — which admin applied the current status.
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_admin          boolean not null default false,
  add column if not exists moderation_status public.moderation_status not null default 'active',
  add column if not exists moderation_reason text,
  add column if not exists moderation_until  timestamptz,
  add column if not exists moderation_by     uuid references public.profiles(id) on delete set null;

create index if not exists profiles_is_admin_idx
  on public.profiles(is_admin) where is_admin = true;
create index if not exists profiles_moderation_idx
  on public.profiles(moderation_status) where moderation_status <> 'active';

-- ---------------------------------------------------------------------
-- is_admin(uid): the ONE place the admin check lives. Every admin RPC
-- and every read policy's admin-override calls this.
--   * SECURITY DEFINER + search_path=public: same hardening as
--     is_party_host (0002:42); reads profiles bypassing RLS.
--   * default auth.uid(): is_admin() with no args checks the caller;
--     is_admin(some_uid) checks anyone (used by cannot_target_admin).
-- ---------------------------------------------------------------------
create or replace function public.is_admin(p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = p_uid and is_admin = true
  );
$$;

grant execute on function public.is_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- is_banned(uid) / is_muted(uid): read-time evaluation of moderation
-- with auto-expiry. A temporary sanction (moderation_until in the
-- future) is active; once the timestamp passes, the helper reports the
-- user as clear without any job flipping the row back.
-- ---------------------------------------------------------------------
create or replace function public.is_banned(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = p_uid
      and moderation_status = 'banned'
      and (moderation_until is null or moderation_until > now())
  );
$$;

create or replace function public.is_muted(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = p_uid
      and moderation_status in ('muted', 'banned')
      and (moderation_until is null or moderation_until > now())
  );
$$;

grant execute on function public.is_banned(uuid) to authenticated;
grant execute on function public.is_muted(uuid)  to authenticated;

-- ---------------------------------------------------------------------
-- Re-define profiles_update_self to ALSO freeze is_admin + every
-- moderation_* column, on top of everything 0023 already froze
-- (membership_tier, points, membership_active_until, role-whitelist).
-- The subselects read the row's CURRENT value (statement snapshot), the
-- same pattern 0003/0023 use. Nullable columns compared with
-- IS NOT DISTINCT FROM so a no-op save isn't wrongly rejected.
-- ---------------------------------------------------------------------
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    -- tier flips happen via activate_membership() (service_role).
    and membership_tier = (select membership_tier from public.profiles where id = auth.uid())
    -- points change only through award_points() / report_post().
    and points = (select points from public.profiles where id = auth.uid())
    -- membership window is service_role-only; nullable → IS NOT DISTINCT FROM.
    and membership_active_until is not distinct from
        (select membership_active_until from public.profiles where id = auth.uid())
    -- role: keep current, or pick a non-privileged role (onboarding).
    and (
      role = (select role from public.profiles where id = auth.uid())
      or role in ('raver', 'dj')
    )
    -- admin power is NEVER self-assignable; flips only via service_role.
    and is_admin = (select is_admin from public.profiles where id = auth.uid())
    -- moderation is admin-only; a user can't lift their own mute/ban.
    and moderation_status = (select moderation_status from public.profiles where id = auth.uid())
    and moderation_reason is not distinct from
        (select moderation_reason from public.profiles where id = auth.uid())
    and moderation_until is not distinct from
        (select moderation_until from public.profiles where id = auth.uid())
    and moderation_by is not distinct from
        (select moderation_by from public.profiles where id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- SEED THE FEEDBACK ADMIN — RUN THIS ONCE, BY HAND, in the Supabase SQL
-- editor (service_role bypasses the freeze above). Replace the email
-- with the REAL email of the FeedBack account. Kept commented so this
-- migration never hardcodes an address into version control.
--
--   update public.profiles p
--      set is_admin = true
--     from auth.users u
--    where u.id = p.id
--      and u.email = 'EL_CORREO_REAL_DE_FEEDBACK';
--
-- Verify afterwards:
--   select p.username, u.email, p.is_admin
--     from public.profiles p join auth.users u on u.id = p.id
--    where p.is_admin;
-- ---------------------------------------------------------------------

notify pgrst, 'reload schema';
