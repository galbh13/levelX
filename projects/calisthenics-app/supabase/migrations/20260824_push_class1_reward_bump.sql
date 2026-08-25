-- Bump the PUSH main quest's mid/late rewards (handstand job, Class I) ───────
--
-- The push ladder's later nodes were paying too little for how long they take:
-- a 3-LVL node and a 4-LVL node sat only one level apart even though the 4-LVL
-- ones (10 pike push-ups, 16 dips) are a different order of work. Widen the
-- spread so the tail of the tree is worth climbing:
--
--     +3 LVL  →  +5 LVL
--     +4 LVL  →  +7 LVL
--
-- The +1 (3 push-ups) and +2 (10 push-ups, 1 pike, 1 dips) nodes are untouched.
--
-- Scope: the `push` main chain of the FIRST handstand class only — the tree in
-- the screenshot (MAIN / PIKE / DIPS, 11 nodes). Other classes' quests keep
-- their rewards.
--
-- Chain is matched case-insensitively because live chain slugs drift from the
-- migration files' underscore form (see the header of
-- 20260630_class1_swap_headstand_kickup_tiers.sql). Idempotent in effect only
-- as long as it is not re-run after another 3/4 is introduced — the UPDATEs are
-- value-based, so running it twice is harmless (5 and 7 are not 3 or 4).

DO $$
DECLARE
  tgt_class uuid;
  n3 int;
  n4 int;
BEGIN
  SELECT id INTO tgt_class
  FROM classes WHERE job = 'handstand'
  ORDER BY order_index LIMIT 1;

  IF tgt_class IS NULL THEN
    RAISE EXCEPTION 'handstand class not found — run 20260714_jobs.sql first';
  END IF;

  UPDATE class_quests SET lvl_reward = 5
  WHERE class_id = tgt_class AND lower(chain) = 'push' AND quest_type = 'main'
    AND lvl_reward = 3;
  GET DIAGNOSTICS n3 = ROW_COUNT;

  UPDATE class_quests SET lvl_reward = 7
  WHERE class_id = tgt_class AND lower(chain) = 'push' AND quest_type = 'main'
    AND lvl_reward = 4;
  GET DIAGNOSTICS n4 = ROW_COUNT;

  RAISE NOTICE 'push rewards bumped: % nodes 3→5, % nodes 4→7', n3, n4;
END $$;
