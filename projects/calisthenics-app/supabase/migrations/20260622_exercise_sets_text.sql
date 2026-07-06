-- Allow set RANGES (e.g. "1-2") on exercises.
-- ─────────────────────────────────────────────────────────────────────────────
-- `exercises.sets` was an integer, so a range like "1-2" couldn't be stored (it
-- got parsed down to a single number). Workout Mode now treats a range as
-- required + optional sets (the lower bound is mandatory, the extra sets up to the
-- upper bound are optional/bonus). Make `sets` TEXT — same as `reps` already is —
-- so the range survives. Existing integer values cast cleanly to their string form
-- (e.g. 3 -> '3'), which parses back to a single required set.
-- Safe to re-run (no-op if already text).
-- ─────────────────────────────────────────────────────────────────────────────

alter table exercises
  alter column sets type text using sets::text;
