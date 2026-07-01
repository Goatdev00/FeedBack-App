-- =====================================================================
-- FEEDBACK — admin_broadcasts: sent-notification history (FASE 2)
-- =====================================================================
-- The SUPERUSUARIO "Notificaciones" tab sends push/email broadcasts via
-- the admin-broadcast Edge Function, but nothing recorded what was sent.
-- This table is that record: one row per REAL send (dry-run reach checks
-- are not stored). The tab renders it under "Historial de notificaciones".
--
-- WRITE PATH: only the admin-broadcast Edge Function, running with the
-- SERVICE ROLE, inserts here (service_role bypasses RLS). There is
-- deliberately NO insert/update/delete policy, so an authenticated client
-- can neither forge nor edit history — same tamper-proof shape as
-- moderation_log (0031).
--
-- READ PATH: admins only. A non-admin's SELECT returns zero rows (the
-- policy predicate is false), so listAdminBroadcasts() is safe to call
-- from the already-gated admin page.
-- =====================================================================

create table if not exists public.admin_broadcasts (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.profiles(id) on delete set null,
  title        text not null,
  body         text not null,
  url          text,
  channels     jsonb not null default '{}'::jsonb,   -- { push:bool, email:bool }
  target_type  text not null,                         -- all|role|city|party|user
  target_count int  not null default 0,               -- recipients resolved
  push_sent    int  not null default 0,
  email_sent   int  not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists admin_broadcasts_created_idx on public.admin_broadcasts(created_at desc);

-- RLS: admin-only read; no client writes (service_role inserts bypass RLS).
alter table public.admin_broadcasts enable row level security;

drop policy if exists admin_broadcasts_read_admin on public.admin_broadcasts;
create policy admin_broadcasts_read_admin on public.admin_broadcasts
  for select to authenticated
  using (public.is_admin(auth.uid()));

notify pgrst, 'reload schema';
