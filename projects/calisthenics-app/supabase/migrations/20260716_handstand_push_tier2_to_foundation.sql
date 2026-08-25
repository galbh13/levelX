-- Move the handstand PUSH main quest's TIER II (the POWER + MOBILITY branches)
-- out into its OWN main quest, FOUNDATION.
--
-- Before: the handstand class's PUSH main quest was
--   TIER I  : push-ups → { pike branch, dips branch }
--   TIER II : power + mobility, each converging from the two TIER I leaves.
-- After:
--   PUSH        : just TIER I (push-ups / pike / dips) — no tier divider anymore.
--   FOUNDATION  : the power + mobility branches, standing on their own as two
--                 independent branch roots (the cross-tier convergence is severed).
--
-- Like the other handstand migrations this operates on the LIVE tree (which drifts
-- from the migration files) by matching on class/chain/branch, not fixed ids.
-- Idempotent — re-running is a no-op once the branches already live in FOUNDATION.

DO $$
DECLARE
  tgt_class uuid;
BEGIN
  -- The handstand job's first (only) class.
  SELECT id INTO tgt_class
  FROM classes WHERE job = 'handstand'
  ORDER BY order_index LIMIT 1;
  IF tgt_class IS NULL THEN
    RAISE EXCEPTION 'handstand class not found — run 20260714_jobs.sql first';
  END IF;

  -- 1) Re-home the two TIER II branches into their own main quest chain.
  UPDATE class_quests
  SET chain = 'foundation'
  WHERE class_id = tgt_class AND quest_type = 'main' AND lower(chain) = 'push'
    AND lower(COALESCE(branch, '')) IN ('power', 'mobility');

  -- 2) Sever the old cross-tier convergence. Each branch root pointed at the two
  --    PUSH tier-1 leaves (pike + dips tips) and was flagged is_convergence to
  --    draw the TIER II divider. In FOUNDATION they are plain branch roots — drop
  --    any prerequisite that no longer lives in this quest, and clear the flag on
  --    a root thus left with no prerequisites. (Internal branch links stay intact:
  --    those prereqs moved into FOUNDATION together with the node.)
  UPDATE class_quests f
  SET prerequisites = (
        SELECT COALESCE(array_agg(p), '{}')::uuid[]
        FROM unnest(COALESCE(f.prerequisites, '{}')) AS p
        WHERE EXISTS (
          SELECT 1 FROM class_quests o
          WHERE o.id = p AND o.class_id = tgt_class
            AND o.quest_type = 'main' AND lower(o.chain) = 'foundation'
        )
      ),
      is_convergence = (
        EXISTS (
          SELECT 1 FROM unnest(COALESCE(f.prerequisites, '{}')) AS p
          JOIN class_quests o ON o.id = p
          WHERE o.class_id = tgt_class AND o.quest_type = 'main'
            AND lower(o.chain) = 'foundation'
        ) AND f.is_convergence
      )
  WHERE f.class_id = tgt_class AND f.quest_type = 'main'
    AND lower(f.chain) = 'foundation';

  RAISE NOTICE 'FOUNDATION main quest seeded with % nodes (moved from PUSH TIER II); PUSH now has % nodes',
    (SELECT count(*) FROM class_quests
       WHERE class_id = tgt_class AND quest_type = 'main' AND lower(chain) = 'foundation'),
    (SELECT count(*) FROM class_quests
       WHERE class_id = tgt_class AND quest_type = 'main' AND lower(chain) = 'push');
END $$;
