-- =====================================================================
-- FEEDBACK — Realtime publication setup (Phase 1)
-- Tables exposed via supabase_realtime are broadcast via Postgres CDC
-- to subscribed clients. Keep this list intentional — every table here
-- pays a write-time cost.
-- =====================================================================

-- The supabase_realtime publication is created automatically by Supabase.
-- We just add (or replace) the table list to it.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.live_ratings;
alter publication supabase_realtime add table public.parties;
alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.post_likes;
alter publication supabase_realtime add table public.post_comments;
alter publication supabase_realtime add table public.party_attendees;
