-- Per-exercise "variation" — free-text instructions attached to an exercise
-- INSIDE a workout (independent of the library exercise it was picked from), so a
-- coach can tweak how an exercise is performed this cycle without editing the
-- shared gallery exercise.
-- ─────────────────────────────────────────────────────────────────────────────
-- Player workouts store exercises in the `exercises` table → add a column.
-- Gallery example workouts store exercises INLINE in JSONB → no schema change
-- (the `variation` key is just added to each object).
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table exercises
  add column if not exists variation text;
