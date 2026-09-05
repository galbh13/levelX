// The welcome email — the first thing a new disciple ever sees of The System.
//
// Split out of index.ts on purpose: this file is PURE. It touches no env, no
// network and no Deno API, it just turns a player's details into
// `{ subject, text, html }`. That is what makes it previewable — `preview.mjs`
// next to it renders the mail to an HTML file with node, so the design can be
// looked at without inviting a real person to see it.
//
// It is written TWICE, deliberately: a plain-text half (the fallback every
// client can render, and what a screen reader gets) and an HTML half styled like
// the app. A LINK OR A WORDING CHANGE BELONGS IN BOTH.
//
// Design notes for the HTML half:
//  · Tables, not flexbox — Outlook renders neither grid nor flex.
//  · Every style is inline — Gmail strips <style> blocks and most clients strip
//    <head> entirely, so there is no stylesheet to share.
//  · Nothing loads from the network. The whole design is borders, background
//    colours and letter-spacing, so it looks right with images blocked, which is
//    how most of these will first be read.

// ── Palette ──────────────────────────────────────────────────────────────────
// Lifted from constants/colors.js so the mail is unmistakably the same product
// as the app and the recruitment page (screens/JoinScreen.js): near-black navy
// ground, ONE cyan accent, and gold kept for the single thing that matters most
// on the page — the password.
const BG = '#050912';        // C.bg
const CARD = '#070d1a';
const PANEL = '#0a1424';     // panel inside the card
const LINE = '#1a3a5c';      // hairline / border
const CYAN = '#4A9EBF';      // C.iceGlow
const GOLD = '#FFD700';
const TEXT = '#E8F4FF';      // C.text
const DIM = '#8fb3cc';       // JoinScreen's DIM
const MUTED = '#4a6a8a';
const DEAD = '#2a4a6a';      // C.textMuted — the "not yet" grey
const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// What the player actually does, in order — TITLES ONLY, no explanations. They
// have already been on a call with the coach and been placed; this is a checklist
// for someone who is already in, not a walkthrough for a stranger.
//
// THE AGREEMENT IS STEP ONE (coach's call, 2026-09-02). Nothing else starts until
// it is signed — no call, no training — so it goes above the booking link rather
// than sitting in the footer as an afterthought. The call is second because it is
// the thing that actually starts them; everything below it can happen while they
// wait for their slot.
const STEPS: string[] = [
  'Sign your coaching agreement',
  'Book your onboarding call',
  'Download the app',
  'Sign in and set your own password',
  'Save your password somewhere safe, and set a reminder for the call',
];

// NOTE — there used to be a "WHAT IS INSIDE" section here listing the four tabs
// (HOME / SKILLS / WORKOUTS / CHECK-UP). It was cut on the coach's call
// (2026-08-28): the onboarding call is where he walks them through the app, so
// the email explaining it first both duplicated the call and buried the one
// thing this mail exists to deliver — the account. Don't add it back without
// asking; the mail is deliberately short.

export type WhatsAppGroup = { label: string; blurb: string; color: string; url: string };

export type WelcomeEmailInput = {
  email: string;
  fullName: string;
  password: string;
  appUrl: string;
  /** Google Play listing. Empty until the listing exists — renders as a dead chip. */
  playUrl?: string;
  /** App Store listing. Empty until the listing exists — renders as a dead chip. */
  iosUrl?: string;
  /**
   * Where SCHEDULE AN ONBOARDING CALL points. This should be a booking page —
   * the line under the button promises a confirmation email with the Zoom link,
   * which only a booking page sends.
   */
  onboardingCallUrl: string;
  /**
   * The coaching agreement, as a LINK THE PLAYER SIGNS — a Dropbox Sign template
   * link, not a PDF to read. Opening it drops them straight into the document
   * with their own signature fields; the executed copy is then filed in the
   * coach's Dropbox Sign account and emailed to both sides.
   *
   * Empty until the link exists — renders as a dead chip, same as the stores.
   */
  agreementUrl?: string;
  whatsappGroups: WhatsAppGroup[];
};

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}

// ── Small HTML builders ──────────────────────────────────────────────────────

/** A pill button, outline style — the app's PillButton, flattened for email. */
function btn(url: string, label: string, color: string, wide = false) {
  return `<a href="${escapeHtml(url)}" style="display:${wide ? 'block' : 'inline-block'};background:rgba(255,255,255,0.04);border:2px solid ${color};border-radius:999px;color:${color};text-decoration:none;padding:14px 26px;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:3px;text-align:center;">${label}</a>`;
}

/** The same pill, dead: a store listing that does not exist yet. */
function btnDead(label: string) {
  return `<span style="display:block;background:transparent;border:2px dashed #16304d;border-radius:999px;color:${DEAD};padding:14px 20px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:2px;text-align:center;">${label}</span>`;
}

/**
 * A centred, letter-spaced section label with a hairline under it. Sized to be
 * read, not squinted at — these are the signposts of the whole mail, and at the
 * 11px they started out as they disappeared on a phone.
 */
function sectionLabel(text: string) {
  return `<div style="font-family:${FONT};color:${CYAN};font-size:15px;font-weight:700;letter-spacing:4px;text-align:center;">${text}</div>
          <div style="height:1px;background:${LINE};margin:14px 0 24px;line-height:1px;font-size:0;">&nbsp;</div>`;
}

/** Vertical air. `<br>` stacks unpredictably across clients; a sized div does not. */
function gap(px: number) {
  return `<div style="height:${px}px;line-height:${px}px;font-size:0;">&nbsp;</div>`;
}

// ── The mail ─────────────────────────────────────────────────────────────────

export function buildWelcomeEmail(input: WelcomeEmailInput) {
  const {
    email, fullName, password, playUrl = '', iosUrl = '', onboardingCallUrl,
    agreementUrl = '', whatsappGroups,
  } = input;

  // Where the video link lands. A booking page (Calendly, Cal.com, SavvyCal…)
  // sends its own confirmation email the moment a slot is picked, and the Zoom
  // link is in it — AND in the calendar invite attached to it, which is what
  // actually gets them to the call on time. The email is named first because it
  // is true for everybody; the calendar invite only appears if they accept it.
  //
  // THIS SENTENCE ASSUMES `ONBOARDING_URL` POINTS AT A BOOKING PAGE. It is the
  // coach's call (2026-08-28) that the mail says this unconditionally. If the
  // secret is ever unset, the button falls back to the coach's WhatsApp, which
  // sends no confirmation email — and then this line is a lie. Set the secret.
  const onboardingNote = 'Pick your slot. Your Zoom link arrives in the confirmation email, and in the calendar invite that comes with it.';
  // `appUrl` is deliberately NOT read. The browser link was cut on the coach's
  // call (2026-08-28) — the app comes from the stores and the call carries
  // anyone who lands before the listings do. It stays on the input type because
  // that decision is one line away from being reversed.

  // Only the subject line uses the name now. The body doesn't greet them: they
  // have already spoken to the coach, so a "Hi <name>," reads like a mailshot.
  const firstNameRaw = fullName.trim().split(/\s+/)[0] || fullName.trim();

  const subject = `${firstNameRaw}, welcome aboard — your access to The System`;

  // ── Plain-text half ────────────────────────────────────────────────────────
  const rule = (title: string) => `── ${title} ${'─'.repeat(Math.max(3, 54 - title.length))}`;

  const text = [
    'Welcome aboard.',
    "You're in.",
    '',
    rule('YOUR ACCESS'),
    '',
    `  Username:  ${email}`,
    `  Password:  ${password}`,
    '',
    '  Everyone receives that same starter. The app will ask you to replace it',
    '  the moment you sign in.',
    '',
    rule('YOUR FIRST FIVE STEPS'),
    '',
    ...STEPS.map((title, i) => `  ${i + 1}. ${title}`),
    '',
    rule('THE AGREEMENT'),
    '',
    agreementUrl
      ? `  Sign it here:  ${agreementUrl}`
      : '  Coming with your onboarding call.',
    ...(agreementUrl ? ['  Please sign it before your onboarding call.'] : []),
    '',
    rule('YOUR ONBOARDING CALL'),
    '',
    `  Schedule an onboarding call:  ${onboardingCallUrl}`,
    `  ${onboardingNote}`,
    '',
    rule('DOWNLOAD THE APP'),
    '',
    `  Android, Google Play:  ${playUrl || 'coming soon'}`,
    `  iPhone, App Store:     ${iosUrl || 'coming soon'}`,
    '',
    ...(whatsappGroups.length ? [
      rule('OUR COMMUNITIES'),
      '',
      ...whatsappGroups.flatMap((g) => [`  ${g.label} — ${g.blurb}`, `     ${g.url}`, '']),
    ] : []),
    'Gal Benhamo',
  ].join('\n');

  // ── HTML half ──────────────────────────────────────────────────────────────

  // The four numbered steps, each a row: circled number, then the copy.
  // Title-only rows. With no second line under it, the title is vertically
  // centred against its numbered disc rather than sitting on the disc's cap.
  const stepsHtml = STEPS.map((title, i) => `
            <tr>
              <td width="46" valign="top" style="padding:0 0 16px;">
                <div style="width:32px;height:32px;line-height:32px;border:1px solid ${CYAN};border-radius:50%;color:${CYAN};font-family:${FONT};font-size:14px;font-weight:700;text-align:center;">${i + 1}</div>
              </td>
              <td valign="middle" style="padding:0 0 16px;">
                <div style="font-family:${FONT};color:${TEXT};font-size:17px;font-weight:700;line-height:1.45;">${escapeHtml(title)}</div>
              </td>
            </tr>`).join('');

  // The two store buttons, side by side. Each is live only if its URL is set;
  // otherwise it is the dashed SOON placeholder — visible, but not a dead link.
  const storeHtml = `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td width="50%" valign="top" style="padding:0 6px 0 0;">
                ${playUrl ? btn(playUrl, 'ANDROID', CYAN, true) : btnDead('ANDROID &middot; SOON')}
              </td>
              <td width="50%" valign="top" style="padding:0 0 0 6px;">
                ${iosUrl ? btn(iosUrl, 'IPHONE', CYAN, true) : btnDead('IPHONE &middot; SOON')}
              </td>
            </tr>
          </table>`;

  const whatsappHtml = whatsappGroups.length ? `
          ${sectionLabel('OUR COMMUNITIES')}
          ${whatsappGroups.map((g) => `
          <div style="text-align:center;padding:0 0 18px;">
            ${btn(g.url, escapeHtml(g.label), g.color)}
            <div style="font-family:${FONT};color:${DIM};font-size:13px;padding-top:8px;">${escapeHtml(g.blurb)}</div>
          </div>`).join('')}
          ${gap(16)}` : '';

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:${BG};">
  <!-- Preheader: the one line the inbox shows beside the subject. Kept out of the
       body itself by zero size + a colour matching the ground. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BG};font-size:1px;line-height:1px;">Your username, your starter password, and the first four minutes inside The System.</div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BG};">
    <tr><td align="center" style="padding:28px 12px;">

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:${CARD};border:1px solid ${LINE};border-radius:10px;overflow:hidden;">

        <!-- The cyan edge the app frames every screen with -->
        <tr><td style="height:3px;background:${CYAN};line-height:3px;font-size:0;">&nbsp;</td></tr>

        <!-- Wordmark -->
        <tr><td align="center" style="padding:30px 32px 26px;border-bottom:1px solid ${LINE};">
          <div style="font-family:${FONT};color:${CYAN};font-size:26px;font-weight:700;letter-spacing:9px;">THE SYSTEM</div>
        </td></tr>

        <tr><td style="padding:34px 32px 8px;">

          <!-- Hero. No name and no pitch: anyone reading this has already been on
               a call and been placed. They are in — so the page opens by saying
               so and goes straight to the account. -->
          <div style="font-family:${FONT};color:${CYAN};font-size:30px;font-weight:700;line-height:1.25;">Welcome aboard.</div>
          <div style="font-family:${FONT};color:${TEXT};font-size:30px;font-weight:700;line-height:1.25;padding:0 0 30px;">You're in.</div>

          <!-- Access. The one block that has to survive a squinting read on a
               phone in a gym, so label and value are sized to match the password
               rather than shrinking away under it. -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PANEL};border:1px solid ${LINE};border-radius:6px;">
            <tr><td style="padding:26px 24px;">
              <div style="font-family:${FONT};color:${MUTED};font-size:15px;font-weight:700;letter-spacing:3px;">USERNAME</div>
              <div style="font-family:${FONT};color:${TEXT};font-size:22px;font-weight:700;padding:8px 0 22px;word-break:break-all;">${escapeHtml(email)}</div>
              <div style="font-family:${FONT};color:${MUTED};font-size:15px;font-weight:700;letter-spacing:3px;">STARTER PASSWORD</div>
              <div style="font-family:${FONT};color:${GOLD};font-size:22px;font-weight:700;letter-spacing:4px;padding:8px 0 0;">${escapeHtml(password)}</div>
            </td></tr>
          </table>
          <div style="font-family:${FONT};color:${DIM};font-size:15px;line-height:1.65;padding:14px 2px 34px;">Everyone receives that same starter. The app will ask you to replace it the moment you sign in.</div>

          <!-- Steps -->
          ${sectionLabel('YOUR FIRST FIVE STEPS')}
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            ${stepsHtml}
          </table>

          <!-- The two actions, in the order the steps just listed them: sign,
               then book. Each keeps its own section label — without them the two
               pills stack under one heading and read as alternatives rather than
               as one thing after another. A dead chip until AGREEMENT_URL is set. -->
          ${gap(10)}
          ${sectionLabel('THE AGREEMENT')}
          ${agreementUrl
            ? btn(agreementUrl, 'SIGN THE AGREEMENT', CYAN, true)
            : btnDead('THE AGREEMENT &middot; SOON')}
          ${agreementUrl
            ? `<div style="font-family:${FONT};color:${DIM};font-size:15px;line-height:1.65;text-align:center;padding:14px 0 32px;">Please sign it before your onboarding call. Your own signed copy arrives by email the moment you do.</div>`
            : gap(32)}

          ${sectionLabel('YOUR ONBOARDING CALL')}
          ${btn(onboardingCallUrl, 'SCHEDULE AN ONBOARDING CALL', CYAN, true)}
          <div style="font-family:${FONT};color:${DIM};font-size:15px;line-height:1.65;text-align:center;padding:14px 0 32px;">${onboardingNote}</div>

          ${sectionLabel('DOWNLOAD THE APP')}
          ${storeHtml}
          ${gap(30)}

          <!-- Community -->
          ${whatsappHtml}

          ${gap(6)}

          <!-- Sign-off.
               NO horizontal rule above this, and no separate footer block below
               it — deliberately. Gmail decides for itself which trailing part of
               a mail is "quoted content" and hides it behind a ••• button, and
               the pattern it looks for is exactly a divider followed by a short
               signature-shaped block at the end. Take the divider away and the
               name reads as part of the body, so there is nothing for Gmail to
               fold. Don't reintroduce an <hr>, a bordered footer row, or a
               "sent to you because…" line down here. -->
          <div style="font-family:${FONT};color:${CYAN};font-size:17px;font-weight:700;letter-spacing:1px;line-height:1.8;padding:30px 0 34px;">Gal Benhamo</div>

        </td></tr>

      </table>

    </td></tr>
  </table>
</body></html>`;

  return { subject, text, html };
}
