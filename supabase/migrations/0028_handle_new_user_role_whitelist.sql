-- =====================================================================
-- FEEDBACK — handle_new_user: whitelist the signup role
-- =====================================================================
-- BYPASS FOUND BY THE FASE-0 ADVERSARIAL REVIEW (cierra de verdad el
-- crítico C2): 0023 froze `role` in the UPDATE policy, but profile rows
-- are CREATED by this SECURITY DEFINER trigger, which read the role
-- straight from the signup metadata (0002:91):
--
--   v_role := coalesce((new.raw_user_meta_data->>'role')::user_role, 'raver');
--
-- Any attacker with the public anon key could self-issue 'promotor' at
-- signup — no session needed beforehand:
--
--   supabase.auth.signInWithOtp({ email,
--     options: { data: { role: 'promotor' } } })
--
-- ...and parties_create / is_party_host / mutes_manage_host would all
-- treat them as a verified promoter.
--
-- FIX: the trigger now accepts only the SELF-SERVICE roles ('raver',
-- 'dj') from metadata; anything else — including 'promotor' and any
-- invalid string (which previously made the ::user_role cast blow up
-- the whole signup) — falls back to 'raver'. 'promotor' is issued
-- exclusively server-side (dashboard / future admin RPC), matching what
-- the onboarding UI already promises with its locked card.
--
-- Side benefit: the old unguarded cast made the INSERT into auth.users
-- abort with an opaque 500 if metadata carried a non-enum role string;
-- the CASE below makes the trigger total.
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username citext;
  v_name     text;
  v_role     user_role;
  v_city     text;
begin
  v_username := coalesce(
    nullif(new.raw_user_meta_data->>'username', '')::citext,
    ('@user_' || substr(new.id::text, 1, 8))::citext
  );
  v_name := coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1));

  -- Whitelist: metadata may only choose the self-service roles. Every
  -- other value (promotor, garbage, absent) lands on 'raver'. Promotor
  -- is granted manually by the team, never at signup.
  v_role := case new.raw_user_meta_data->>'role'
    when 'raver' then 'raver'::user_role
    when 'dj'    then 'dj'::user_role
    else 'raver'::user_role
  end;

  v_city := coalesce(nullif(new.raw_user_meta_data->>'city', ''), 'Bogotá');

  insert into public.profiles (id, username, name, role, city, avatar_url)
  values (
    new.id,
    v_username,
    v_name,
    v_role,
    v_city,
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- The trigger from 0002 already points at this function name; replacing
-- the body is enough. Re-assert it anyway so this migration is
-- self-sufficient on a fresh database.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
