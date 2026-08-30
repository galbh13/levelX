-- FOUNDATION hidden challenge retune: "Wall Walk 5 reps" → "Wall Walk 10 reps".
--
-- Only the display name changes. The node keeps its id, so every existing
-- `student_quest_completions` row, its `prerequisites` (POWER tip + MOBILITY
-- tip), `is_hidden`, `is_convergence`, `branch = 'challenge'` and `lvl_reward`
-- stay exactly as 20260824_hidden_challenges.sql left them.
--
-- Matches the LIVE tree by class/chain/name (ids drift from the migration
-- files) and is idempotent — re-running is a no-op once renamed.
--
-- CAUTION: re-running 20260824_hidden_challenges.sql after this recreates the
-- node under the old "Wall Walk 5 reps" name (its name check misses the new
-- one) — run THIS file again afterwards.

DO $$
DECLARE
  touched integer;
BEGIN
  UPDATE public.class_quests q
  SET name = 'Wall Walk 10 reps'
  FROM public.classes c
  WHERE c.id = q.class_id
    AND c.job = 'handstand'
    AND q.quest_type = 'main'
    AND lower(q.chain) = 'foundation'
    AND q.is_hidden
    AND q.name = 'Wall Walk 5 reps';

  GET DIAGNOSTICS touched = ROW_COUNT;

  IF touched = 0 THEN
    IF EXISTS (
      SELECT 1 FROM public.class_quests q
      JOIN public.classes c ON c.id = q.class_id
      WHERE c.job = 'handstand' AND q.quest_type = 'main'
        AND lower(q.chain) = 'foundation' AND q.name = 'Wall Walk 10 reps'
    ) THEN
      RAISE NOTICE 'already renamed — nothing to do';
    ELSE
      RAISE EXCEPTION 'FOUNDATION hidden challenge "Wall Walk 5 reps" not found — run 20260824_hidden_challenges.sql first';
    END IF;
  ELSE
    RAISE NOTICE 'renamed % node(s) to "Wall Walk 10 reps"', touched;
  END IF;
END $$;
