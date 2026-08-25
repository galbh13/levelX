-- Retune two PUSH branch tiers (handstand job, Class I) ──────────────────────
--
-- Follow-up to `20260824_push_class1_reward_bump.sql`, which moved every 3-LVL
-- node to 5 and every 4-LVL node to 7 in one value-based sweep. That flattened
-- distinctions the ladder actually has, so this migration re-separates the two
-- ends of the PIKE / DIPS branches by NAME:
--
--     3 Pike Push-ups   +5  →  +4      5 dips    +5  →  +4
--     10 pike push-ups  +7  → +10      16 dips   +7  → +10
--
-- The middle nodes (6 Pike Push-ups, 10 dips) stay at +5, and the MAIN chain
-- (3 / 10 / 20 push-ups) and the +2 entry nodes are untouched.
--
-- Matched on `name` rather than on the current reward, because rewards in the
-- live DB drift from the migration files while names are stable (see CLAUDE.md).
-- Names are matched case-insensitively via regex since the live rows mix casing
-- ("3 Pike Push-ups" vs "10 pike push-ups"). Idempotent: re-running sets the
-- same values.

DO $$
DECLARE
  tgt_class uuid;
  n int;
BEGIN
  SELECT id INTO tgt_class
  FROM classes WHERE job = 'handstand'
  ORDER BY order_index LIMIT 1;

  IF tgt_class IS NULL THEN
    RAISE EXCEPTION 'handstand class not found — run 20260714_jobs.sql first';
  END IF;

  UPDATE class_quests SET lvl_reward = 4
  WHERE class_id = tgt_class AND lower(chain) = 'push' AND quest_type = 'main'
    AND (name ~* '^\s*3\s+pike' OR name ~* '^\s*5\s+dips');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '3 pike / 5 dips → +4: % rows', n;

  UPDATE class_quests SET lvl_reward = 10
  WHERE class_id = tgt_class AND lower(chain) = 'push' AND quest_type = 'main'
    AND (name ~* '^\s*10\s+pike' OR name ~* '^\s*16\s+dips');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '10 pike / 16 dips → +10: % rows', n;
END $$;
