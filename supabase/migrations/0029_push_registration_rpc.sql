-- =====================================================================
-- FEEDBACK — Push: device-level subscription registration + rate limit
-- =====================================================================
-- Two pieces of the Fase-1 push hardening:
--
-- (1) register/unregister RPCs. The client used to upsert
--     push_subscriptions directly, which broke on shared devices: if the
--     endpoint row belonged to ANOTHER account (couple sharing a phone,
--     logout→login as someone else), the upsert's UPDATE branch hit the
--     update-own RLS policy, failed with a generic error, AND left the
--     previous owner's row in place — so user B's device kept receiving
--     user A's private notifications. The fix encodes the right model:
--     a push endpoint belongs to the DEVICE, and the device belongs to
--     whoever is currently signed in on it. SECURITY DEFINER lets the
--     RPC reassign rows across owners; the JWT decides the new owner.
--
-- (2) push_events — a minimal ledger the send-push Edge Function uses to
--     rate-limit senders (N pushes per window per sender). service_role
--     only; no client policies.
-- =====================================================================

-- ---------------------------------------------------------------------
-- register_push_subscription(endpoint, subscription)
-- Called on subscribe AND on every boot resync (idempotent).
-- ---------------------------------------------------------------------
create or replace function public.register_push_subscription(
  p_endpoint     text,
  p_subscription jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  -- Shape checks: a real PushSubscription JSON carries its own endpoint
  -- (must match) and the encryption keys web-push needs. Reject garbage
  -- so the definer function can't be used to park junk rows.
  if p_endpoint is null
     or length(p_endpoint) < 16
     or length(p_endpoint) > 2048
     or p_endpoint !~ '^https://' then
    raise exception 'bad_endpoint';
  end if;
  if p_subscription is null
     or p_subscription->>'endpoint' is distinct from p_endpoint
     or p_subscription->'keys'->>'p256dh' is null
     or p_subscription->'keys'->>'auth' is null then
    raise exception 'bad_subscription';
  end if;

  -- Device-level ownership: evict any row another account left on this
  -- endpoint, then upsert as the current user.
  delete from public.push_subscriptions
   where endpoint = p_endpoint and user_id <> auth.uid();

  insert into public.push_subscriptions (user_id, endpoint, subscription)
  values (auth.uid(), p_endpoint, p_subscription)
  on conflict (endpoint) do update
    set subscription = excluded.subscription,
        user_id      = excluded.user_id,
        updated_at   = now();
end;
$$;

revoke all on function public.register_push_subscription(text, jsonb) from public, anon;
grant execute on function public.register_push_subscription(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- unregister_push_subscription(endpoint)
-- Called on logout (BEFORE signOut, while the JWT is still valid).
-- Scoped to the CALLER's own row: after register_push_subscription the
-- device's row always belongs to the current user, so an owner filter
-- costs nothing here and closes the "delete a stranger's subscription
-- by leaked endpoint" DoS that an unscoped definer delete would allow.
-- (Cross-owner eviction legitimately happens only in register, where it
-- requires presenting a full valid subscription for that endpoint.)
-- ---------------------------------------------------------------------
create or replace function public.unregister_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_endpoint is null or length(p_endpoint) > 2048 then
    raise exception 'bad_endpoint';
  end if;
  delete from public.push_subscriptions
   where endpoint = p_endpoint and user_id = auth.uid();
end;
$$;

revoke all on function public.unregister_push_subscription(text) from public, anon;
grant execute on function public.unregister_push_subscription(text) to authenticated;

-- ---------------------------------------------------------------------
-- push_events — send-push rate-limit ledger (service_role only).
-- The Edge Function inserts one row per accepted send and counts the
-- sender's rows inside the window (global cap) AND the sender→recipient
-- rows (directed cap, the anti-harassment one: like/unlike loops pass
-- the relationship gate on every iteration, so the per-recipient cap is
-- what actually bounds repeated pushes at one victim). It also prunes
-- the sender's stale rows opportunistically, so the table stays tiny.
-- ---------------------------------------------------------------------
create table if not exists public.push_events (
  sender_id    uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid,
  created_at   timestamptz not null default now()
);

create index if not exists push_events_sender_idx
  on public.push_events(sender_id, created_at desc);

alter table public.push_events enable row level security;
-- No policies on purpose: only service_role (which bypasses RLS) touches it.

notify pgrst, 'reload schema';
