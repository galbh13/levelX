-- Repair `handle_new_user()` — "Database error creating new user" (2026-08-25)
--
-- Symptom: ＋ NEW PLAYER fails with "Database error creating new user". That
-- string is Auth's generic wrapper for "the `on_auth_user_created` trigger
-- raised an exception, so I rolled the whole signup back". The account is NOT
-- half-created; nothing was written.
--
-- This is idempotent and safe to run repeatedly. It fixes the three things that
-- can make that trigger throw on this project, in the order they're likely:
--
--   1. `profiles.must_change_password` doesn't exist, because
--      20260825_invite_player.sql was never actually run on the live database.
--      (This project's live schema has drifted from migrations before.)
--   2. The trigger function can't SEE the public schema. It runs as
--      `supabase_auth_admin`, and a `security definer` function with no pinned
--      `search_path` inherits that role's — which does not include `public`.
--      Then `profiles` is "relation does not exist" and the insert dies. Fixed
--      by pinning search_path AND schema-qualifying every reference.
--   3. The role lacks privileges on public.profiles.
--
-- Run it in the Supabase dashboard → SQL Editor. If the invite STILL fails
-- after this, the real Postgres error is in Dashboard → Logs → Postgres logs;
-- that message names the exact column or constraint.

-- ── 1. The column the invite flow depends on ────────────────────────────────
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

-- ── 2. Let the auth role reach public at all ────────────────────────────────
grant usage on schema public to supabase_auth_admin;
grant insert, select, update on public.profiles to supabase_auth_admin;

-- ── 3. The trigger function, hardened ───────────────────────────────────────
-- Differences from the version in 20260825_invite_player.sql:
--   • `set search_path = public` — the fix for cause 2 above.
--   • every table name schema-qualified, belt and braces.
--   • `on conflict (id) do nothing` — if a profile row somehow already exists
--     for this id, that must not take the whole signup down with it.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role, full_name, must_change_password)
  values (
    new.id,
    new.email,
    'player',
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    coalesce((new.raw_user_meta_data ->> 'must_change_password')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ── 4. Make sure the trigger is actually attached ───────────────────────────
-- A `create or replace function` does nothing if no trigger calls it. Re-assert
-- the wiring rather than assume it survived every past migration.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
