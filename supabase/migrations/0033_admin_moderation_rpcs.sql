-- =====================================================================
-- FEEDBACK — Admin soft-delete + restore RPCs (FASE 1 server side)
-- =====================================================================
-- The only way the app deletes/restores content as the admin. Every
-- function:
--   * is SECURITY DEFINER set search_path=public (owner privileges,
--     trojan-schema safe) — same posture as report_post() (0014:97);
--   * opens with `if not public.is_admin() then raise 'forbidden'`, so a
--     non-admin calling the RPC by hand gets nothing;
--   * writes a moderation_log row with a before_state snapshot so the
--     trash view can preview it and admin_restore() can put it back;
--   * is REVOKEd from public/anon and GRANTed only to authenticated.
--
-- Soft-delete only — never a physical DELETE (the FK cascades would wipe
-- children with no audit trail; see 0031).
-- =====================================================================

-- ---------------------------------------------------------------------
-- admin_soft_delete_post
-- ---------------------------------------------------------------------
create or replace function public.admin_soft_delete_post(
  p_post_id uuid,
  p_reason  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_log    uuid;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  select to_jsonb(p) into v_before
  from public.posts p
  where p.id = p_post_id and p.deleted_at is null;
  if v_before is null then raise exception 'post_not_found_or_already_deleted'; end if;

  update public.posts
     set deleted_at = now(), deleted_by = auth.uid(), deleted_reason = p_reason
   where id = p_post_id;

  insert into public.moderation_log
    (actor_id, action, target_type, target_id, reason, before_state)
  values
    (auth.uid(), 'soft_delete', 'post', p_post_id, p_reason, v_before)
  returning id into v_log;

  return v_log;
end;
$$;

-- ---------------------------------------------------------------------
-- admin_soft_delete_comment
-- ---------------------------------------------------------------------
create or replace function public.admin_soft_delete_comment(
  p_comment_id uuid,
  p_reason     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_log    uuid;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  select to_jsonb(c) into v_before
  from public.post_comments c
  where c.id = p_comment_id and c.deleted_at is null;
  if v_before is null then raise exception 'comment_not_found_or_already_deleted'; end if;

  update public.post_comments
     set deleted_at = now(), deleted_by = auth.uid(), deleted_reason = p_reason
   where id = p_comment_id;

  insert into public.moderation_log
    (actor_id, action, target_type, target_id, reason, before_state)
  values
    (auth.uid(), 'soft_delete', 'comment', p_comment_id, p_reason, v_before)
  returning id into v_log;

  return v_log;
end;
$$;

-- ---------------------------------------------------------------------
-- admin_soft_delete_chat_message
-- ---------------------------------------------------------------------
create or replace function public.admin_soft_delete_chat_message(
  p_message_id uuid,
  p_reason     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_log    uuid;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  select to_jsonb(m) into v_before
  from public.chat_messages m
  where m.id = p_message_id and m.deleted_at is null;
  if v_before is null then raise exception 'message_not_found_or_already_deleted'; end if;

  update public.chat_messages
     set deleted_at = now(), deleted_by = auth.uid(), deleted_reason = p_reason
   where id = p_message_id;

  insert into public.moderation_log
    (actor_id, action, target_type, target_id, reason, before_state)
  values
    (auth.uid(), 'soft_delete', 'chat_message', p_message_id, p_reason, v_before)
  returning id into v_log;

  return v_log;
end;
$$;

-- ---------------------------------------------------------------------
-- admin_soft_delete_question
-- ---------------------------------------------------------------------
create or replace function public.admin_soft_delete_question(
  p_question_id uuid,
  p_reason      text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_log    uuid;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  select to_jsonb(q) into v_before
  from public.questions q
  where q.id = p_question_id and q.deleted_at is null;
  if v_before is null then raise exception 'question_not_found_or_already_deleted'; end if;

  update public.questions
     set deleted_at = now(), deleted_by = auth.uid(), deleted_reason = p_reason
   where id = p_question_id;

  insert into public.moderation_log
    (actor_id, action, target_type, target_id, reason, before_state)
  values
    (auth.uid(), 'soft_delete', 'question', p_question_id, p_reason, v_before)
  returning id into v_log;

  return v_log;
end;
$$;

-- ---------------------------------------------------------------------
-- admin_soft_delete_party — logical cascade. Snapshots the party AND the
-- ids of the LIVE children it is about to take down (the manifest), then
-- soft-deletes children first, parent last. Restoring this log entry
-- revives ONLY those children (not ones deleted separately beforehand).
-- ---------------------------------------------------------------------
create or replace function public.admin_soft_delete_party(
  p_party_id uuid,
  p_reason   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before   jsonb;
  v_manifest jsonb;
  v_log      uuid;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  select to_jsonb(pa) into v_before
  from public.parties pa
  where pa.id = p_party_id and pa.deleted_at is null;
  if v_before is null then raise exception 'party_not_found_or_already_deleted'; end if;

  -- Soft-delete the LIVE children AND build the manifest from exactly the
  -- rows THIS statement transitioned (RETURNING) — not from a separate
  -- pre-snapshot SELECT. A child that another concurrent admin action
  -- already deleted is skipped by its `deleted_at is null` guard and never
  -- enters this manifest, so each soft-deleted child belongs to exactly
  -- one log/manifest and admin_restore() can't steal a child governed by
  -- another active deletion (FASE-0 review fix: manifest race).
  with del_comments as (
    update public.post_comments c
       set deleted_at = now(), deleted_by = auth.uid(), deleted_reason = p_reason
      from public.posts p
     where p.id = c.post_id and p.party_id = p_party_id and c.deleted_at is null
    returning c.id
  ),
  del_posts as (
    update public.posts
       set deleted_at = now(), deleted_by = auth.uid(), deleted_reason = p_reason
     where party_id = p_party_id and deleted_at is null
    returning id
  ),
  del_messages as (
    update public.chat_messages m
       set deleted_at = now(), deleted_by = auth.uid(), deleted_reason = p_reason
      from public.chat_rooms r
     where r.id = m.room_id and r.party_id = p_party_id and m.deleted_at is null
    returning m.id
  )
  select jsonb_build_object(
    'posts',    coalesce((select jsonb_agg(id) from del_posts),    '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(id) from del_comments), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(id) from del_messages), '[]'::jsonb)
  ) into v_manifest;

  -- Parent last.
  update public.parties
     set deleted_at = now(), deleted_by = auth.uid(), deleted_reason = p_reason
   where id = p_party_id;

  insert into public.moderation_log
    (actor_id, action, target_type, target_id, reason, before_state, manifest)
  values
    (auth.uid(), 'soft_delete', 'party', p_party_id, p_reason, v_before, v_manifest)
  returning id into v_log;

  return v_log;
end;
$$;

-- ---------------------------------------------------------------------
-- admin_restore — undo a soft_delete log entry. Single-use (guarded by
-- restored_at). For a party, revives the parent and only the children in
-- the manifest. Writes a second log row recording the restore.
-- ---------------------------------------------------------------------
create or replace function public.admin_restore(p_log_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log moderation_log%rowtype;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  select * into v_log from public.moderation_log where id = p_log_id;
  if v_log.id is null then raise exception 'log_not_found'; end if;
  if v_log.action <> 'soft_delete' then raise exception 'not_a_deletion'; end if;
  if v_log.restored_at is not null then raise exception 'already_restored'; end if;

  if v_log.target_type = 'post' then
    update public.posts set deleted_at = null, deleted_by = null, deleted_reason = null
     where id = v_log.target_id;

  elsif v_log.target_type = 'comment' then
    update public.post_comments set deleted_at = null, deleted_by = null, deleted_reason = null
     where id = v_log.target_id;

  elsif v_log.target_type = 'chat_message' then
    update public.chat_messages set deleted_at = null, deleted_by = null, deleted_reason = null
     where id = v_log.target_id;

  elsif v_log.target_type = 'question' then
    update public.questions set deleted_at = null, deleted_by = null, deleted_reason = null
     where id = v_log.target_id;

  elsif v_log.target_type = 'party' then
    update public.parties set deleted_at = null, deleted_by = null, deleted_reason = null
     where id = v_log.target_id;

    update public.posts set deleted_at = null, deleted_by = null, deleted_reason = null
     where id in (
       select (jsonb_array_elements_text(coalesce(v_log.manifest->'posts', '[]'::jsonb)))::uuid
     );
    update public.post_comments set deleted_at = null, deleted_by = null, deleted_reason = null
     where id in (
       select (jsonb_array_elements_text(coalesce(v_log.manifest->'comments', '[]'::jsonb)))::uuid
     );
    update public.chat_messages set deleted_at = null, deleted_by = null, deleted_reason = null
     where id in (
       select (jsonb_array_elements_text(coalesce(v_log.manifest->'messages', '[]'::jsonb)))::uuid
     );
  else
    raise exception 'unrestorable_target_type: %', v_log.target_type;
  end if;

  update public.moderation_log set restored_at = now() where id = p_log_id;

  insert into public.moderation_log
    (actor_id, action, target_type, target_id, reason)
  values
    (auth.uid(), 'restore', v_log.target_type, v_log.target_id,
     'restored log ' || p_log_id::text);
end;
$$;

-- ---------------------------------------------------------------------
-- Lock down: no anon/public execution; authenticated only (the body
-- re-checks is_admin, so non-admins get 'forbidden').
-- ---------------------------------------------------------------------
revoke execute on function public.admin_soft_delete_post(uuid, text)         from public, anon;
revoke execute on function public.admin_soft_delete_comment(uuid, text)      from public, anon;
revoke execute on function public.admin_soft_delete_chat_message(uuid, text) from public, anon;
revoke execute on function public.admin_soft_delete_question(uuid, text)     from public, anon;
revoke execute on function public.admin_soft_delete_party(uuid, text)        from public, anon;
revoke execute on function public.admin_restore(uuid)                        from public, anon;

grant execute on function public.admin_soft_delete_post(uuid, text)         to authenticated;
grant execute on function public.admin_soft_delete_comment(uuid, text)      to authenticated;
grant execute on function public.admin_soft_delete_chat_message(uuid, text) to authenticated;
grant execute on function public.admin_soft_delete_question(uuid, text)     to authenticated;
grant execute on function public.admin_soft_delete_party(uuid, text)        to authenticated;
grant execute on function public.admin_restore(uuid)                        to authenticated;

notify pgrst, 'reload schema';
