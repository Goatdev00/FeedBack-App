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
