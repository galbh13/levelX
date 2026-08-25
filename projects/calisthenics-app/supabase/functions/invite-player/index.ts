// invite-player — the coach's "new disciple" button.
//
// Called from AdminDashboard with the signed-in admin's JWT (email, full name
// and phone — the phone is how the coach adds them to the WhatsApp community).
// It:
//   1. verifies the caller is a real, logged-in `role = 'admin'` profile,
//   2. creates the auth user with the shared starter password (email already
//      confirmed, so they can log in immediately — no click-to-verify step),
//   3. emails them their credentials from the business Gmail over SMTP.
//
// The service-role key and the Gmail app password live ONLY here, as Supabase
// function secrets. They must never reach the app bundle — the app ships the
// anon key (lib/supabase.js) and nothing else.
//
// Deploy + secrets: see supabase/functions/README.md.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

// The starter password every invited player receives. Deliberately shared and
// memorable — the account is flagged `must_change_password`, so the player is
// forced to replace it before they ever reach the app.
const STARTER_PASSWORD = 'PASSWORD';

const APP_URL = Deno.env.get('APP_URL') ?? 'https://levelx.expo.app';
const GMAIL_USER = Deno.env.get('GMAIL_USER') ?? '';
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD') ?? '';
const FROM_NAME = Deno.env.get('MAIL_FROM_NAME') ?? 'The Handstand System';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

  // ── 1. Authorise: the caller must be a signed-in admin ────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not signed in.' }, 401);

  // A client bound to the CALLER's token — resolves who they actually are.
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller }, error: callerErr } = await asCaller.auth.getUser();
  if (callerErr || !caller) return json({ error: 'Not signed in.' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: callerProfile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', caller.id)
    .single();

  if (callerProfile?.role !== 'admin') {
    return json({ error: 'Admins only.' }, 403);
  }

  // ── 2. Validate input ─────────────────────────────────────────────────────
  let body: { email?: string; full_name?: string; phone?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request body.' }, 400);
  }

  const email = String(body.email ?? '').trim().toLowerCase();
  const fullName = String(body.full_name ?? '').trim();

  // Phone: kept as "+ then digits" — the form WhatsApp wants pasted into a
  // contact. Whatever separators the admin typed are decoration.
  const phoneRaw = String(body.phone ?? '').trim();
  const phoneDigits = phoneRaw.replace(/\D/g, '');
  const phone = phoneRaw.startsWith('+') ? `+${phoneDigits}` : phoneDigits;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'That does not look like a valid email address.' }, 400);
  }
  if (!fullName) {
    return json({ error: 'A full name is required.' }, 400);
  }
  if (phoneDigits.length < 7 || phoneDigits.length > 15) {
    return json({ error: 'That does not look like a valid phone number.' }, 400);
  }

  // ── 3. Create the auth user ───────────────────────────────────────────────
  // The `on_auth_user_created` trigger turns this into a profiles row (role
  // 'player', job 'handstand' by DB default) and carries the metadata across.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: STARTER_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone, must_change_password: true },
  });

  if (createErr) {
    const alreadyExists = /already (been )?registered|already exists|duplicate/i.test(createErr.message);
    return json(
      { error: alreadyExists ? 'That email already has an account.' : createErr.message },
      alreadyExists ? 409 : 400,
    );
  }

  // ── 3b. Safety net for the phone ──────────────────────────────────────────
  // The trigger carries `phone` across from the metadata (migrations/
  // 20260825_profile_phone.sql), but this project's live schema has drifted from
  // migrations before. Writing it again costs one statement and means the number
  // lands even if the live trigger is still the older one. Failure here is not
  // fatal — the account exists and the number is still on the auth user.
  if (created.user?.id) {
    await admin.from('profiles').update({ phone }).eq('id', created.user.id);
  }

  // ── 4. Email the player their credentials ─────────────────────────────────
  // The account EXISTS at this point. If the mail fails we say so plainly rather
  // than rolling back — the admin can read the password off the screen and pass
  // it on manually, and deleting a live account on a transient SMTP blip would
  // be worse than an un-emailed one.
  const firstNameRaw = fullName.split(/\s+/)[0];
  const firstName = escapeHtml(firstNameRaw);
  const subject = 'Welcome to The System — your access';
  const text = [
    `${firstNameRaw},`,
    '',
    'You are in. The System is live for you.',
    '',
    `Open the app:  ${APP_URL}`,
    `Username:      ${email}`,
    `Password:      ${STARTER_PASSWORD}`,
    '',
    'The password above is a one-time starter — the app will ask you to set your',
    'own the first time you sign in. Pick something only you know.',
    '',
    'Once you are inside:',
    '  1. SKILLS   — your quest tree. This is your handstand ladder; complete nodes to level.',
    '  2. HOME     — your daily quest. Do it every day.',
    '  3. PERSONAL — message me directly and submit your check-ups.',
    '',
    'Train hard.',
    FROM_NAME,
  ].join('\n');

  const html = `
  <div style="background:#050912;padding:32px 0;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#070d1a;border:2px solid #1a3a5c;border-radius:6px;overflow:hidden;">
      <div style="padding:28px 32px;border-bottom:2px solid #1a3a5c;text-align:center;">
        <div style="font-size:26px;letter-spacing:8px;color:#4A9EBF;font-weight:700;">THE SYSTEM</div>
      </div>
      <div style="padding:32px;color:#E8F4FF;font-size:15px;line-height:1.7;">
        <p style="margin:0 0 18px;">${firstName},</p>
        <p style="margin:0 0 24px;">You are in. The System is live for you.</p>

        <div style="background:#0a1424;border:1px solid #1a3a5c;border-radius:4px;padding:20px;margin:0 0 24px;">
          <div style="color:#4a6a8a;font-size:11px;letter-spacing:2px;margin-bottom:6px;">USERNAME</div>
          <div style="color:#E8F4FF;font-size:16px;margin-bottom:16px;">${escapeHtml(email)}</div>
          <div style="color:#4a6a8a;font-size:11px;letter-spacing:2px;margin-bottom:6px;">PASSWORD</div>
          <div style="color:#FFD700;font-size:20px;letter-spacing:3px;font-weight:700;">${STARTER_PASSWORD}</div>
        </div>

        <div style="text-align:center;margin:0 0 24px;">
          <a href="${APP_URL}" style="display:inline-block;background:rgba(74,158,191,0.15);border:2px solid #4A9EBF;color:#4A9EBF;text-decoration:none;padding:14px 34px;border-radius:4px;letter-spacing:3px;font-weight:700;font-size:14px;">ENTER THE SYSTEM</a>
        </div>

        <p style="margin:0 0 24px;color:#8fb3cc;font-size:13px;">
          That password is a one-time starter &mdash; the app will ask you to set your own
          the first time you sign in. Pick something only you know.
        </p>

        <div style="border-top:1px solid #1a3a5c;padding-top:22px;">
          <div style="color:#4A9EBF;font-size:12px;letter-spacing:3px;margin-bottom:14px;">ONCE YOU ARE INSIDE</div>
          <p style="margin:0 0 10px;"><b style="color:#4A9EBF;">SKILLS</b> &mdash; your quest tree. This is your handstand ladder; complete nodes to level.</p>
          <p style="margin:0 0 10px;"><b style="color:#4A9EBF;">HOME</b> &mdash; your daily quest. Do it every day.</p>
          <p style="margin:0 0 10px;"><b style="color:#4A9EBF;">PERSONAL</b> &mdash; message me directly and submit your check-ups.</p>
        </div>

        <p style="margin:26px 0 0;color:#4a6a8a;font-size:13px;">Train hard.<br/>${escapeHtml(FROM_NAME)}</p>
      </div>
    </div>
  </div>`;

  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return json({
      ok: true,
      emailed: false,
      email,
      password: STARTER_PASSWORD,
      warning: 'Account created, but mail is not configured (GMAIL_USER / GMAIL_APP_PASSWORD missing).',
    });
  }

  try {
    const smtp = new SMTPClient({
      connection: {
        hostname: 'smtp.gmail.com',
        port: 465,
        tls: true,
        auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD },
      },
    });
    await smtp.send({
      from: `${FROM_NAME} <${GMAIL_USER}>`,
      to: email,
      subject,
      content: text,
      html,
    });
    await smtp.close();
  } catch (e) {
    return json({
      ok: true,
      emailed: false,
      email,
      password: STARTER_PASSWORD,
      warning: `Account created, but the email failed to send: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  return json({ ok: true, emailed: true, email, phone, user_id: created.user?.id });
});
