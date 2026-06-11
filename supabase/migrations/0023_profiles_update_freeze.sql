-- =====================================================================
-- FEEDBACK — Freeze server-controlled columns in profiles_update_self
-- =====================================================================
-- AUDIT FINDING (jun-2026, crítico C2): the previous policy (0003) only
-- froze membership_tier. Any authenticated user could run, from the
-- browser console:
--
--   supabase.from('profiles').update({ role: 'promotor' }).eq('id', uid)
--   supabase.from('profiles').update({ points: 999999 }).eq('id', uid)
--
-- ...self-verifying as a promotor (parties_create reads profiles.role)
-- or minting unlimited points, bypassing the ±100 cap in award_points().
--
-- WHAT THIS POLICY FREEZES (column must keep its current value):
--   * membership_tier         — flips only via activate_membership()
--                               (service_role), same as before.
--   * points                  — changes only via the SECURITY DEFINER
--                               RPCs award_points() / report_post(),
--                               which run as the function owner and are
--                               not subject to this policy.
--   * membership_active_until — service_role only. Compared with
--                               IS NOT DISTINCT FROM because it is
--                               nullable (NULL = NULL is NULL, which
--                               would wrongly reject no-op updates).
--
-- WHAT STAYS CLIENT-WRITABLE:
--   * role — BUT only the self-service values. Onboarding legitimately
--     patches role (onboarding.js step 2 → patchProfile({ role })), so a
--     full freeze would break signup. The carve-out allows keeping the
--     current role or setting 'raver'/'dj'; 'promotor' can only be kept
--     if you already have it (issued manually by the team, the client
--     shows it locked — onboarding.js role-locked card).
--   * name / username / city / bio / avatar_url / social / theme /
--     onboarding_complete — normal profile self-service.
--
-- The subselects read the row's CURRENT (pre-update) values: inside an
-- UPDATE statement they evaluate against the statement's snapshot, the
-- same pattern 0003 already used for membership_tier.
--
-- KNOWN EDGE (rare, recoverable): if award_points() commits BETWEEN a
-- profile-save's snapshot and its row lock, EvalPlanQual re-applies the
-- SET over the newer row while the subselect still sees the snapshot
-- value → spurious 42501 on the save. Window is milliseconds and a
-- retry succeeds; if it ever shows up in support tickets, move the
-- freeze to a BEFORE UPDATE trigger comparing OLD vs NEW directly.
-- =====================================================================

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    -- tier flips happen via activate_membership() (service_role).
    and membership_tier = (select membership_tier from public.profiles where id = auth.uid())
    -- points change only through award_points() / report_post().
    and points = (select points from public.profiles where id = auth.uid())
    -- membership window is service_role-only; nullable → IS NOT DISTINCT FROM.
    and membership_active_until is not distinct from
        (select membership_active_until from public.profiles where id = auth.uid())
    -- role: keep current, or pick a non-privileged role (onboarding).
    -- 'promotor' can never be SET via this path, only kept.
    and (
      role = (select role from public.profiles where id = auth.uid())
      or role in ('raver', 'dj')
    )
  );

-- Make PostgREST pick up the new policy immediately.
notify pgrst, 'reload schema';
