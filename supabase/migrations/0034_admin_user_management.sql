-- =====================================================================
-- FEEDBACK — Admin user management + mute enforcement (FASE 2 server)
-- =====================================================================
-- Powers the SUPERUSUARIO "Usuarios" tab. Every function is SECURITY
-- DEFINER, opens with an is_admin() gate, protects the admin account
-- (cannot_target_admin) and the caller's own row, logs to moderation_log,
-- and is granted only to authenticated (the body re-checks is_admin so a
-- direct RPC call by a non-admin gets nothing). Same posture as 0033.
--
-- Login-blocking for a ban and hard account deletion need auth.admin and
-- therefore live in Edge Functions (admin-moderate / admin-delete-user);
-- this migration covers everything expressible in pure SQL: listing,
-- role changes, mute/ban STATUS (write-blocking), and GDPR anonymize.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Mute enforcement: a muted (or banned, since is_muted covers both) user
-- can READ but cannot create content. A BEFORE INSERT trigger is used
-- instead of editing each insert policy because (a) the existing policies
-- are non-trivial (tier/daily-limit/room-type checks) and re-stating them
-- risks drift, and (b) one trigger fn covers every content table
-- uniformly. service_role / SQL editor (auth.uid() NULL) and admins are
-- never muted, so they pass.
-- ---------------------------------------------------------------------
create or replace function public.block_if_muted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Admins are never write-blocked (matches cannot_target_admin elsewhere),
  -- even if a stale moderation_status lingers on a since-promoted account.
  if auth.uid() is not null
     and not public.is_admin(auth.uid())
     and public.is_muted(auth.uid()) then
    raise exception 'user_muted';
  end if;
  return new;
end;
$$;

drop trigger if exists before_insert_block_if_muted on public.posts;
create trigger before_insert_block_if_muted
  before insert on public.posts
  for each row execute function public.block_if_muted();

drop trigger if exists before_insert_block_if_muted on public.post_comments;
create trigger before_insert_block_if_muted
  before insert on public.post_comments
  for each row execute function public.block_if_muted();

drop trigger if exists before_insert_block_if_muted on public.chat_messages;
create trigger before_insert_block_if_muted
  before insert on public.chat_messages
  for each row execute function public.block_if_muted();

drop trigger if exists before_insert_block_if_muted on public.questions;
create trigger before_insert_block_if_muted
  before insert on public.questions
  for each row execute function public.block_if_muted();

-- ---------------------------------------------------------------------
-- admin_list_users — paginated, searchable directory with the email
-- (read from auth.users, which only a definer can reach). p_search
-- matches username / name / email (case-insensitive). p_role / p_status
-- are optional exact filters ('' or null = no filter).
-- ---------------------------------------------------------------------
create or replace function public.admin_list_users(
  p_search text default null,
  p_role   text default null,
  p_status text default null,
  p_limit  int  default 50,
  p_offset int  default 0
)
returns table (
  id                uuid,
  username          text,
  name              text,
  role              text,
  email             text,
  city              text,
  points            int,
  is_admin          boolean,
  moderation_status text,
  moderation_until  timestamptz,
  created_at        timestamptz,
  avatar_url        text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  return query
    select
      p.id,
      p.username::text,
      p.name,
      p.role::text,
      u.email::text,
      p.city,
      p.points,
      p.is_admin,
      p.moderation_status::text,
      p.moderation_until,
      p.created_at,
      p.avatar_url
    from public.profiles p
    join auth.users u on u.id = p.id
    where (
        p_search is null or p_search = ''
        or p.username ilike '%' || p_search || '%'
        or p.name     ilike '%' || p_search || '%'
        or u.email    ilike '%' || p_search || '%'
      )
      and (p_role   is null or p_role   = '' or p.role::text = p_role)
      and (p_status is null or p_status = '' or p.moderation_status::text = p_status)
    order by p.created_at desc
    limit  greatest(1, least(p_limit, 200))
    offset greatest(0, p_offset);
end;
$$;

-- ---------------------------------------------------------------------
-- admin_emails_for_ids — resolve emails for a SET of user ids (reads
-- auth.users). Used by the admin-broadcast Edge Function to build the
-- email list for exactly the resolved recipients, instead of paging all
-- of auth.users (which capped at 50k). REVOKEd from everyone — only the
-- service_role inside the edge function calls it (service_role bypasses
-- function grants). Like admin_list_users it depends on its owner holding
-- SELECT on auth.users (true for the default Supabase `postgres` owner).
-- ---------------------------------------------------------------------
create or replace function public.admin_emails_for_ids(p_ids uuid[])
returns table (id uuid, email text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.email::text
  from auth.users u
  where u.id = any(p_ids) and u.email is not null;
$$;

-- ---------------------------------------------------------------------
-- admin_set_role — grant/revoke raver/dj/promotor. This is the BLESSED
-- path that legitimately bypasses the 0023 freeze + 0028 signup whitelist
-- (which exist to stop SELF-promotion); only this is_admin-gated definer
-- may issue 'promotor'. (Documented so a future audit doesn't "fix" it.)
-- ---------------------------------------------------------------------
create or replace function public.admin_set_role(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_role not in ('raver', 'dj', 'promotor') then raise exception 'invalid_role'; end if;
  if public.is_admin(p_user) then raise exception 'cannot_target_admin'; end if;

  select to_jsonb(p) into v_before from public.profiles p where p.id = p_user;
  if v_before is null then raise exception 'user_not_found'; end if;

  update public.profiles set role = p_role::user_role where id = p_user;

  insert into public.moderation_log
    (actor_id, action, target_type, target_id, reason, before_state)
  values
    (auth.uid(), 'set_role', 'user', p_user, p_role, v_before);
end;
$$;

-- ---------------------------------------------------------------------
-- admin_set_moderation — set active / muted / banned (+ reason + optional
-- expiry). DB-level only: it controls WRITE access (via is_muted and the
-- block_if_muted trigger). LOGIN-blocking for a ban additionally requires
-- the admin-moderate Edge Function (auth.admin ban_duration). Cannot
-- target an admin or the caller themselves.
-- ---------------------------------------------------------------------
create or replace function public.admin_set_moderation(
  p_user   uuid,
  p_status text,
  p_reason text default null,
  p_until  timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_status not in ('active', 'muted', 'banned') then raise exception 'invalid_status'; end if;
  if p_user = auth.uid() then raise exception 'cannot_target_self'; end if;
  if public.is_admin(p_user) then raise exception 'cannot_target_admin'; end if;

  select to_jsonb(p) into v_before from public.profiles p where p.id = p_user;
  if v_before is null then raise exception 'user_not_found'; end if;

  update public.profiles
     set moderation_status = p_status::public.moderation_status,
         moderation_reason = case when p_status = 'active' then null else p_reason end,
         moderation_until  = case when p_status = 'active' then null else p_until end,
         moderation_by     = case when p_status = 'active' then null else auth.uid() end
   where id = p_user;

  insert into public.moderation_log
    (actor_id, action, target_type, target_id, reason, before_state)
  values
    (auth.uid(), 'set_moderation', 'user', p_user, p_status || coalesce(' — ' || p_reason, ''), v_before);
end;
$$;

-- ---------------------------------------------------------------------
-- admin_anonymize_user — GDPR-style soft delete: strip PII, keep the row
-- and its authored content (rendered as "Usuario eliminado"). Account
-- still exists in auth.users (use admin-delete-user for a hard delete).
-- ---------------------------------------------------------------------
create or replace function public.admin_anonymize_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_user = auth.uid() then raise exception 'cannot_target_self'; end if;
  if public.is_admin(p_user) then raise exception 'cannot_target_admin'; end if;

  select to_jsonb(p) into v_before from public.profiles p where p.id = p_user;
  if v_before is null then raise exception 'user_not_found'; end if;

  update public.profiles
     set name       = 'Usuario eliminado',
         username   = ('@deleted_' || replace(p_user::text, '-', ''))::citext,
         bio        = null,
         avatar_url = null,
         social     = '{}'::jsonb
   where id = p_user;

  insert into public.moderation_log
    (actor_id, action, target_type, target_id, reason, before_state)
  values
    (auth.uid(), 'anonymize', 'user', p_user, null, v_before);
end;
$$;

-- ---------------------------------------------------------------------
-- Moderation-queue read access for the admin panel. These tables were
-- write-only / self-only before; admins need to read them for the
-- "Moderación" tab. Each new policy is ADDITIVE (permissive) — the
-- existing post_reports_read_self (0014) and support_tickets_insert
-- (0022) stay, and RLS ORs permissive policies, so normal users keep
-- exactly their prior access while admins gain a full view.
-- ---------------------------------------------------------------------
drop policy if exists post_reports_read_admin on public.post_reports;
create policy post_reports_read_admin on public.post_reports
  for select to authenticated
  using (public.is_admin(auth.uid()));

drop policy if exists support_tickets_read_admin on public.support_tickets;
create policy support_tickets_read_admin on public.support_tickets
  for select to authenticated
  using (public.is_admin(auth.uid()));

-- Admin may flip a ticket's status (open/in_progress/closed). The
-- with-check keeps the write admin-only too.
drop policy if exists support_tickets_update_admin on public.support_tickets;
create policy support_tickets_update_admin on public.support_tickets
  for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------
-- Lock down.
-- ---------------------------------------------------------------------
revoke execute on function public.admin_list_users(text, text, text, int, int) from public, anon;
revoke execute on function public.admin_set_role(uuid, text)                    from public, anon;
revoke execute on function public.admin_set_moderation(uuid, text, text, timestamptz) from public, anon;
revoke execute on function public.admin_anonymize_user(uuid)                    from public, anon;
-- admin_emails_for_ids is service_role-only (called by admin-broadcast);
-- no grant to authenticated.
revoke execute on function public.admin_emails_for_ids(uuid[])                  from public, anon, authenticated;

grant execute on function public.admin_list_users(text, text, text, int, int) to authenticated;
grant execute on function public.admin_set_role(uuid, text)                    to authenticated;
grant execute on function public.admin_set_moderation(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.admin_anonymize_user(uuid)                    to authenticated;

-- The two auth.users readers must run as an owner with SELECT on auth.users.
-- On default Supabase the creator is already `postgres`; pin it so a
-- non-default migration role can't leave them running as someone without
-- auth-schema access. (No-op when already postgres-owned.)
alter function public.admin_list_users(text, text, text, int, int) owner to postgres;
alter function public.admin_emails_for_ids(uuid[])                  owner to postgres;

notify pgrst, 'reload schema';
