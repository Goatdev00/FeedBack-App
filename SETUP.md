# FEEDBACK — Production setup (Supabase + Bold + Railway)

This document is the **single source of truth** for getting the app running in production. Follow it top-to-bottom. Time estimate: ~45 min if you have your Bold merchant credentials handy.

Audience: someone with terminal access who can install `npm`, the `supabase` CLI, and create accounts on Supabase, Google Cloud, Bold and Railway.

> **Where are we today?** Phase 1 is the *foundation*: schema, RLS, edge functions, auth scaffold, benefits matrix, infra config. The existing UI (wall / parties / profile) still runs on localStorage and will be migrated to Supabase in Phase 2.

---

## 0. Prereqs

```bash
node -v        # >=18
npm -v
brew install supabase/tap/supabase   # or: npm i -g supabase
supabase --version
```

You also need accounts on:
- [supabase.com](https://supabase.com) — managed Postgres + Auth + Realtime + Edge Functions
- [Google Cloud Console](https://console.cloud.google.com) — to enable Google OAuth
- [Bold (bold.co)](https://bold.co) — to issue payment links and receive webhooks
- [Railway.app](https://railway.app) — to host the Vite frontend

---

## 1. Provision the Supabase project

1. **Create** a new project at https://supabase.com/dashboard → New project.
   - Region: `sa-east-1` (São Paulo) — closest to Colombia.
   - Set a strong DB password and **save it**.
2. From the dashboard sidebar copy:
   - **Project URL** → goes into `VITE_SUPABASE_URL`
   - **anon public key** → goes into `VITE_SUPABASE_ANON_KEY`
   - **service_role key** → goes into Edge Function secrets (never in browser code)
   - **Project Ref** (short slug at the end of the URL) → goes into `SUPABASE_PROJECT_REF`

### 1.1 Link the local repo to the project

```bash
export SUPABASE_PROJECT_REF=your-project-ref
supabase login
supabase link --project-ref $SUPABASE_PROJECT_REF
```

### 1.2 Apply migrations

The four migrations in `supabase/migrations/` provision the entire schema, all functions, triggers, RLS and realtime publication.

```bash
supabase db push
```

Verify in the Supabase Studio → **Database → Tables** that `profiles`, `parties`, `chat_messages`, `memberships`, `membership_transactions`, `live_ratings`, etc. exist and have RLS enabled (shield icon on each).

### 1.3 Enable required Postgres extensions

The migration enables `pgcrypto` and `citext` automatically. If you also want auto-expiration of memberships in the background:

```sql
-- Run this once in Supabase Studio → SQL Editor:
create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'feedback_expire_memberships',
  '0 3 * * *',   -- every day at 03:00 UTC
  $$ select public.expire_memberships(); $$
);
```

---

## 2. Configure Google OAuth

1. In Google Cloud Console create an **OAuth 2.0 Client ID** (Application type: Web application).
2. **Authorized redirect URIs**: add
   `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. Copy Client ID and Client Secret.
4. In Supabase Dashboard → **Authentication → Providers → Google**: paste both and enable.
5. **Authentication → URL Configuration**:
   - Site URL: your Railway URL once deployed (e.g. `https://feedback.up.railway.app`)
   - Additional Redirect URLs: also add `http://localhost:3000` for dev.

---

## 3. Configure Bold

Bold's "Botón de Pagos" flow:

```
Browser → /membership/checkout
   ↓ POST create-bold-checkout (edge fn)
   ↓ creates pending tx, returns integrity hash + redirection URL
Browser → redirected to Bold's hosted checkout
   ↓ user pays
Bold → POST /functions/v1/bold-webhook  (server-to-server)
   ↓ verifies HMAC, marks tx approved, calls activate_membership()
Browser → redirected back to /membership/success
```

### 3.1 Get your Bold keys

In Bold's merchant dashboard:
- **API Key** (identity key) → exposed in browser as `VITE_BOLD_API_KEY` and also stored as `BOLD_API_KEY` in edge function secrets
- **Secret Key** → `BOLD_SECRET_KEY` (server only, used for integrity hash)
- **Webhook Secret** → `BOLD_WEBHOOK_SECRET` (server only, HMAC of webhook body)

### 3.2 Register the webhook URL with Bold

Once Edge Functions are deployed:
```
https://<your-project-ref>.supabase.co/functions/v1/bold-webhook
```

### 3.3 Set secrets in Supabase

```bash
supabase secrets set \
  BOLD_API_KEY="..." \
  BOLD_SECRET_KEY="..." \
  BOLD_WEBHOOK_SECRET="..." \
  BOLD_REDIRECT_BASE_URL="https://feedback.up.railway.app/membership/success"
```

### 3.4 Deploy the Edge Functions

```bash
supabase functions deploy create-bold-checkout
supabase functions deploy bold-webhook --no-verify-jwt
```

> `--no-verify-jwt` on the webhook is required because Bold's server has no Supabase JWT. The webhook authenticates itself via HMAC instead (see [supabase/functions/bold-webhook/index.ts](supabase/functions/bold-webhook/index.ts)).

---

## 4. Local development

```bash
cp .env.example .env
# fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_BOLD_API_KEY
npm install
npm run dev
```

The legacy mock UI still works (it uses localStorage). The Supabase client initializes in [src/data/supabase.js](src/data/supabase.js) and exports auth helpers from [src/data/auth.js](src/data/auth.js) — Phase 2 will wire them into the pages.

### Smoke-test the Supabase wiring without leaving the browser

In the dev console:
```js
const { supabase } = await import('/src/data/supabase.js');
const { data } = await supabase.from('parties').select('id, name').limit(3);
console.log(data);  // [] if no parties yet — confirms connectivity & RLS
```

---

## 5. Deploy the frontend to Railway

1. Push the repo to GitHub.
2. Railway → New Project → Deploy from GitHub repo.
3. **Variables** tab: add
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_BOLD_API_KEY`
   - `PORT` (Railway sets this automatically, but verify)
4. **Settings → Networking**: generate a public domain. Copy it back into:
   - Supabase Auth → Site URL
   - `BOLD_REDIRECT_BASE_URL` secret
5. Railway auto-deploys on push. The `start` script in [package.json](package.json) serves the built bundle with `vite preview`.

---

## 6. How to extend the system

### Add a new beneficio (e.g. "Drop early access" para Back)

1. Add an entry to the relevant role array in [src/config/membership-benefits.js](src/config/membership-benefits.js).
2. If it gates behavior, also surface it in `LIMITS` or `PERMS`.
3. UI consuming `<BenefitsList role tier />` updates automatically.
4. If it requires DB enforcement, add a check in an RLS policy or a server function.

### Add a new tier (e.g. "Founder" above Back)

1. Add the enum value to `membership_tier`:
   ```sql
   alter type public.membership_tier add value 'founder' after 'back';
   ```
2. Update `TIERS` in `src/config/membership-benefits.js`.
3. Update every `byTier` cell to include the new column.
4. Update `LIMITS` / `PERMS` with the new tier's values.
5. Update `current_tier()`, `tier_weight()` and the chat write policies in [supabase/migrations/0002_functions_triggers.sql](supabase/migrations/0002_functions_triggers.sql) and [supabase/migrations/0003_rls_policies.sql](supabase/migrations/0003_rls_policies.sql).
6. Add a price entry to `PRICE_TABLE` in [supabase/functions/create-bold-checkout/index.ts](supabase/functions/create-bold-checkout/index.ts).

### Add a new chat permission

1. Add to `PERMS` in `membership-benefits.js`.
2. If it's a server-side gate, mirror it in the relevant RLS policy.

---

## 7. How the realtime chat works

```
                ┌──────────────────────────────────────┐
                │      Postgres (chat_messages)        │
                │                                       │
                │   INSERT → row published via WAL     │
                └──────────────┬───────────────────────┘
                               ↓ logical replication
                ┌──────────────────────────────────────┐
                │  Supabase Realtime broadcast engine  │
                └──────────────┬───────────────────────┘
                               ↓ websocket
                ┌──────────────────────────────────────┐
                │  LiveChat component subscribes to    │
                │  channel `chat:${room_id}`            │
                │  filtered to status='visible'         │
                └──────────────────────────────────────┘
```

- The `chat_messages` table is in `supabase_realtime` publication (see `0004_realtime.sql`).
- Frontend subscribes with:
  ```js
  supabase
    .channel(`chat:${roomId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` }, (payload) => { ... })
    .subscribe();
  ```
- RLS at INSERT time enforces tier permissions; the frontend just shows / hides the input.
- Presence (`X usuarios conectados`) uses `channel.track({ userId })`.

---

## 8. Troubleshooting

| Síntoma | Diagnóstico |
|---|---|
| `[supabase] VITE_SUPABASE_URL ... missing` warning | `.env` no se cargó. Reinicia `npm run dev`. |
| Webhook devuelve `bad_signature` | El `BOLD_WEBHOOK_SECRET` no coincide con el del dashboard de Bold. |
| `messages_write_public` policy violation | El usuario es general → debe upgradear, o no se ha refrescado la sesión tras el pago. |
| `activate_membership` falla con `general tier` | Frontend mandó `tier='general'` al checkout — no es comprable. |
| Realtime no entrega mensajes | Verifica que la tabla esté en `supabase_realtime` publication (`select * from pg_publication_tables;`). |
| Auth OAuth devuelve a `localhost` en producción | Site URL en Supabase Auth → URL Configuration sigue apuntando a localhost. |
