-- Admin-as-coach: let admins manage ANY player's data
-- ─────────────────────────────────────────────────────────────────────────────
-- Until now every player-owned table was owner-only RLS (`auth.uid() = student_id`
-- / `= assigned_to` / `= id`), so an admin acting on another player's behalf was
-- rejected by the database. This migration adds ADDITIVE admin-override policies
-- (permissive policies are OR'd together, so each player keeps full access to
-- their own rows — these only GRANT extra access to admins, never restrict).
--
-- All gates use the existing SECURITY DEFINER helper `public.is_admin()`
-- (checks profiles.role = 'admin' without tripping profiles' own RLS) — the same
-- helper the exercises_gallery / challenges policies use.
--
-- Safe to re-run: every policy is dropped-if-exists first.
-- ─────────────────────────────────────────────────────────────────────────────

-- profiles — admins may read every profile (the roster already does) and UPDATE
-- any player's class_id / prestige_count / name. (No admin INSERT/DELETE: rows are
-- created by the auth trigger and never deleted here.)
drop policy if exists "admin select profiles" on profiles;
create policy "admin select profiles"
  on profiles for select to authenticated
  using ( public.is_admin() );

drop policy if exists "admin update profiles" on profiles;
create policy "admin update profiles"
  on profiles for update to authenticated
  using ( public.is_admin() )
  with check ( public.is_admin() );

-- student_quest_completions — admins toggle a player's quest completions (level).
drop policy if exists "admin all quest completions" on student_quest_completions;
create policy "admin all quest completions"
  on student_quest_completions for all to authenticated
  using ( public.is_admin() )
  with check ( public.is_admin() );

-- workouts — admins create / edit / delete a player's workout templates.
drop policy if exists "admin all workouts" on workouts;
create policy "admin all workouts"
  on workouts for all to authenticated
  using ( public.is_admin() )
  with check ( public.is_admin() );

-- exercises — admins manage exercises inside a player's workouts.
drop policy if exists "admin all exercises" on exercises;
create policy "admin all exercises"
  on exercises for all to authenticated
  using ( public.is_admin() )
  with check ( public.is_admin() );

-- weekly_workout_template — admins edit a player's recurring weekly skeleton.
drop policy if exists "admin all weekly template" on weekly_workout_template;
create policy "admin all weekly template"
  on weekly_workout_template for all to authenticated
  using ( public.is_admin() )
  with check ( public.is_admin() );

-- workout_override_workouts — admins edit a player's per-date overrides / completion.
drop policy if exists "admin all overrides" on workout_override_workouts;
create policy "admin all overrides"
  on workout_override_workouts for all to authenticated
  using ( public.is_admin() )
  with check ( public.is_admin() );

-- daily_quests — admins manage a player's daily-quest list.
drop policy if exists "admin all daily quests" on daily_quests;
create policy "admin all daily quests"
  on daily_quests for all to authenticated
  using ( public.is_admin() )
  with check ( public.is_admin() );

-- daily_quest_completions — admins check/uncheck a player's daily quests.
drop policy if exists "admin all daily quest completions" on daily_quest_completions;
create policy "admin all daily quest completions"
  on daily_quest_completions for all to authenticated
  using ( public.is_admin() )
  with check ( public.is_admin() );
