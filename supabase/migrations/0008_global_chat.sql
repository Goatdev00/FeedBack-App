-- =====================================================================
-- FEEDBACK — Global chat party (Phase 3.5)
-- =====================================================================
-- The general live chat needs a `chat_rooms` row but our schema requires
-- party_id NOT NULL. Cheapest workaround: a synthetic "global" party row
-- with a known UUID that the frontend filters out of the parties list.
-- The trigger create_party_chat_rooms() then creates the public chat
-- room for it automatically.
-- =====================================================================

insert into public.parties
  (id, name, venue, city, party_date, start_time, end_time, genres,
   promoter_id, flyer_url, description, sponsored, status)
values
  ('ffffffff-ffff-4fff-8fff-ffffffffffff',
   'Chat General', 'Toda la escena', '—',
   current_date, '00:00', '23:59',
   array[]::text[],
   null, null,
   'Chat general de la escena — habla con todos en tiempo real.',
   false, 'live')
on conflict (id) do nothing;
