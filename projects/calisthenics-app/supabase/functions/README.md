# Edge functions — setup

Two functions, both about the player-account lifecycle:

- **`invite-player`** — the coach's "＋ NEW PLAYER" button on the Admin
  dashboard. Creates a player's auth account and emails them their credentials
  from the business Gmail.
- **`delete-player`** — the **DELETE PLAYER** action in PlayerAdminScreen's
  DANGER ZONE. Deletes the auth user, which cascades the whole player away.

They live server-side for one reason: they need the **service-role key** (to
create or delete an auth user) and, for the invite, the **Gmail app password**.
Neither may ever ship in the app bundle — the app carries only the anon key
(`lib/supabase.js`). Both verify server-side that the caller is a `role='admin'`
profile; a valid player token is not enough.

---

## 1. Run the migration

Supabase dashboard → SQL Editor → paste and run
`supabase/migrations/20260825_invite_player.sql`.

It adds `profiles.must_change_password` and teaches the `handle_new_user()`
trigger to carry `full_name` + that flag across from the new user's metadata.

## 2. Create the Gmail App Password

The function signs in to `smtp.gmail.com` as the business account. Google will
not accept the normal account password — it needs an **App Password**, which
requires 2-Step Verification first.

1. Sign in as **the.handstand.system@gmail.com**.
2. <https://myaccount.google.com/signinoptions/twosv> → turn **2-Step
   Verification** on (needed once; App Passwords do not exist without it).
3. <https://myaccount.google.com/apppasswords> → name it `The System app` →
   **Create**.
4. Copy the 16-character password it shows (e.g. `abcd efgh ijkl mnop`). It is
   shown **once**. Spaces don't matter — strip them.

Gmail's free tier sends ~500 messages/day, far above what inviting players needs.

## 3. Set the function secrets

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically — you only set the three below.

```bash
cd projects/calisthenics-app

npx supabase login                    # opens the browser once
npx supabase link --project-ref wrqhlwprevvcepjrbrea

npx supabase secrets set \
  GMAIL_USER=the.handstand.system@gmail.com \
  GMAIL_APP_PASSWORD=abcdefghijklmnop \
  APP_URL=https://levelx.expo.app \
  MAIL_FROM_NAME="The Handstand System"
```

(Or set the same four in the dashboard: Project → Edge Functions → Secrets.)

## 4. Deploy

```bash
npx supabase functions deploy invite-player
npx supabase functions deploy delete-player
```

Re-run the matching line any time that function's `index.ts` changes. Secrets
survive deploys — you only set them once. `delete-player` needs no secrets of
its own; the service-role key it uses is injected by the platform.

## 5. Check it

Admin dashboard → **＋ NEW PLAYER** → your own email + a name → **CREATE &
EMAIL**. You should get the welcome mail, and the player should appear on the
roster. Signing in as them lands on **SET YOUR PASSWORD**, not the app.

Logs live in the dashboard: Edge Functions → the function → **Logs**. (The CLI
has no `functions logs` subcommand — only `list`, `deploy`, `delete`, `download`,
`new`, `serve`.)

## 6. Testing without burning real addresses

Gmail ignores everything after a `+` in the local part, so
`gal1.benhamo+t1@gmail.com` is a **distinct account to Supabase** but delivers to
the same inbox. Invite `+t1`, `+t2`, … , watch the welcome mail land, sign in as
them, then delete them from DANGER ZONE. Nothing else is needed — no second
mailbox, no throwaway service. Filter them in Gmail with `to:gal1.benhamo+t`.

Do **not** test by inviting `the.handstand.system@gmail.com` — that address is
the *sender*; a Gmail-to-self message is a poor test of deliverability, and it
would put a junk player on the roster of the account that owns the app password.

---

## Failure modes worth knowing

- **"Account created, but the email failed to send"** — the account is real and
  the modal shows the starter password so you can pass it on by hand. Almost
  always a wrong/expired `GMAIL_APP_PASSWORD`. Fix the secret; the player does
  not need re-creating.
- **"Database error creating new user"** — this is Auth's generic wrapper for
  "the `on_auth_user_created` trigger threw, so I rolled the signup back".
  Nothing was created. Run
  `migrations/20260825_fix_handle_new_user.sql`, which covers all three usual
  causes (missing `must_change_password` column, the trigger's `search_path` not
  including `public`, missing grants for `supabase_auth_admin`). If it persists,
  Dashboard → Logs → **Postgres logs** carries the real error.
- **"That email already has an account."** — nothing was changed. To re-invite,
  delete the player first: roster → the player → **DANGER ZONE → DELETE PLAYER**
  (or dashboard → Authentication → Users).
- **"Admins only."** — the signed-in profile's `role` is not `admin`.
- **`Invalid login: 534 …`** from Gmail — 2-Step Verification is off, or you used
  the account password instead of an App Password.

## Changing the starter password

It is `STARTER_PASSWORD` in `invite-player/index.ts` **and** in `lib/invites.js`
(the app shows it on the success card). Change both, then redeploy the function.
