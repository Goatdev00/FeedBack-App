-- =====================================================================
-- FEEDBACK — Wipe all user-generated content (pre-launch reset)
-- =====================================================================
-- The app went through several rounds of testing with mock parties and
-- mock posts. Before sharing the link with the first real users, we
-- wipe the slate clean so they don't see legacy test data on day one.
--
-- What gets wiped (parties first; the FK cascades do the heavy lifting):
--   * parties                       (incl. the 5 seeds from 0007)
--     └─ posts                      (party_id NOT NULL → cascade)
--         ├─ post_likes
--         └─ post_comments
--     └─ party_djs
--     └─ party_attendees
--     └─ party_ratings
--     └─ party_questions  ← and its post_question_likes / post_question_replies via further cascades
--     └─ chat_rooms (party-bound) → chat_messages (via room_id cascade)
--
--   * chat_messages in the GLOBAL room — not covered by the cascade
--     above because that room's party_id IS NULL, so the room itself
--     survives. We just empty its history.
--
-- What we KEEP:
--   * profiles                — users stay signed in, points/tier intact
--   * follows                 — social graph survives
--   * user_app_state          — per-user preferences (theme, etc.)
--   * the global chat_room    — same row, fresh history
--   * RLS policies, triggers, indexes
--
-- Run with the service-role / SQL editor. After this, the wall, agenda
-- of parties and global chat all show empty until users create content.
-- =====================================================================

-- Wipe every party (cascade does the rest).
delete from public.parties;

-- Empty the global chat. The room row stays so resolveChatRoomId('general')
-- still works without re-running the seeder.
delete from public.chat_messages
where room_id in (
  select id from public.chat_rooms where party_id is null
);

-- Defensive: in the unlikely event somebody is mid-write while this runs,
-- truncate-style safety on the materialized rollups would go here. We
-- have none yet, so nothing else to clean.
