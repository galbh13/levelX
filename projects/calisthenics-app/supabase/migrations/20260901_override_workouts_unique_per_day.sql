-- One row per (player, date, workout) in `workout_override_workouts`.
--
-- The table never had a uniqueness rule, so any path that inserted without
-- reading first could give a date the same workout twice — and the player's
-- board then listed one mission as two rows (tick one, the twin stays open;
-- resume one, the other still says TAP TO RESUME). Every insert path in the app
-- is guarded now (`materializeDay` only inserts what a date is MISSING, ADD
-- WORKOUT re-reads the date first), but that only stops NEW duplicates: the rows
-- already sitting in players' days have to be collapsed, and nothing but the DB
-- can promise it never happens again under a race.
--
-- Step 1 collapses existing duplicates, KEEPING the completed twin when there is
-- one (if the player ticked either copy, the day is done) and otherwise the
-- oldest row — the same survivor the app's read-side dedupe picks, so the
-- cleanup can't flip a mission back to unfinished.
--
-- Step 2 adds the unique index, which turns a duplicate insert into an error the
-- app can see instead of a silently doubled day.
--
-- Idempotent: running it twice deletes nothing the second time, and the index is
-- created only if absent.

-- 1 ── collapse duplicates, completed copy wins, then oldest.
DELETE FROM workout_override_workouts w
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY student_id, specific_date, workout_id
           ORDER BY completed DESC NULLS LAST, created_at ASC, id ASC
         ) AS rn
  FROM workout_override_workouts
) ranked
WHERE w.id = ranked.id
  AND ranked.rn > 1;

-- 2 ── and never again.
CREATE UNIQUE INDEX IF NOT EXISTS workout_override_workouts_student_date_workout_key
  ON workout_override_workouts (student_id, specific_date, workout_id);
