// invite-player — the coach's "new disciple" button.
//
// Called from AdminDashboard with the signed-in admin's JWT (email, full name,
// phone and birthday — the phone is how the coach adds them to the WhatsApp
// community; both land on `profiles` as the player's global contact details,
// which the BUSINESS card then reads). It:
//   1. verifies the caller is a real, logged-in `role = 'admin'` profile,
//   2. creates the auth user with the shared starter password (email already
//      confirmed, so they can log in immediately — no click-to-verify step),
//   3. emails them their credentials from the business Gmail over SMTP.
//
// The service-role key and the Gmail app password live ONLY here, as Supabase
// function secrets. They must never reach the app bundle — the app ships the
// anon key (lib/supabase.js) and nothing else.
//
// The MAIL ITSELF is `welcome-email.ts` next door — a pure builder, so it can be
// previewed with `node preview.mjs` without inviting anyone. This file owns the
// account, the config and the sending; that file owns every word and pixel.
//
// Deploy + secrets: see supabase/functions/README.md.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
import { buildWelcomeEmail } from './welcome-email.ts';

// The starter password every invited player receives. Deliberately shared and
// memorable — the account is flagged `must_change_password`, so the player is
// forced to replace it before they ever reach the app.
const STARTER_PASSWORD = 'PASSWORD';

const APP_URL = Deno.env.get('APP_URL') ?? 'https://levelx.expo.app';
const GMAIL_USER = Deno.env.get('GMAIL_USER') ?? '';
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD') ?? '';
const FROM_NAME = Deno.env.get('MAIL_FROM_NAME') ?? 'The Handstand System';

// ── The store links ──────────────────────────────────────────────────────────
// The app is going to Google Play and the App Store. Neither listing exists yet,
// so both are UNSET, and the mail renders each as a dead "SOON" chip rather than
// a link that 404s. The browser link (APP_URL) is the real way in until then.
//
// When a listing goes live, set the secret and redeploy; nothing else changes:
//   npx supabase secrets set PLAY_URL=https://play.google.com/store/apps/details?id=com.levelx.app
//   npx supabase secrets set IOS_URL=https://apps.apple.com/app/id0000000000
//   npx supabase functions deploy invite-player
const PLAY_URL = Deno.env.get('PLAY_URL') ?? '';
const IOS_URL = Deno.env.get('IOS_URL') ?? '';

// ── The coach's own line ─────────────────────────────────────────────────────
// The mail no longer carries a "message me" section — every player already has
// the coach's number from the sales call. This is here because the onboarding
// button falls back to it.
const COACH_WHATSAPP = '972533453199';   // digits only, country code, no + or spaces

// ── The onboarding call ──────────────────────────────────────────────────────
// The single action the welcome email asks for. Nobody receiving that mail is a
// stranger — they have already been on a sales call and been placed — so the
// next thing that matters is the setup call, not opening the app.
//
// The default is the coach's own WhatsApp with the message pre-typed, because it
// works today and needs nothing set up. Point it at a booking page the moment
// one exists, and the button follows with no code change:
//   npx supabase secrets set ONBOARDING_URL=https://calendly.com/...
const ONBOARDING_MESSAGE = "I'm in. Let's book my onboarding call.";
const ONBOARDING_URL = Deno.env.get('ONBOARDING_URL')
  || `https://wa.me/${COACH_WHATSAPP}?text=${encodeURIComponent(ONBOARDING_MESSAGE)}`;

// ── The coaching agreement ───────────────────────────────────────────────────
// A DROPBOX SIGN TEMPLATE LINK, not a PDF: one public URL, the same for every
// player, that drops them into the agreement with their own signature fields.
// Dropbox Sign → Templates → the template → ··· → Create link.
//   npx supabase secrets set AGREEMENT_URL=https://app.hellosign.com/s/xxxxxxxx
// Unset, the mail reserves its slot as a dead "THE AGREEMENT · SOON" chip.
//
// The signed PDF is filed in the coach's Dropbox Sign account and emailed to
// BOTH SIDES — which is the whole tracking system. Nothing about the agreement
// is stored in Supabase on purpose: notifying it would need a Dropbox Sign API
// subscription (separate from, and far dearer than, the $15/mo app plan), to
// learn something the coach's own inbox already tells him. No agreement in the
// inbox = not signed. See supabase/functions/README.md § "The coaching agreement".
const AGREEMENT_URL = Deno.env.get('AGREEMENT_URL') ?? '';

// The WhatsApp community, as two buttons near the bottom of the welcome email.
//
// This is the whole automation, and it is a link rather than an API call on
// purpose: there is NO way to add someone to a WhatsApp group programmatically.
// The official Cloud API has no group endpoints at all, and even in the app a
// player's "who can add me to groups" privacy setting can refuse it. An invite
// link is the mechanism — the player taps once and joins themselves.
//
// The links are group invite links (WhatsApp → Group info → Invite via link).
// They are shareable tokens by design; if one ever ends up somewhere unwanted,
// hit Reset link in WhatsApp, paste the new one here and redeploy the function.
// The coach calls these "the official one / the announcement group" and "the
// open group / the open community" — same two, in that order.
const WHATSAPP_GROUPS = [
  {
    // Official. Broadcast-only: the coach is the only one who can post.
    label: 'ANNOUNCEMENTS',
    blurb: 'Coach only. Drops, updates, and everything you need to know.',
    color: '#FFD700',
    url: 'https://chat.whatsapp.com/Bbo0pdkFc1lL0474MyYOQm',
  },
  {
    // The open community — everyone posts.
    label: 'THE OPEN GROUP',
    blurb: 'Winning environment, same goals, unlimited support.',
    color: '#1FD79A',
    url: 'https://chat.whatsapp.com/Bt3ISJjjJAA9tEZNbb8iIg',
  },
].filter((g) => g.url);

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
  let body: { email?: string; full_name?: string; phone?: string; birthday?: string };
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

  // Birthday is OPTIONAL (the coach may not know it yet) but must be a real
  // YYYY-MM-DD if given — a `date` column rejects anything else, and inside the
  // signup trigger that surfaces as the useless "Database error creating new
  // user". Empty string means NULL.
  const birthdayRaw = String(body.birthday ?? '').trim();
  const birthdayOk = !birthdayRaw || (
    /^\d{4}-\d{2}-\d{2}$/.test(birthdayRaw) &&
    new Date(`${birthdayRaw}T00:00:00Z`).toISOString().slice(0, 10) === birthdayRaw
  );
  const birthday = birthdayRaw || null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'That does not look like a valid email address.' }, 400);
  }
  if (!fullName) {
    return json({ error: 'A full name is required.' }, 400);
  }
  if (phoneDigits.length < 7 || phoneDigits.length > 15) {
    return json({ error: 'That does not look like a valid phone number.' }, 400);
  }
  if (!birthdayOk) {
    return json({ error: 'Birthday must be a real date, written YYYY-MM-DD.' }, 400);
  }

  // ── 3. Create the auth user ───────────────────────────────────────────────
  // The `on_auth_user_created` trigger turns this into a profiles row (role
  // 'player', job 'handstand' by DB default) and carries the metadata across.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: STARTER_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone, birthday, must_change_password: true },
  });

  if (createErr) {
    const alreadyExists = /already (been )?registered|already exists|duplicate/i.test(createErr.message);
    return json(
      { error: alreadyExists ? 'That email already has an account.' : createErr.message },
      alreadyExists ? 409 : 400,
    );
  }

  // ── 3b. Safety net for the contact details ────────────────────────────────
  // The trigger carries `phone` + `birthday` across from the metadata
  // (migrations/20260825_profile_contact.sql), but this project's live schema
  // has drifted from migrations before. Writing them again costs one statement
  // and means they land even if the live trigger is still an older one. Failure
  // here is not fatal — the account exists and both values are still on the auth
  // user's metadata.
  if (created.user?.id) {
    await admin.from('profiles').update({ phone, birthday }).eq('id', created.user.id);
  }

  // ── 4. Email the player their credentials ─────────────────────────────────
  // The account EXISTS at this point. If the mail fails we say so plainly rather
  // than rolling back — the admin can read the password off the screen and pass
  // it on manually, and deleting a live account on a transient SMTP blip would
  // be worse than an un-emailed one.
  const { subject, text, html } = buildWelcomeEmail({
    email,
    fullName,
    password: STARTER_PASSWORD,
    appUrl: APP_URL,
    playUrl: PLAY_URL,
    iosUrl: IOS_URL,
    onboardingCallUrl: ONBOARDING_URL,
    agreementUrl: AGREEMENT_URL,
    whatsappGroups: WHATSAPP_GROUPS,
  });

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

  return json({ ok: true, emailed: true, email, phone, birthday, user_id: created.user?.id });
});
