-- =====================================================================
-- FEEDBACK — Diagnóstico de estado de la DB
-- Pégalo en Supabase Studio → SQL Editor → Run.
-- Te dice qué objetos ya existen para saber si hubo migración parcial.
-- =====================================================================

select 'EXTENSIONS' as section,
       extname as name,
       'installed' as status
from pg_extension
where extname in ('pgcrypto', 'citext', 'pg_cron')
union all
select 'ENUMS',
       typname,
       'created'
from pg_type
where typname in (
  'user_role', 'membership_tier', 'membership_status',
  'transaction_status', 'billing_cycle', 'party_status',
  'rating_factor', 'chat_room_type', 'message_status'
) and typtype = 'e'
union all
select 'TABLES',
       tablename,
       case when rowsecurity then 'rls_on' else 'rls_off' end
from pg_tables
where schemaname = 'public'
  and tablename in (
    'profiles','parties','party_djs','party_attendees','posts',
    'post_likes','post_comments','questions','follows','live_ratings',
    'memberships','membership_transactions','chat_rooms','chat_messages','chat_mutes'
  )
union all
select 'FUNCTIONS',
       p.proname,
       'created'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'current_tier','tier_weight','is_party_host','posts_today',
    'handle_new_user','create_party_chat_rooms','snapshot_message_meta',
    'snapshot_rating_weight','activate_membership','cancel_membership',
    'expire_memberships','dev_mock_activate_membership','dev_mock_cancel_membership'
  )
union all
select 'COLUMNS',
       table_name || '.' || column_name,
       'present'
from information_schema.columns
where table_schema = 'public'
  and column_name = 'onboarding_complete'
order by 1, 2;
