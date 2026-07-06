-- Forking for example/template workouts (mirrors workouts.branches).
-- The per-exercise branch is stored inside the existing `exercises` JSONB array
-- (each item gets an optional "branch": "a"|"b"); the branch DEFINITIONS (labels)
-- live here so an empty branch (the "end here" option) still has a name.
--   branches: NULL = no fork, else
--     [{ "key": "a", "label": "FEELING STRONG" },
--      { "key": "b", "label": "FATIGUED / END HERE" }]
ALTER TABLE gallery_example_workouts ADD COLUMN IF NOT EXISTS branches jsonb;
