-- =====================================================================
-- FEEDBACK — Strip oversized base64 images from the DB
-- =====================================================================
-- Root cause of the ~20s post-login freeze: avatars (and potentially
-- flyers / post photos) were stored as raw base64 data URIs straight from
-- the camera roll — a single avatar was ~12 MB of text in profiles.avatar_url.
--
-- Consequences observed in production:
--   * SELECT on profiles timed out server-side (statement timeout, 57014)
--     because Postgres had to encode megabytes of text into the JSON
--     response — so the wall could never finish hydrating.
--   * The same blob in the browser blew the localStorage quota and froze
--     the main thread on every JSON.stringify.
--
-- This migration nulls any image column whose value is a `data:` URI.
-- Real images live as short Storage URLs (or, post-fix, as small
-- downscaled JPEGs); a `data:`-prefixed value is always the bloated kind.
-- Users simply re-pick an avatar/flyer afterwards — the client now
-- downscales before upload (see src/utils/image.js).
--
-- posts/parties were already emptied by 0012, but we clean them too so a
-- re-applied seed or any straggler row can't reintroduce the problem.
-- =====================================================================

update public.profiles
set avatar_url = null
where avatar_url like 'data:%';

update public.parties
set flyer_url = null
where flyer_url like 'data:%';

update public.posts
set image_url = null
where image_url like 'data:%';
