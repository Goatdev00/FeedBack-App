# SECURITY — FEEDBACK

Quick reference for the security posture of the app and the actions
required before opening the production link to real users.

---

## 1. What's safe to expose publicly

These values ship inside the browser bundle and are visible to anyone
who opens DevTools. By design, they are NOT secrets:

| Value | Where | Why it's OK |
|---|---|---|
| `VITE_SUPABASE_URL` | bundle, `.env.example` | Just the project's REST URL. Public DNS. |
| `VITE_SUPABASE_ANON_KEY` | bundle, `.env.example` | JWT that asserts the `anon` role. Every read/write is gated by RLS policies (see `supabase/migrations/0003_rls_policies.sql`). |
| `VITE_BOLD_API_KEY` | bundle | Bold's public identity key, used only to render the payment button. |
| Site URL (`partyrate.site`) | bundle, manifest | Public domain. |

The **security model**: anon key has full table access at the JWT level,
RLS denies everything by default unless a `using` / `with check` clause
explicitly allows it. Treat RLS like an API.

---

## 2. What must NEVER be in the repo or browser bundle

| Value | Where it lives | Notes |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Edge Function secrets only (`supabase secrets set`) | Bypasses ALL RLS. Server-side only. |
| `BOLD_SECRET_KEY` | Edge Function secret | Used to sign the Bold integrity hash. |
| `BOLD_WEBHOOK_SECRET` | Edge Function secret | HMAC verification for incoming webhooks. |
| Google OAuth `Client Secret` | Supabase Auth provider config | Pasted directly in Supabase dashboard. |
| DB superuser password | Supabase dashboard only | Never in CI logs. |

If any of these accidentally leaks (chat, screenshot, paste), rotate
immediately. Section 3 covers how.

---

## 3. Rotate the secrets that have been exposed in chat

During development the following values were pasted in chat / screenshots
and **must be rotated** before the public launch:

### 3.1 Supabase service_role key (and anon key, for safety)

1. https://supabase.com/dashboard/project/rayjzdxtczvjyxujkmne/settings/api
2. Click **"Generate a new service role key"** (and optionally the anon key too).
3. Old keys are invalidated immediately.
4. Update the new service_role in Edge Function secrets:
   ```bash
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY="new-key-here"
   ```
   (Or via Dashboard → Project Settings → Edge Functions → Secrets.)
5. Update the new anon key in your `.env` (local dev) and in your
   Railway / Hostinger / GitHub Pages build env.

### 3.2 Google OAuth client secret

1. https://console.cloud.google.com/apis/credentials
2. Open your OAuth 2.0 Client → **Reset secret**.
3. Copy the new secret.
4. In Supabase Dashboard → Authentication → Providers → Google →
   paste the new Client Secret → Save.
5. Wait ~30 s for propagation.

### 3.3 DB password (if you shared it)

1. Supabase Dashboard → Project Settings → Database → **Reset database password**.
2. Update any tooling that connected with the old one.

### 3.4 Bold credentials (when integrating)

When you wire Bold for real (Phase 4):
1. Generate the API / Secret / Webhook keys in Bold's merchant dashboard.
2. Set via `supabase secrets set BOLD_API_KEY=... BOLD_SECRET_KEY=... BOLD_WEBHOOK_SECRET=...`.
3. NEVER paste the secret or webhook secret in any committed file.

---

## 4. What I locked down in code (Phase 3 pre-launch)

### 4.1 Dropped `dev_mock_*` RPCs (migration 0010)

Before this migration any authenticated user could call:
```js
supabase.rpc('dev_mock_activate_membership', { p_tier: 'back', p_billing_cycle: 'yearly' })
```
and self-grant Back tier for free. The function name was visible in the
JS bundle so anyone could find it.

[supabase/migrations/0010_production_hardening.sql](supabase/migrations/0010_production_hardening.sql) drops both
`dev_mock_activate_membership` and `dev_mock_cancel_membership`. They
must be applied via SQL Editor before opening the link.

The real activation function `activate_membership(...)` is still in
place, but it's `security definer` + granted only to `service_role`, so
only the Bold webhook (running as service_role inside the edge function)
can call it. Users can't.

### 4.2 RLS policies tightened where it mattered

- `profiles_update_self` blocks self-promotion (a user can't UPDATE their
  own `membership_tier`). Tier flips only via `activate_membership`.
- `memberships_*` only allow SELECT of own row. INSERT / UPDATE / DELETE
  require service_role.
- `membership_transactions_*` same posture.
- Chat write policy on public rooms (migration 0009) is open to all
  authenticated users for Phase 3; tier-gating returns in Phase 4 when
  Bold + memberships are live.

### 4.3 `.gitignore` hardened

Every variant of `.env*` is ignored. Plus `*.map`, `*.pem`, `*.key`,
`*-credentials.json`, source maps. Even an accidental commit pattern
would catch the right files.

---

## 5. What's still on the to-do list

- **CSP via meta tag** — not added yet. Would limit script sources to
  self + supabase + fonts. Postponed because GitHub Pages doesn't allow
  proper response headers and meta-tag CSP is a weaker version that's
  easy to break. Revisit when hosting moves to a server we control.
- **Rate limiting on chat / posts** — Phase 4. Postgres supports it via
  `pg_rate_limit` or via Edge Function pre-checks. For now we rely on
  the daily limit (5 posts/day for general tier) and on Supabase's
  built-in connection rate limits.
- **Audit log** — `state.pointsLedger` in REGLAS.md §8. Phase 4.

---

## 6. Pre-launch checklist (run this before sharing the link)

- [ ] Apply migration 0010 in Supabase SQL Editor.
- [ ] Rotate Supabase service_role key (and anon, optional).
- [ ] Rotate Google OAuth client secret.
- [ ] Confirm `.env` is NOT tracked in git (`git ls-files | grep .env`
      should only show `.env.example`).
- [ ] Confirm the deployed bundle does NOT contain any service_role
      string (open DevTools → Network → look at the main JS file).
- [ ] Supabase Auth → URL Configuration → only `https://partyrate.site`
      and your local dev URL in the redirect allow-list. Drop any test
      domains.
- [ ] Bold API integration NOT done yet → `VITE_PAYMENTS_MODE` should
      stay unset or set to a disabled value so no checkout flow is
      reachable from the UI (the membership UI isn't built yet anyway).
- [ ] Test sign-up + post + comment + chat in production with a fresh
      Google account.
- [ ] Have a way to ban a user if needed (Supabase Auth dashboard → ban
      by email).
