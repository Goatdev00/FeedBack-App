-- =====================================================================
-- FEEDBACK — Hotfix: rename user_role enum value 'promoter' → 'promotor'
-- Run this ONCE in Supabase SQL Editor. Idempotent (safe to re-run).
-- =====================================================================

-- 1. Rename the enum value (only if it's still in the English form).
do $$ begin
  if exists (
    select 1 from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'user_role' and e.enumlabel = 'promoter'
  ) then
    alter type public.user_role rename value 'promoter' to 'promotor';
  end if;
end $$;

-- 2. Recreate the parties_create policy: its literal was 'promoter'.
drop policy if exists parties_create on public.parties;
create policy parties_create on public.parties
  for insert to authenticated
  with check (
    (select role from public.profiles where id = auth.uid()) = 'promotor'
    and promoter_id = auth.uid()
  );
