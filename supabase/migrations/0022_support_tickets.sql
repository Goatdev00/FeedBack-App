-- =====================================================================
-- FEEDBACK — Support tickets ("Habla con soporte")
-- =====================================================================
-- A user can report a bug or send a request from Profile → Configuración
-- → "Habla con soporte". The form (name / email / message) inserts one
-- row here. The team reads and triages tickets from the Supabase
-- dashboard or via the service_role key — both bypass RLS.
--
-- Write-only from the app: signed-in users may INSERT their own ticket
-- and nothing else. There is deliberately NO select/update/delete policy
-- for `authenticated`, so no client can read other people's tickets (or
-- even their own back). `status` is an admin-managed field (open/closed/
-- in_progress, free text) flipped from the dashboard.
-- =====================================================================

create table if not exists public.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  -- on delete set null: keep the ticket for the record even if the user
  -- later deletes their account.
  user_id     uuid references public.profiles(id) on delete set null,
  name        text not null check (char_length(name)    between 1 and 80),
  email       text not null check (char_length(email)   between 3 and 160),
  message     text not null check (char_length(message) between 1 and 2000),
  status      text not null default 'open',
  created_at  timestamptz not null default now()
);

create index if not exists support_tickets_created_idx
  on public.support_tickets(created_at desc);
create index if not exists support_tickets_status_idx
  on public.support_tickets(status);

alter table public.support_tickets enable row level security;

-- INSERT only, and the row must be stamped with the caller's own id so a
-- client can't forge tickets as someone else.
drop policy if exists support_tickets_insert on public.support_tickets;
create policy support_tickets_insert on public.support_tickets
  for insert to authenticated
  with check (user_id = auth.uid());

-- (No SELECT/UPDATE/DELETE policies on purpose — see header.)

-- Flush PostgREST's schema cache so the new table is insertable on the
-- next request instead of after the cache TTL.
notify pgrst, 'reload schema';
