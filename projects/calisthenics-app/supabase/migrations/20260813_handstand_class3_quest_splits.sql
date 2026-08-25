-- Handstand III (order_index 2) — two quest reshapes, per request.
--
-- 1. STRAIGHT ARM PRESSES (main, chain 'straight_arm_presses'): split off the
--    three pike nodes (One Pike Negative → Two Pike Presses) into a NEW SIDE
--    quest 'pike_press'. STRAIGHT ARM PRESSES keeps the 4 straddle nodes.
--    The pike quest's first node (One Pike Negative) starts fresh — its old
--    cross-node prereq (Three Straddle Presses) is dropped; the other two keep
--    their in-chain prereqs (which move with them).
--
-- 2. SHAPES (main, chain 'shapes'): move the COMBOS branch out into a NEW MAIN
--    quest 'comboes'. Its nodes are self-contained (linear, no cross-branch
--    prereqs), so only the chain/branch labels change.
--
-- Data move (mutating), scoped by class + chain + name. Safe to re-run: the
-- WHERE clauses no longer match once a node has moved.

DO $$
DECLARE
  cls uuid;
BEGIN
  SELECT id INTO cls FROM classes WHERE job = 'handstand' AND order_index = 2 LIMIT 1;
  IF cls IS NULL THEN
    RAISE EXCEPTION 'Handstand III not found';
  END IF;

  -- ── 1. Pike nodes → new SIDE quest 'pike_press' ──────────────────────────
  UPDATE class_quests
  SET chain = 'pike_press', quest_type = 'side', branch = 'main',
      order_index = order_index - 4        -- ords 4,5,6 → 0,1,2
  WHERE class_id = cls AND quest_type = 'main' AND chain = 'straight_arm_presses'
    AND name IN ('One Pike Negative', 'One Pike Press', 'Two Pike Presses');

  -- New quest's first node has no prerequisite.
  UPDATE class_quests
  SET prerequisites = '{}'::uuid[]
  WHERE class_id = cls AND quest_type = 'side' AND chain = 'pike_press'
    AND name = 'One Pike Negative';

  -- ── 2. SHAPES combos branch → new MAIN quest 'comboes' ───────────────────
  UPDATE class_quests
  SET chain = 'comboes', branch = 'main'
  WHERE class_id = cls AND quest_type = 'main' AND chain = 'shapes' AND branch = 'combos';

  RAISE NOTICE 'Handstand III: pike_press side quest + comboes main quest split done';
END $$;
