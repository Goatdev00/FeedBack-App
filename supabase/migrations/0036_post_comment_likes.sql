-- =====================================================================
-- FEEDBACK — Likes on comments (post_comment_likes)
-- =====================================================================
-- Mirror of public.post_likes (0001/0003) but for a comment instead of a
-- post: one row per (comment, user). ON DELETE CASCADE from both parents
-- so deleting a comment or a profile cleans up its likes. Same open-read /
-- own-write RLS shape as post_likes — a like is public (drives the count +
-- "liked by me" state) and a user may only add/remove their own.
-- =====================================================================

create table if not exists public.post_comment_likes (
  comment_id  uuid not null references public.post_comments(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists post_comment_likes_comment_idx on public.post_comment_likes(comment_id);
create index if not exists post_comment_likes_user_idx    on public.post_comment_likes(user_id);

alter table public.post_comment_likes enable row level security;

-- Read: any authenticated user (count + liked-by-me), same as post_likes.
drop policy if exists comment_likes_read on public.post_comment_likes;
create policy comment_likes_read on public.post_comment_likes
  for select to authenticated using (true);

-- Insert: only your own like.
drop policy if exists comment_likes_like on public.post_comment_likes;
create policy comment_likes_like on public.post_comment_likes
  for insert to authenticated
  with check (user_id = auth.uid());

-- Delete: only your own like (unlike).
drop policy if exists comment_likes_unlike on public.post_comment_likes;
create policy comment_likes_unlike on public.post_comment_likes
  for delete to authenticated
  using (user_id = auth.uid());

notify pgrst, 'reload schema';
