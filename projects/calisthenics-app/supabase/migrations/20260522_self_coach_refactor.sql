-- ─────────────────────────────────────────────────────────────────────────────
-- SELF-COACH REFACTOR (2026-05-22)
--
-- Every player becomes their own coach. The 'coach' title is removed; only
-- 'admin' and 'player' roles remain. The entire Checkup system is deleted.
--
-- Apply this in the Supabase SQL editor (the live schema lives in the dashboard;
-- this file + DATABASE.md are the source of truth — see CLAUDE.md).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Roles ────────────────────────────────────────────────────────────────────
--    IMPORTANT: drop the OLD role CHECK constraint first. It is not necessarily
--    named `profiles_role_check`, and while it exists it forbids 'player', so the
--    UPDATE below would fail. Discover and drop ANY check constraint on the
--    `role` column by definition, regardless of its name.
do $$
declare r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class     rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where rel.relname = 'profiles'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%role%'
  loop
    execute format('alter table profiles drop constraint %I', r.conname);
  end loop;
end $$;

--    Collapse 'student' and 'coach' into 'player'. Existing coach accounts
--    become normal players (they self-coach like everyone else).
update profiles set role = 'player' where role in ('student', 'coach');

--    Add the new constraint (now that every row is admin/player) + default.
alter table profiles
  add constraint profiles_role_check check (role in ('admin', 'player'));
alter table profiles alter column role set default 'player';

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email, role)
  values (new.id, new.email, 'player');
  return new;
end;
$$ language plpgsql security definer;

-- 2. Drop the Checkup system ───────────────────────────────────────────────────
--    Children first (FKs), then parent. CASCADE covers any stray dependents.
drop table if exists checkup_uploads   cascade;
drop table if exists checkup_answers   cascade;
drop table if exists checkup_exercises cascade;
drop table if exists checkup_questions cascade;
drop table if exists checkups          cascade;

-- 3. Drop the checkup-videos storage bucket ─────────────────────────────────────
--    Supabase BLOCKS direct DELETE from storage.objects / storage.buckets via SQL
--    (storage.protect_delete trigger). Remove the bucket through the dashboard
--    instead: Storage → 'checkup-videos' → empty it, then delete the bucket.
--    (Nothing references it in code anymore, so it is harmless if left in place.)

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE: profiles.coach_id is intentionally KEPT (now unused / always NULL) to
-- avoid a destructive column drop. workouts.created_by, daily_quests.coach_id and
-- workout_override_workouts.coach_id now simply equal the player's own id (each
-- player is the author of their own content). No further changes needed.
-- ─────────────────────────────────────────────────────────────────────────────
