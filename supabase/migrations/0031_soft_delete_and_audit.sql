-- =====================================================================
-- FEEDBACK — Soft-delete tuple + moderation audit log (FASE 0)
-- =====================================================================
-- The admin can delete any party / post / comment / chat message /
-- question, and later RESTORE it. That requires two things this
-- migration adds:
--
--   1. A soft-delete tuple (deleted_at / deleted_by / deleted_reason) on
--      every moderatable table. NULL deleted_at = live. NOT NULL = gone
--      from the app (the read policies in 0032 filter on it). The row
--      survives in the DB so it can be restored or audited.
--
--   2. moderation_log — an append-only ledger. Every admin action writes
--      one row carrying a JSON snapshot (before_state) so the trash view
--      can preview what was removed and admin_restore() can put it back.
--      For a party deletion, `manifest` records exactly which CHILD rows
--      THIS action soft-deleted, so restoring the party only revives the
--      children it took down — never something that was already deleted
--      separately.
--
-- WHY SOFT-DELETE AND NOT raw DELETE:
--   Every FK here is ON DELETE CASCADE (0001). A physical DELETE of a
--   party would silently wipe its posts, comments, likes, chat and
--   ratings with no audit trail and no way back. The admin path must
--   only ever set deleted_at. Physical purge ("empty trash") is a
--   separate, explicit, logged action added later.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Soft-delete columns. deleted_by → profiles (SET NULL: keep the audit
-- row even if the admin account is later removed).
-- ---------------------------------------------------------------------
alter table public.parties
  add column if not exists deleted_at     timestamptz,
  add column if not exists deleted_by     uuid references public.profiles(id) on delete set null,
  add column if not exists deleted_reason text;

alter table public.posts
  add column if not exists deleted_at     timestamptz,
  add column if not exists deleted_by     uuid references public.profiles(id) on delete set null,
  add column if not exists deleted_reason text;

alter table public.post_comments
  add column if not exists deleted_at     timestamptz,
  add column if not exists deleted_by     uuid references public.profiles(id) on delete set null,
  add column if not exists deleted_reason text;

alter table public.chat_messages
  add column if not exists deleted_at     timestamptz,
  add column if not exists deleted_by     uuid references public.profiles(id) on delete set null,
  add column if not exists deleted_reason text;

alter table public.questions
  add column if not exists deleted_at     timestamptz,
  add column if not exists deleted_by     uuid references public.profiles(id) on delete set null,
  add column if not exists deleted_reason text;

-- Partial indexes: the read policies filter `deleted_at is null` on the
-- hot path; index only the (rare) deleted rows the trash view scans.
create index if not exists parties_deleted_idx       on public.parties(deleted_at)       where deleted_at is not null;
create index if not exists posts_deleted_idx          on public.posts(deleted_at)          where deleted_at is not null;
create index if not exists post_comments_deleted_idx  on public.post_comments(deleted_at)  where deleted_at is not null;
create index if not exists chat_messages_deleted_idx  on public.chat_messages(deleted_at)  where deleted_at is not null;
create index if not exists questions_deleted_idx      on public.questions(deleted_at)      where deleted_at is not null;

-- ---------------------------------------------------------------------
-- moderation_log — append-only audit + restore ledger.
--   action       — 'soft_delete' | 'restore' | 'set_role' |
--                   'set_moderation' | 'anonymize' | 'hard_delete' ...
--   target_type  — 'party' | 'post' | 'comment' | 'chat_message' |
--                   'question' | 'user'
--   before_state — to_jsonb(row) captured BEFORE the mutation.
--   manifest     — party cascades: { posts:[...], comments:[...],
--                  messages:[...] } of child ids this action took down.
--   restored_at  — set when admin_restore() consumes this row (a log
--                  entry can only be restored once).
-- ---------------------------------------------------------------------
create table if not exists public.moderation_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.profiles(id) on delete set null,
  action       text not null,
  target_type  text not null,
  target_id    uuid not null,
  reason       text,
  before_state jsonb,
  manifest     jsonb,
  created_at   timestamptz not null default now(),
  restored_at  timestamptz
);

create index if not exists moderation_log_target_idx  on public.moderation_log(target_type, target_id);
create index if not exists moderation_log_created_idx on public.moderation_log(created_at desc);
create index if not exists moderation_log_actor_idx   on public.moderation_log(actor_id);

-- RLS: only admins may READ the log. NO insert/update/delete policies —
-- every write goes through the SECURITY DEFINER admin_* RPCs (0033),
-- which run as the owner and bypass RLS. This keeps the ledger
-- tamper-proof: a client can neither forge nor erase an entry.
alter table public.moderation_log enable row level security;

drop policy if exists moderation_log_read_admin on public.moderation_log;
create policy moderation_log_read_admin on public.moderation_log
  for select to authenticated
  using (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------
-- FREEZE the soft-delete tuple against non-admin UPDATEs (FASE-0
-- adversarial-review fix — closes the self-restore holes).
--
-- WHY A TRIGGER AND NOT a WITH CHECK on each UPDATE policy:
--   Adding deleted_at to a freeze is what we'd normally do (see 0030),
--   BUT three pre-existing client UPDATE policies leave the soft-delete
--   columns wide open, and one of them can't be fixed by WITH CHECK:
--     * posts_update_owner  (0003) — using/with check (user_id = auth.uid())
--     * questions_answer     (0017) — target can answer their questions
--     * messages_moderate    (0003) — party hosts, WITH CHECK (true) (!)
--   messages_moderate's `with check (true)` lets a host change ANY column
--   including deleted_at, and WITH CHECK cannot reference OLD, so no
--   policy rewrite can pin the column to its prior value. A BEFORE UPDATE
--   trigger is the only construct that sees OLD and works uniformly.
--
-- The trigger forces deleted_at/deleted_by/deleted_reason back to their
-- OLD values for any caller that is NOT an admin (silently — the rest of
-- the UPDATE still applies, the tampering is just ignored).
--   * admin_* RPCs (0033) are SECURITY DEFINER but auth.uid() inside them
--     is still the calling admin, so is_admin(auth.uid()) is true and
--     their legitimate soft-delete / restore writes pass through.
--   * auth.uid() IS NULL covers service_role + the SQL editor (no JWT
--     user) — trusted server contexts that may need to touch the tuple.
--   * Authenticated end-users (the only threat here) always have a
--     non-null auth.uid() and are not admins → frozen.
-- Attached to all five soft-deletable tables so a future client UPDATE
-- policy can never reopen the hole.
-- ---------------------------------------------------------------------
create or replace function public.freeze_soft_delete_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin(auth.uid()) or auth.uid() is null then
    return new;  -- admin RPC / service_role / SQL editor: allow.
  end if;
  -- non-admin authenticated user: pin the soft-delete tuple to OLD.
  new.deleted_at     := old.deleted_at;
  new.deleted_by     := old.deleted_by;
  new.deleted_reason := old.deleted_reason;
  return new;
end;
$$;

drop trigger if exists before_update_freeze_soft_delete on public.parties;
create trigger before_update_freeze_soft_delete
  before update on public.parties
  for each row execute function public.freeze_soft_delete_columns();

drop trigger if exists before_update_freeze_soft_delete on public.posts;
create trigger before_update_freeze_soft_delete
  before update on public.posts
  for each row execute function public.freeze_soft_delete_columns();

drop trigger if exists before_update_freeze_soft_delete on public.post_comments;
create trigger before_update_freeze_soft_delete
  before update on public.post_comments
  for each row execute function public.freeze_soft_delete_columns();

drop trigger if exists before_update_freeze_soft_delete on public.chat_messages;
create trigger before_update_freeze_soft_delete
  before update on public.chat_messages
  for each row execute function public.freeze_soft_delete_columns();

drop trigger if exists before_update_freeze_soft_delete on public.questions;
create trigger before_update_freeze_soft_delete
  before update on public.questions
  for each row execute function public.freeze_soft_delete_columns();

notify pgrst, 'reload schema';
