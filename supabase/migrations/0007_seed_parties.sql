-- =====================================================================
-- FEEDBACK — Seed mock parties (Phase 3)
-- =====================================================================
-- The legacy localStorage mock had 5 parties + their mock posts/users.
-- For normalized cross-user persistence, we drop the mock POSTS/USERS
-- (real users will populate them through use) but keep the mock PARTIES
-- so the wall has something to attach posts to from day one.
--
-- promoter_id is NULL because the mock promoter (u3) was never a real
-- auth.users row; same for djs.
--
-- The party_id values here are stable UUIDs the frontend hard-codes in
-- src/data/mock-data.js so the two stay in sync.
-- =====================================================================

insert into public.parties
  (id, name, venue, city, party_date, start_time, end_time, genres,
   promoter_id, flyer_url, description, sponsored, status)
values
  ('a1111111-1111-4111-8111-111111111111',
   'NEXUS — Underground Session', 'Warehouse Club', 'Bogotá',
   current_date, '22:00', '06:00',
   array['Techno','Dark Techno'],
   null, null,
   'Una noche de techno puro en lo más profundo del underground bogotano.',
   false, 'upcoming'),

  ('a2222222-2222-4222-8222-222222222222',
   'PULSE — House & Disco', 'Terraza Nocturna', 'Bogotá',
   current_date, '21:00', '04:00',
   array['House','Disco','Deep House'],
   null, null,
   'La mejor selección de house y disco en la terraza más icónica de la ciudad.',
   true, 'upcoming'),

  ('a3333333-3333-4333-8333-333333333333',
   'BASS CATHEDRAL', 'Bodega 42', 'Bogotá',
   current_date, '23:00', '07:00',
   array['Drum & Bass','Jungle','Breakbeat'],
   null, null,
   'La catedral del bass te espera con los mejores DJs nacionales.',
   false, 'upcoming'),

  ('a4444444-4444-4444-8444-444444444444',
   'ECLIPSE — Melodic Techno', 'Club Astral', 'Medellín',
   current_date, '22:00', '05:00',
   array['Melodic Techno','Progressive'],
   null, null,
   'Viaje sonoro a través del melodic techno en el venue más premium de Medellín.',
   false, 'upcoming'),

  ('a5555555-5555-4555-8555-555555555555',
   'FREKVENCIA', 'La Factoría', 'Cali',
   current_date, '23:00', '06:00',
   array['Minimal','Tech House'],
   null, null,
   'Minimal vibes en el corazón de Cali.',
   false, 'upcoming')
on conflict (id) do nothing;
