-- =====================================================================
-- FEEDBACK — Post abuse reports (real moderation flow)
-- =====================================================================
-- Until now the "Reportar" button on posts only fired a placebo toast.
-- This migration wires a real report flow:
--
--   * Users tap report → pick a reason → server records it.
--   * One report per (post, reporter) — uniqueness enforced by PK.
--   * When a post hits 10 reports it's auto-hidden:
--       posts.hidden_at = now()
--       posts.hidden_reason = 'reports_threshold'
--     and every reporter receives +10 points (validatedReport rule).
--   * RLS hides those posts from everyone EXCEPT the author, so the
--     author can still see what was reported (and the frontend overlays
--     a "blocked by reports" banner on them).
--   * The "your post was blocked" notification is derived client-side
--     from posts.hidden_at — no separate notifications table needed.
--
-- All writes go through public.report_post() (SECURITY DEFINER) so
-- clients can never mutate post_reports / posts.hidden_at directly.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enum of report reasons. Add more later by ALTER TYPE ... ADD VALUE.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'report_reason') then
    create type public.report_reason as enum (
      'spam',
      'offensive',
      'misinformation',
      'self_promotion',
      'harassment',
      'other'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------
-- post_reports table — one row per (post, reporter).
-- ---------------------------------------------------------------------
create table if not exists public.post_reports (
  post_id     uuid not null references public.posts(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason      public.report_reason not null,
  created_at  timestamptz not null default now(),
  primary key (post_id, reporter_id)
);
create index if not exists post_reports_post_idx on public.post_reports(post_id);

-- ---------------------------------------------------------------------
-- Soft-delete columns on posts. NULL = visible to everyone with RLS read
-- access. NOT NULL = hidden (visible only to the author, per the policy
-- below).
-- ---------------------------------------------------------------------
alter table public.posts
  add column if not exists hidden_at     timestamptz,
  add column if not exists hidden_reason text;

create index if not exists posts_hidden_idx on public.posts(hidden_at);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.post_reports enable row level security;

-- Only the reporter sees their own report rows (so users can't tell who
-- reported them). Aggregate counts are exposed only through the
-- SECURITY DEFINER function below.
drop policy if exists post_reports_read_self on public.post_reports;
create policy post_reports_read_self on public.post_reports
  for select to authenticated
  using (reporter_id = auth.uid());

-- No client-side INSERT/UPDATE/DELETE policies on post_reports.
-- Everything goes through public.report_post() so the threshold +
-- hiding + points logic stays atomic and tamper-proof.

-- Update posts_read so hidden posts disappear for everyone except the
-- author (the rest of the original policy — expires_at > now() —
-- carries over).
drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts
  for select to authenticated
  using (
    expires_at > now()
    and (hidden_at is null or user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- The one public RPC clients call to report a post. Returns:
--   { count: int, hidden: boolean, threshold: int }
-- so the frontend can show the user how close they were to triggering
-- the auto-hide.
-- ---------------------------------------------------------------------
create or replace function public.report_post(
  p_post_id uuid,
  p_reason  public.report_reason
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count      int;
  v_author     uuid;
  v_was_hidden boolean := false;
  v_threshold  int := 10;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- Verify the post exists (and grab its author so we can block self-reports).
  select user_id into v_author from public.posts where id = p_post_id;
  if v_author is null then
    raise exception 'post_not_found';
  end if;
  if v_author = auth.uid() then
    raise exception 'cannot_report_own_post';
  end if;

  -- Idempotent: re-submitting the same (post, reporter) is a no-op.
  -- The PK conflict path silently swallows duplicates so the user just
  -- sees the latest count without an error.
  insert into public.post_reports (post_id, reporter_id, reason)
  values (p_post_id, auth.uid(), p_reason)
  on conflict (post_id, reporter_id) do nothing;

  select count(*) into v_count
  from public.post_reports
  where post_id = p_post_id;

  -- Auto-hide at threshold. The UPDATE is guarded so we only award
  -- points the FIRST time the post crosses the line — re-reports after
  -- hiding don't double-pay.
  if v_count >= v_threshold then
    update public.posts
    set hidden_at = now(),
        hidden_reason = 'reports_threshold'
    where id = p_post_id
      and hidden_at is null;

    if FOUND then
      v_was_hidden := true;

      -- Award +10 points to every reporter that helped validate this
      -- post. This implements POINTS_RULES.validatedReport (+10 pts).
      -- Daily limit (originally 3/day in the spec) is intentionally not
      -- enforced here; we can add it later by tracking awarded=true on
      -- each post_reports row.
      update public.profiles
      set points = points + 10
      where id in (
        select reporter_id
        from public.post_reports
        where post_id = p_post_id
      );
    end if;
  end if;

  return jsonb_build_object(
    'count', v_count,
    'hidden', v_was_hidden,
    'threshold', v_threshold
  );
end;
$$;

revoke execute on function public.report_post(uuid, public.report_reason) from public, anon;
grant  execute on function public.report_post(uuid, public.report_reason) to authenticated;

-- ---------------------------------------------------------------------
-- Realtime: expose post_reports so a future moderator dashboard can
-- watch reports live. Idempotent like 0009.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'post_reports'
  ) then
    alter publication supabase_realtime add table public.post_reports;
  end if;
end $$;
