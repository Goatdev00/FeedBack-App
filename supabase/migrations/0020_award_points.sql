-- =====================================================================
-- FEEDBACK — Persistent points (award_points RPC)
-- =====================================================================
-- THE BUG THIS FIXES
-- ---------------------------------------------------------------------
-- Until now `profiles.points` (default 50) was never written by any
-- normal user action. Every award — attend a party (+20), first useful
-- post (+15), answer a question (+5), Sunday rating (+10), mutual follow
-- (+10) — lived ONLY in the in-memory store (currentUser.points and the
-- mirrored users[] entry). Both of those are in cloud-state.js's
-- EXCLUDED_FROM_CLOUD set, so the cross-device blob never carried them
-- either.
--
-- The result: points bumped on screen during the session, then
-- syncProfileIntoStore() read the stale profiles.points (50) on the next
-- boot and overwrote the total back to the default. Points never stuck,
-- never synced between devices, and every other user always saw 50.
-- ("No le están sumando los puntos a nadie.")
--
-- THE FIX
-- ---------------------------------------------------------------------
-- A single SECURITY DEFINER RPC the client calls after each optimistic
-- award. It increments the signed-in user's own points atomically (so
-- two quick awards can't clobber each other via read-modify-write) and
-- returns the new total, which the store reconciles into currentUser.
-- profiles.points becomes the real source of truth that
-- syncProfileIntoStore() reads on every boot.
--
-- NOTE on the existing report_post() RPC (migration 0014): it already
-- writes profiles.points (+10 to reporters at the auto-hide threshold).
-- That path is untouched and does NOT go through award_points — there is
-- no client-side addPoints() mirror for it, so no double-count.
--
-- SECURITY / abuse model
-- ---------------------------------------------------------------------
-- The client names the amount, which means a determined caller could in
-- principle invoke this RPC directly to grant themselves points. That is
-- consistent with the app's current trust model (report_post likewise
-- trusts the client's intent). Two cheap guards limit the blast radius:
--   * abs(p_amount) is capped at 100. The largest legitimate award is
--     +20; anything an order of magnitude bigger is malformed/malicious.
--   * the total is floored at 0 so reverts (the answer-question rollback
--     sends -5) can never push a profile negative.
-- A future hardening pass can move the amounts server-side (reason ->
-- amount lookup) and add a per-action ledger with daily limits; the
-- p_reason argument is already accepted and threaded through for that.
-- =====================================================================

create or replace function public.award_points(
  p_amount integer,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- Defense-in-depth bound (see header). Negative deltas are allowed
  -- (revert path) but bounded by the same magnitude check.
  if p_amount is null or abs(p_amount) > 100 then
    raise exception 'invalid_amount';
  end if;

  update public.profiles
  set points = greatest(0, points + p_amount)
  where id = auth.uid()
  returning points into v_points;

  if v_points is null then
    raise exception 'profile_not_found';
  end if;

  return v_points;
end;
$$;

-- Only signed-in users may award points, and only to themselves (the
-- function keys off auth.uid() internally).
grant execute on function public.award_points(integer, text) to authenticated;

-- Drop PostgREST's cached schema so the new RPC is callable immediately
-- (without this the first supabase.rpc('award_points', ...) can 404 with
-- "Could not find the function ... in the schema cache"). No-op on
-- re-runs.
notify pgrst, 'reload schema';
