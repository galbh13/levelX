// Player account lifecycle — the admin-side half of "new disciple" and of
// "this account should never have existed".
//
// All the privileged work (creating the auth user, sending the welcome email,
// deleting an account) happens in edge functions — `invite-player` and
// `delete-player` — because it needs the service-role key and the Gmail app
// password, neither of which may ship in the app bundle. This module is just
// the typed calls into them.
//
// See supabase/functions/{invite-player,delete-player}/index.ts and
// supabase/functions/README.md.

import { supabase } from './supabase';

// Kept in sync with STARTER_PASSWORD in the edge function. Shown on the invite
// confirmation so the admin can read it out if the email never lands.
export const STARTER_PASSWORD = 'PASSWORD';

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? '').trim());
}

/**
 * Strip a typed phone number down to what WhatsApp wants pasted into a contact:
 * a leading `+` if one was given, then digits. Spaces, dashes, dots and brackets
 * are decoration — the coach types however they like and we keep the number.
 */
export function normalizePhone(phone) {
  const raw = String(phone ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  return raw.startsWith('+') ? `+${digits}` : digits;
}

/**
 * Loose on purpose. The coach is typing a real number they already have, in
 * whatever local or international form, so the only thing worth rejecting is a
 * number that clearly isn't one — too few digits to dial, or too many to exist.
 */
export function isValidPhone(phone) {
  const digits = normalizePhone(phone).replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * A birthday is `YYYY-MM-DD` or nothing — the same shape the business card uses,
 * and what a Postgres `date` column takes. Empty is fine (it's optional; the
 * coach may simply not know it yet), but a half-typed date is not: it would be
 * rejected by the database mid-invite.
 */
export function isValidBirthday(birthday) {
  const s = String(birthday ?? '').trim();
  if (!s) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  // Parsed as UTC, not local: `toISOString` reports UTC, so a local-midnight
  // parse would shift the date a day backwards east of Greenwich and reject
  // every valid birthday here in Israel.
  const d = new Date(`${s}T00:00:00Z`);
  // Round-trips only if the date really exists — 2001-02-30 parses but rolls over.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Create a player account and email them their credentials.
 * Resolves `{ ok, emailed, warning }` — `ok: true, emailed: false` means the
 * account exists but the mail failed, which is worth telling the admin about
 * without calling the whole thing a failure.
 * Rejects with an Error carrying the server's message on a real failure.
 */
export async function invitePlayer({ email, fullName, phone, birthday }) {
  const { data, error } = await supabase.functions.invoke('invite-player', {
    body: {
      email: String(email).trim().toLowerCase(),
      full_name: String(fullName).trim(),
      // Normalized here as well as server-side — the stored value is the one the
      // admin will paste into WhatsApp, so it should never carry the typing.
      phone: normalizePhone(phone),
      birthday: String(birthday ?? '').trim(),   // '' → NULL server-side
    },
  });

  if (error) throw await functionError(error);
  if (data?.error) throw new Error(data.error);
  return data ?? { ok: true, emailed: true };
}

/**
 * Delete a player's account, permanently. Admin-only, and enforced server-side —
 * the edge function re-checks the caller's role and refuses to touch the caller
 * or any other admin.
 *
 * This wipes EVERYTHING that hangs off the player (check-ups, workouts,
 * community rows, billing and payments) via the `on delete cascade` chain from
 * auth.users → profiles → every player-scoped table. That is the point for a
 * tester or a blow-in — they stop counting in the BUSINESS screen — and the
 * reason the UI makes the admin type DELETE before this is ever called.
 *
 * Note: uploaded files are NOT cascaded — avatars in Supabase storage and
 * check-up videos on Cloudinary outlive the row and need clearing by hand if
 * they matter.
 *
 * Resolves `{ ok, user_id, email, full_name }`.
 */
export async function deletePlayer({ userId }) {
  const { data, error } = await supabase.functions.invoke('delete-player', {
    body: { user_id: String(userId) },
  });

  if (error) throw await functionError(error);
  if (data?.error) throw new Error(data.error);
  return data ?? { ok: true };
}

// functions.invoke surfaces a non-2xx as FunctionsHttpError with the body on
// `context` — dig the real message out so the admin sees "That email already
// has an account." rather than "Edge Function returned a non-2xx status code".
async function functionError(error) {
  let message = error.message;
  try {
    const body = await error.context?.json?.();
    if (body?.error) message = body.error;
  } catch { /* keep the generic message */ }
  return new Error(message);
}

/**
 * Clear the forced-password-change flag for the signed-in player. Called by
 * SetPasswordScreen after `auth.updateUser` succeeds.
 */
export async function clearMustChangePassword(userId) {
  const { error } = await supabase
    .from('profiles')
    .update({ must_change_password: false })
    .eq('id', userId);
  if (error) throw error;
}
