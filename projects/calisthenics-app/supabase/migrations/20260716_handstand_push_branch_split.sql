-- Fix the handstand PUSH main quest so its TIER II (power/mobility) actually
-- registers as a tier. The app detects a tier boundary from a CROSS-branch
-- convergence (an is_convergence node whose prerequisites live in 2+ different
-- branches). The seeded pike + dips lines were both on branch 'main' (copied that
-- way from static), so the power/mobility merge read as single-branch → no tier
-- divider, no gap.
--
-- This splits the two tier-1 skill lines into their own branches (the push-ups
-- spine stays 'main'). It edits the existing rows in place — it does NOT delete
-- or re-copy anything, so the power/mobility convergence (which points at the
-- pike/dips leaf ids) is untouched; only those leaves' `branch` changes, which is
-- exactly what makes the convergence cross-branch. Idempotent.

DO $$
DECLARE
  tgt_class uuid;
BEGIN
  SELECT id INTO tgt_class
  FROM classes WHERE job = 'handstand'
  ORDER BY order_index LIMIT 1;

  IF tgt_class IS NULL THEN
    RAISE EXCEPTION 'handstand class not found — run 20260714_jobs.sql first';
  END IF;

  UPDATE class_quests SET branch = 'pike'
  WHERE class_id = tgt_class AND lower(chain) = 'push' AND quest_type = 'main'
    AND name ILIKE '%pike%';

  UPDATE class_quests SET branch = 'dips'
  WHERE class_id = tgt_class AND lower(chain) = 'push' AND quest_type = 'main'
    AND name ILIKE '%dips%';

  RAISE NOTICE 'Split push tier-1 into branches: % pike, % dips',
    (SELECT count(*) FROM class_quests WHERE class_id = tgt_class AND lower(chain) = 'push' AND quest_type = 'main' AND branch = 'pike'),
    (SELECT count(*) FROM class_quests WHERE class_id = tgt_class AND lower(chain) = 'push' AND quest_type = 'main' AND branch = 'dips');
END $$;
