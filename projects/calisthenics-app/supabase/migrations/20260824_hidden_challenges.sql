-- HIDDEN CHALLENGES — a quest node that does not exist for the player until the
-- whole quest around it has been cleared, then appears as a bonus challenge.
--
-- Mechanism: a new `class_quests.is_hidden` flag. A hidden node is filtered OUT
-- of the app entirely (tree, node count, chain progress) until EVERY id in its
-- `prerequisites` is completed — then it pops into the tree, already unlocked.
-- Nothing else about the node is special: it is a normal convergence node with
-- a normal `lvl_reward`, so completing it levels the player like any other quest.
-- (`lib/hiddenQuests.js` owns the reveal rule; QuestTree + Skills both use it.)
--
-- First hidden challenge: the handstand job's Class I FOUNDATION main quest —
-- clear the tip of BOTH branches (POWER + MOBILITY) and "Wall Walk 5 reps"
-- reveals itself beneath them.
--
-- Like the other handstand migrations this matches the LIVE tree by
-- class/chain/branch (ids and rewards drift from the migration files), and is
-- idempotent — re-running is a no-op once the challenge exists.

ALTER TABLE public.class_quests
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

DO $$
DECLARE
  tgt_class  uuid;
  power_tip  uuid;
  mob_tip    uuid;
  next_order integer;
BEGIN
  -- The handstand job's first class (Class I).
  SELECT id INTO tgt_class
  FROM public.classes WHERE job = 'handstand'
  ORDER BY order_index LIMIT 1;
  IF tgt_class IS NULL THEN
    RAISE EXCEPTION 'handstand class not found — run 20260714_jobs.sql first';
  END IF;

  -- Branch TIPS = the node of each branch that nothing else in FOUNDATION lists
  -- as a prerequisite (currently "Wall HS Hold 40 sec" / "Weighted Superman 10
  -- sec", but resolved structurally so a renamed/extended branch still works).
  SELECT q.id INTO power_tip
  FROM public.class_quests q
  WHERE q.class_id = tgt_class AND q.quest_type = 'main'
    AND lower(q.chain) = 'foundation' AND lower(COALESCE(q.branch, '')) = 'power'
    AND NOT q.is_hidden
    AND NOT EXISTS (
      SELECT 1 FROM public.class_quests c
      WHERE c.class_id = tgt_class AND c.quest_type = 'main'
        AND lower(c.chain) = 'foundation'
        AND q.id = ANY(COALESCE(c.prerequisites, '{}'))
    )
  ORDER BY q.order_index DESC LIMIT 1;

  SELECT q.id INTO mob_tip
  FROM public.class_quests q
  WHERE q.class_id = tgt_class AND q.quest_type = 'main'
    AND lower(q.chain) = 'foundation' AND lower(COALESCE(q.branch, '')) = 'mobility'
    AND NOT q.is_hidden
    AND NOT EXISTS (
      SELECT 1 FROM public.class_quests c
      WHERE c.class_id = tgt_class AND c.quest_type = 'main'
        AND lower(c.chain) = 'foundation'
        AND q.id = ANY(COALESCE(c.prerequisites, '{}'))
    )
  ORDER BY q.order_index DESC LIMIT 1;

  IF power_tip IS NULL OR mob_tip IS NULL THEN
    RAISE EXCEPTION 'FOUNDATION power/mobility tips not found — run 20260716_handstand_push_tier2_to_foundation.sql first';
  END IF;

  SELECT COALESCE(max(order_index), -1) + 1 INTO next_order
  FROM public.class_quests
  WHERE class_id = tgt_class AND quest_type = 'main' AND lower(chain) = 'foundation';

  -- Insert (or re-point, if it already exists) the hidden challenge.
  IF EXISTS (
    SELECT 1 FROM public.class_quests
    WHERE class_id = tgt_class AND quest_type = 'main'
      AND lower(chain) = 'foundation' AND name = 'Wall Walk 5 reps'
  ) THEN
    UPDATE public.class_quests
    SET branch = 'challenge', is_hidden = true, is_convergence = true,
        prerequisites = ARRAY[power_tip, mob_tip]
    WHERE class_id = tgt_class AND quest_type = 'main'
      AND lower(chain) = 'foundation' AND name = 'Wall Walk 5 reps';
  ELSE
    INSERT INTO public.class_quests
      (class_id, quest_type, chain, branch, order_index, name, lvl_reward,
       is_convergence, prerequisites, is_hidden)
    VALUES
      (tgt_class, 'main', 'foundation', 'challenge', next_order,
       'Wall Walk 5 reps', 10, true, ARRAY[power_tip, mob_tip], true);
  END IF;

  RAISE NOTICE 'hidden challenge "Wall Walk 5 reps" gated on % + %', power_tip, mob_tip;
END $$;
