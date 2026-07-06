-- Workout branching (a single fork into two alternative endings).
--
-- A workout can split once: the "trunk" exercises (branch IS NULL) are done by
-- everyone; after the last trunk exercise Workout Mode asks the player which
-- branch to take for the rest of the session. Each exercise then belongs either
-- to the trunk (NULL) or to one branch ('a' / 'b').
--
-- The branch DEFINITIONS (their author-given labels) live on the workout, so a
-- branch can be empty — i.e. one option is simply "end the workout here" — and
-- still have a name to show in the prompt.
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS branch text;

-- branches: NULL = no fork. Otherwise a JSON array of two options, in order:
--   [{ "key": "a", "label": "FEELING STRONG" },
--    { "key": "b", "label": "FATIGUED / LIGHTER" }]
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS branches jsonb;
