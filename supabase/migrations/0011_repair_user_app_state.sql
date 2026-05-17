-- =====================================================================
-- FEEDBACK — Repair user_app_state schema (Phase 3.7)
-- =====================================================================
-- Symptom in production:
--   42703 (Postgres):  column "state" of relation "user_app_state" does not exist
--   PGRST204 (PostgREST): "Could not find the 'state' column ... in the schema cache"
--
-- Root cause: an earlier attempt at migration 0006 created the table
-- without the `state` column (or with a renamed variant), and a later
-- run of 0006 was a no-op because `create table if not exists` doesn't
-- backfill missing columns.
--
-- This migration is idempotent and defensive: ALTER TABLE ... ADD COLUMN
-- IF NOT EXISTS will only act when the column is missing, leaving a
-- correctly-provisioned table untouched.
-- =====================================================================

-- Make sure the table itself exists. If 0006 was never applied, this
-- creates it from scratch.
create table if not exists public.user_app_state (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  state        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

-- Add any of the three columns if they're missing (catches the partial
-- 0006 case where the table exists but the JSONB column is absent).
alter table public.user_app_state add column if not exists state jsonb not null default '{}'::jsonb;
alter table public.user_app_state add column if not exists updated_at timestamptz not null default now();

-- Re-assert RLS — `if not exists` is fine on policies thanks to the
-- drop-if-exists pattern from 0006. Keep here as a self-contained fix:
-- if someone runs ONLY this migration on a fresh DB, they still end up
-- with the right policies.
alter table public.user_app_state enable row level security;

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

-- Make sure PostgREST's schema cache picks up the new column right away
-- (otherwise the next request can still get a stale "column not found").
notify pgrst, 'reload schema';
