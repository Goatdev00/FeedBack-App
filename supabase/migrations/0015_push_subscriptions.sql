-- =====================================================================
-- FEEDBACK / PartyRate — Web Push subscriptions
-- =====================================================================
-- One row per (user, device endpoint). A single user can have many
-- subscriptions (móvil + escritorio + PWA), so the PK is `id`, NOT
-- `user_id`. `endpoint` carries the unique key — it's what
-- PushManager.subscribe() returns per browser instance and what we use
-- to drop a stale row on 404/410 from the push service.
--
-- `subscription` keeps the full PushSubscription JSON (including the
-- keys.p256dh / keys.auth that web-push needs to encrypt the payload),
-- so the Edge Function can hand it straight to webpush.sendNotification.
-- =====================================================================

create table if not exists public.push_subscriptions (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  endpoint     text        not null unique,
  subscription jsonb       not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions(user_id);

-- ---------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------
create or replace function public.touch_push_subscriptions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists push_subscriptions_touch on public.push_subscriptions;
create trigger push_subscriptions_touch
  before update on public.push_subscriptions
  for each row execute function public.touch_push_subscriptions_updated_at();

-- ---------------------------------------------------------------------
-- RLS — every user only manages their own subscriptions.
-- The Edge Function uses the service role key, which bypasses RLS, so
-- no extra policy is needed for server-side reads/deletes.
-- ---------------------------------------------------------------------
alter table public.push_subscriptions enable row level security;

drop policy if exists push_sub_select_own on public.push_subscriptions;
create policy push_sub_select_own on public.push_subscriptions
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists push_sub_insert_own on public.push_subscriptions;
create policy push_sub_insert_own on public.push_subscriptions
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists push_sub_update_own on public.push_subscriptions;
create policy push_sub_update_own on public.push_subscriptions
  for update to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists push_sub_delete_own on public.push_subscriptions;
create policy push_sub_delete_own on public.push_subscriptions
  for delete to authenticated
  using (user_id = auth.uid());
