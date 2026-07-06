-- Superset / parallel-exercise grouping.
-- Exercises in the same workout that share the same non-null `superset_group`
-- value are performed in parallel (a superset): in Workout Mode the player must
-- complete all of them, but the order between them doesn't matter.
-- NULL = a normal standalone exercise.
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS superset_group smallint;
