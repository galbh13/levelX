-- Player phone number (2026-08-25)
--
-- The coach adds every new player to the WhatsApp community by hand, so the
-- phone number has to be captured at the moment the account is created — the
-- one time the coach actually has it in front of them. It rides across on the
-- auth user's metadata exactly like full_name, so ＋ NEW PLAYER stays a single
-- atomic createUser call with no follow-up write racing the trigger.
--
-- Stored as the coach typed it, minus separators: a leading + (if given) and
-- digits. That is what WhatsApp wants pasted into a contact.
--
-- Idempotent — safe to re-run. (This project's live schema has drifted from
-- migrations before, so run it in Supabase → SQL Editor and don't assume.)

alter table public.profiles
  add column if not exists phone text;

-- handle_new_user(), carrying phone as well. Otherwise identical to the
-- hardened version in 20260825_fix_handle_new_user.sql — pinned search_path,
-- schema-qualified, conflict-tolerant.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role, full_name, phone, must_change_password)
  values (
    new.id,
    new.email,
    'player',
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', '')), ''),
    coalesce((new.raw_user_meta_data ->> 'must_change_password')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
