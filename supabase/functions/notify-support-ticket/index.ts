// =====================================================================
// FEEDBACK / PartyRate — notify-support-ticket Edge Function
// =====================================================================
// Called (best-effort) by the client right after a support ticket is
// inserted into public.support_tickets. Emails the support inbox via
// Resend so the team gets a heads-up instead of having to poll the
// dashboard.
//
// The ticket row is ALREADY saved by the client insert (RLS-guarded) —
// this function only sends the notification. If it fails, the ticket is
// untouched; the client swallows the error.
//
// AuthN: requires a valid Supabase JWT (the client sends it via
// supabase.functions.invoke). The recipient address is server-controlled
// (SUPPORT_NOTIFY_TO env), so even a forged body can only spam the team's
// own inbox — never a third party. The user-supplied email becomes the
// Reply-To, so replying from the inbox goes straight back to them.
//
// Required secrets (set with `supabase secrets set ...`):
//   RESEND_API_KEY     — from resend.com/api-keys
//   SUPPORT_NOTIFY_TO  — inbox where notifications land (the PartyRate
//                        support address you choose)
//   SUPPORT_FROM       — verified Resend sender, e.g.
//                        "PartyRate Soporte <soporte@partyrate.site>"
//                        (use "onboarding@resend.dev" while testing)
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const SUPPORT_NOTIFY_TO = Deno.env.get('SUPPORT_NOTIFY_TO') ?? '';
const SUPPORT_FROM = Deno.env.get('SUPPORT_FROM') ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Escape user-supplied text before dropping it into the email HTML.
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface TicketBody {
  name?: string;
  email?: string;
  message?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // ---------------- AuthN ----------------
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return json(401, { error: 'unauthorized' });
  }
  const authedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userErr } = await authedClient.auth.getUser();
  if (userErr || !user) return json(401, { error: 'unauthorized' });

  // ---------------- Config gate ----------------
  if (!RESEND_API_KEY || !SUPPORT_NOTIFY_TO || !SUPPORT_FROM) {
    console.error('[notify-support-ticket] missing RESEND_API_KEY / SUPPORT_NOTIFY_TO / SUPPORT_FROM');
    return json(500, { error: 'not_configured' });
  }

  // ---------------- Body ----------------
  let body: TicketBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }
  const name = (body.name ?? '').toString().trim().slice(0, 80);
  const email = (body.email ?? '').toString().trim().slice(0, 160);
  const message = (body.message ?? '').toString().trim().slice(0, 2000);
  if (!name || !email || !message) return json(400, { error: 'invalid_payload' });

  // ---------------- Send via Resend ----------------
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;">
      <h2 style="margin:0 0 16px;">🎟️ Nuevo ticket de soporte</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#666;width:90px;">Nombre</td><td style="padding:6px 0;"><strong>${esc(name)}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#666;">Correo</td><td style="padding:6px 0;"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
        <tr><td style="padding:6px 0;color:#666;vertical-align:top;">Cuenta</td><td style="padding:6px 0;color:#999;font-size:12px;">${esc(user.email ?? user.id)}</td></tr>
      </table>
      <div style="margin:16px 0 0;padding:16px;background:#f6f6f6;border-radius:8px;white-space:pre-wrap;font-size:14px;line-height:1.5;">${esc(message)}</div>
      <p style="margin:20px 0 0;color:#999;font-size:12px;">Responde a este correo para contestarle directamente a ${esc(name)}.</p>
    </div>
  `;

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: SUPPORT_FROM,
        to: [SUPPORT_NOTIFY_TO],
        reply_to: email,
        subject: `🎟️ Soporte — ${name}`,
        html,
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      console.error('[notify-support-ticket] resend error', resp.status, detail);
      return json(502, { error: 'email_send_failed', status: resp.status });
    }
    return json(200, { sent: true });
  } catch (e) {
    console.error('[notify-support-ticket] fetch threw', e);
    return json(500, { error: 'email_send_threw' });
  }
});
