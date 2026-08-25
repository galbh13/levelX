-- Coach invite workflow (2026-08-25)
--
-- The admin invites a new player ("disciple") from AdminDashboard: they type an
-- email + full name, the `invite-player` edge function creates the auth user
-- with the shared starter password and emails them their credentials.
--
-- Two things happen here:
--   1. profiles.must_change_password — the shared starter password is the same
--      for every new player, so it must not survive first contact. The account
--      is flagged on creation; App.js blocks the app behind SetPasswordScreen
--      until the player picks their own, which clears the flag.
--   2. handle_new_user() now carries full_name + must_change_password across
--      from the auth user's metadata, so the invite is one atomic createUser
--      call with no follow-up profile write to race against the trigger.

alter table profiles
  add column if not exists must_change_password boolean not null default false;

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email, role, full_name, must_change_password)
  values (
    new.id,
    new.email,
    'player',
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    coalesce((new.raw_user_meta_data ->> 'must_change_password')::boolean, false)
  );
  return new;
end;
$$ language plpgsql security definer;

-- A player may clear their OWN flag (they do it by setting a new password on
-- SetPasswordScreen). The existing "profiles update self" policy already scopes
-- the row; this column needs no separate policy, but re-assert that self-update
-- exists so the flag is clearable on a fresh database.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'profiles' and policyname = 'profiles update self'
  ) then
    create policy "profiles update self"
      on profiles for update
      using (auth.uid() = id)
      with check (auth.uid() = id);
  end if;
end $$;
