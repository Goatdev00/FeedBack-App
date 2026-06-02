-- =====================================================================
-- FEEDBACK — Anonymous Q&A (real cross-device storage)
-- =====================================================================
-- Up to this migration, questions lived in localStorage only — meaning
-- a question Bob asked Alice never reached Alice's device. This
-- migration creates a proper questions table so the Q&A loop closes:
--
--   * Bob asks → INSERT into questions.
--   * Alice (the target) receives a realtime push, sees a notification.
--   * Alice taps the notification → her own profile, Questions tab.
--   * Alice answers → UPDATE the row with `answer` + `answered_at`.
--   * Bob can see his question got answered (RLS lets askers read their
--     own rows even when not answered).
--   * Any authenticated user visiting Alice's profile sees her ANSWERED
--     questions in the Questions tab (answered Q&A is public; unanswered
--     stays private to Alice and the asker).
--
-- The identity of the asker is stored (asker_id) so the asker can find
-- their own questions, but the UI always renders the question as
-- "Anónimo" — the frontend never exposes asker_id of someone else's
-- question. RLS makes sure no client query can leak the asker_id of a
-- question they didn't write themselves.
--
-- ---------------------------------------------------------------------
-- LEGACY-SCHEMA CLEANUP — idempotent
-- ---------------------------------------------------------------------
-- Migration 0001 already created a `public.questions` table with a
-- different schema (column `target_user_id`, nullable `asker_id`,
-- `select using (true)` RLS that leaked asker_id of anonymous askers).
-- That old table never had a working JS path — addQuestion only wrote
-- to localStorage — so there are no production rows to preserve.
-- We detect the legacy schema by looking for the old column name and
-- drop ONLY in that case, so re-running this migration once the new
-- table is in place is a no-op (no data loss).
-- CASCADE removes the obsolete RLS policies in 0003 that depended on
-- the old table.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'questions'
      and column_name  = 'target_user_id'
  ) then
    drop table public.questions cascade;
  end if;
end $$;

create table if not exists public.questions (
  id          uuid primary key default gen_random_uuid(),
  target_id   uuid not null references public.profiles(id) on delete cascade,
  asker_id    uuid not null references public.profiles(id) on delete cascade,
  question    text not null check (char_length(question) between 1 and 500),
  answer      text          check (answer is null or char_length(answer) between 1 and 1000),
  created_at  timestamptz not null default now(),
  answered_at timestamptz
);

create index if not exists questions_target_idx
  on public.questions(target_id, created_at desc);
create index if not exists questions_answered_idx
  on public.questions(target_id, answered_at desc)
  where answered_at is not null;

alter table public.questions enable row level security;

-- ---------------------------------------------------------------------
-- READ policy.
--   * target_id = auth.uid()  → you can read every question made to you,
--                               answered or not (you need pending ones
--                               to answer them).
--   * asker_id  = auth.uid()  → you can read your own asked questions,
--                               so the UI can show you whether they were
--                               answered.
--   * answer is not null      → anyone (authenticated) can read ANSWERED
--                               questions. Profile pages render
--                               answered Q&A publicly.
-- ---------------------------------------------------------------------
drop policy if exists questions_read on public.questions;
create policy questions_read on public.questions
  for select to authenticated
  using (
    target_id = auth.uid()
    or asker_id = auth.uid()
    or answer is not null
  );

-- ---------------------------------------------------------------------
-- INSERT policy: any signed-in user may ask anybody EXCEPT themselves.
-- The asker_id MUST match auth.uid() so a malicious client can't
-- impersonate someone else.
-- ---------------------------------------------------------------------
drop policy if exists questions_create on public.questions;
create policy questions_create on public.questions
  for insert to authenticated
  with check (asker_id = auth.uid() and target_id <> auth.uid());

-- ---------------------------------------------------------------------
-- UPDATE policy: only the target may answer. with-check identical to
-- using so a client can't sneak in a target_id change.
-- ---------------------------------------------------------------------
drop policy if exists questions_answer on public.questions;
create policy questions_answer on public.questions
  for update to authenticated
  using (target_id = auth.uid())
  with check (target_id = auth.uid());

-- ---------------------------------------------------------------------
-- DELETE policy: target can delete (in case they want to remove a
-- harassing question that doesn't warrant a report). Askers cannot
-- delete their own questions after sending.
-- ---------------------------------------------------------------------
drop policy if exists questions_delete on public.questions;
create policy questions_delete on public.questions
  for delete to authenticated
  using (target_id = auth.uid());

-- ---------------------------------------------------------------------
-- Realtime: targets need to know about new questions instantly, and
-- askers want to see when their question gets answered without a refresh.
-- Idempotent same as 0009.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'questions'
  ) then
    alter publication supabase_realtime add table public.questions;
  end if;
end $$;
