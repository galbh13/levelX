-- Player contact details on the PROFILE — phone + birthday (2026-08-25)
--
-- The coach adds every new player to the WhatsApp community by hand, so the
-- phone number has to be captured at the moment the account is created — the one
-- time the coach actually has it in front of them. The birthday rides along for
-- the same reason.
--
-- These live on `profiles`, NOT on `player_billing`, and that is the point:
-- there is ONE phone number and ONE birthday per player, set at invite time and
-- shown everywhere (the business card included). `player_billing.phone` /
-- `player_billing.birthday` predate this and are now legacy — the app reads and
-- writes the profile columns through lib/billing.js, and the backfill below
-- carries any value already typed into the business card across.
--
-- Both ride in on the auth user's metadata exactly like full_name, so
-- ＋ NEW PLAYER stays a single atomic createUser call with no follow-up write
-- racing the trigger.
--
-- Phone is stored as the coach typed it minus separators: a leading + (if given)
-- and digits. That is what WhatsApp wants pasted into a contact.
--
-- Idempotent — safe to re-run. (This project's live schema has drifted from
-- migrations before, so run it in Supabase → SQL Editor and don't assume.)

alter table public.profiles
  add column if not exists phone text;

alter table public.profiles
  add column if not exists birthday date;

-- ── Carry over anything already recorded on the business card ───────────────
-- Only fills blanks — a profile value, being the newer and now-canonical one,
-- always wins.
update public.profiles p
   set phone = coalesce(p.phone, nullif(trim(b.phone), ''))
  from public.player_billing b
 where b.player_id = p.id
   and p.phone is null
   and nullif(trim(b.phone), '') is not null;

update public.profiles p
   set birthday = coalesce(p.birthday, b.birthday)
  from public.player_billing b
 where b.player_id = p.id
   and p.birthday is null
   and b.birthday is not null;

-- ── The trigger, carrying phone + birthday ──────────────────────────────────
-- Otherwise identical to the hardened version in 20260825_fix_handle_new_user.sql
-- — pinned search_path, schema-qualified, conflict-tolerant.
--
-- birthday is cast defensively: the form sends YYYY-MM-DD or nothing, but a
-- malformed date must not take the whole signup down with it (Auth reports a
-- trigger exception as the useless "Database error creating new user").
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_birthday date;
begin
  begin
    v_birthday := nullif(trim(coalesce(new.raw_user_meta_data ->> 'birthday', '')), '')::date;
  exception when others then
    v_birthday := null;
  end;

  insert into public.profiles (id, email, role, full_name, phone, birthday, must_change_password)
  values (
    new.id,
    new.email,
    'player',
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', '')), ''),
    v_birthday,
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
