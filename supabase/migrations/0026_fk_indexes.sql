-- =====================================================================
-- FEEDBACK — Missing indexes on FK / RLS-predicate columns
-- =====================================================================
-- AUDIT FINDING (jun-2026, importante): Postgres does NOT auto-index the
-- referencing side of a foreign key. These four columns are scanned by
-- ON DELETE CASCADE (every account deletion walks post_likes and
-- post_comments looking for the user's rows) and by RLS predicates
-- (questions_read includes `asker_id = auth.uid()` with no index
-- support). Invisible today; with millions of likes each user deletion
-- becomes a multi-second seq scan.
--
-- Plain CREATE INDEX (not CONCURRENTLY): supabase db push wraps each
-- migration in a transaction, and the tables are tiny pre-launch.
-- =====================================================================

create index if not exists post_likes_user_idx    on public.post_likes(user_id);
create index if not exists post_comments_user_idx on public.post_comments(user_id);
create index if not exists questions_asker_idx    on public.questions(asker_id);
create index if not exists chat_mutes_muted_by_idx on public.chat_mutes(muted_by);
