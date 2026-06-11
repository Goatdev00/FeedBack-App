-- =====================================================================
-- FEEDBACK — Server-side size limits on base64 image columns
-- =====================================================================
-- AUDIT FINDING (jun-2026, crítico C3): the 256px/1280px downscale lives
-- ONLY in the client (utils/image.js). The columns are plain `text` with
-- no length check, so any authenticated user can bypass the client and
-- INSERT/UPDATE a 50 MB data-URL straight through PostgREST — one
-- poisoned row re-creates the statement-timeout (57014) incident that
-- already took the wall down once (see 0013_strip_base64_images.sql).
--
-- LIMITS (chars of the data-URL, base64 is ~4/3 of the binary size):
--   * profiles.avatar_url  ≤   150,000  (256px JPEG q0.82 ≈ 15-40 KB
--                                        → ~55 KB of base64; 150 K is
--                                        ~3x headroom)
--   * posts.image_url      ≤ 2,000,000  (fileToResizedDataURL caps the
--   * parties.flyer_url    ≤ 2,000,000   LONGER side at 1280px, so a
--                                        square source yields 1280×1280
--                                        = 1.64 Mpx; high-grain club
--                                        photos at q0.82 can reach
--                                        ~1.2-1.5 MB binary → ~1.6-2 M
--                                        base64. 2 M never rejects a
--                                        legit client upload but still
--                                        kills the multi-MB DoS vector)
--
-- These are interim guards for the base64 era. When uploads move to
-- Supabase Storage (Fase 1), tighten them to short-URL lengths and add
-- CHECK (image_url NOT LIKE 'data:%').
--
-- Idempotent: duplicate_object is swallowed so re-runs are no-ops. If a
-- pre-existing row violates a limit the ALTER fails loudly — that's
-- intentional (you want to know about the poisoned row, not skip it).
-- =====================================================================

do $$ begin
  alter table public.profiles
    add constraint profiles_avatar_url_max_len
    check (avatar_url is null or length(avatar_url) <= 150000);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.posts
    add constraint posts_image_url_max_len
    check (image_url is null or length(image_url) <= 2000000);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.parties
    add constraint parties_flyer_url_max_len
    check (flyer_url is null or length(flyer_url) <= 2000000);
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
