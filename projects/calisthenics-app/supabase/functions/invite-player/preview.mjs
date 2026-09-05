// Render the welcome email to a file so it can be looked at before a real
// player ever receives one.
//
//   cd projects/calisthenics-app/supabase/functions/invite-player
//   node preview.mjs            # → preview.html + preview.txt
//   node preview.mjs --stores   # same, but with both store links live
//   node preview.mjs --agreement # with the Dropbox Sign signing link live
//
// Node ≥22 runs the .ts import directly (type stripping). Nothing here talks to
// Supabase, Gmail or the network — `welcome-email.ts` is pure on purpose.

import { writeFileSync } from 'node:fs';
import { buildWelcomeEmail } from './welcome-email.ts';

// `--stores` previews the future: what the mail looks like once the listings
// exist and the dead SOON chips become real buttons.
const withStores = process.argv.includes('--stores');

// `--booking` points the call button at a booking page, the way production will
// once ONBOARDING_URL is set. The copy under the button is the same either way.
const withBooking = process.argv.includes('--booking');

// `--agreement` previews the mail once AGREEMENT_URL points at the Dropbox Sign
// template link: the dead chip becomes a SIGN THE AGREEMENT button.
const withAgreement = process.argv.includes('--agreement');

const { subject, text, html } = buildWelcomeEmail({
  email: 'new.disciple@gmail.com',
  fullName: 'Ron Levi',
  password: 'PASSWORD',
  appUrl: 'https://levelx.expo.app',
  playUrl: withStores ? 'https://play.google.com/store/apps/details?id=com.levelx.app' : '',
  iosUrl: withStores ? 'https://apps.apple.com/app/id0000000000' : '',
  onboardingCallUrl: withBooking
    ? 'https://calendly.com/the-handstand-system/onboarding'
    : `https://wa.me/972533453199?text=${encodeURIComponent("I'm in. Let's book my onboarding call.")}`,
  // Unset, same as production — previews the reserved "SOON" chip.
  agreementUrl: withAgreement ? 'https://app.hellosign.com/s/EXAMPLE_TEMPLATE_LINK' : '',
  whatsappGroups: [
    {
      label: 'ANNOUNCEMENTS',
      blurb: 'Coach only. Drops, updates, and everything you need to know.',
      color: '#FFD700',
      url: 'https://chat.whatsapp.com/Bbo0pdkFc1lL0474MyYOQm',
    },
    {
      label: 'THE OPEN GROUP',
      blurb: 'Winning environment, same goals, unlimited support.',
      color: '#1FD79A',
      url: 'https://chat.whatsapp.com/Bt3ISJjjJAA9tEZNbb8iIg',
    },
  ],
});

writeFileSync('preview.html', html);
writeFileSync('preview.txt', `Subject: ${subject}\n\n${text}\n`);

console.log(`Subject: ${subject}`);
console.log(`Wrote preview.html (${html.length} chars) and preview.txt`);
