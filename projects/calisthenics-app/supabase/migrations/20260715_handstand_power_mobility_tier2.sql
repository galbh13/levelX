-- Add TIER II to the handstand PUSH main quest: copy the POWER and MOBILITY
-- branches from the static job's Class II handstand chain, converging them after
-- the push chain's TIER I leaves (the pike-push-ups tip + the dips tip).
--
-- Result: the handstand class's single main quest (chain = 'push') is
--   TIER I  : push-ups → { pike-push-ups branch, dips branch }
--   TIER II : power branch + mobility branch, each starting from a convergence
--             of the two TIER I leaves (16 dips + 10 pike push-ups).
--
-- Like the PUSH seed (20260715_handstand_push_from_static.sql) this is a DB-side
-- copy of the LIVE tree (which drifts from the migration files), generating fresh
-- ids and remapping prerequisites. Idempotent — re-running re-copies cleanly.

DO $$
DECLARE
  src_class uuid;
  tgt_class uuid;
  leaves    uuid[];
BEGIN
  -- Target: the handstand job's first class.
  SELECT id INTO tgt_class
  FROM classes WHERE job = 'handstand'
  ORDER BY order_index LIMIT 1;

  -- Source: the static class (lowest order_index) that owns handstand POWER /
  -- MOBILITY main-quest branches — i.e. Class II.
  SELECT c.id INTO src_class
  FROM classes c
  WHERE c.job = 'static'
    AND EXISTS (
      SELECT 1 FROM class_quests q
      WHERE q.class_id = c.id AND lower(q.chain) = 'handstand' AND q.quest_type = 'main'
        AND lower(q.branch) IN ('power', 'mobility')
    )
  ORDER BY c.order_index LIMIT 1;

  IF tgt_class IS NULL THEN
    RAISE EXCEPTION 'handstand class not found — run 20260714_jobs.sql first';
  END IF;
  IF src_class IS NULL THEN
    RAISE EXCEPTION 'static handstand POWER/MOBILITY branches not found';
  END IF;

  -- Clear any prior copy FIRST, so the leaf detection below (and re-runs) never
  -- sees the tier-2 nodes as candidates or as referrers of the tier-1 leaves.
  DELETE FROM class_quests
  WHERE class_id = tgt_class AND quest_type = 'main' AND lower(chain) = 'push'
    AND lower(COALESCE(branch, '')) IN ('power', 'mobility');

  -- TIER I leaves: push main nodes (excluding the tier-2 branches) that are not a
  -- prerequisite of any other push main node — the pike + dips branch tips.
  SELECT array_agg(q.id) INTO leaves
  FROM class_quests q
  WHERE q.class_id = tgt_class AND lower(q.chain) = 'push' AND q.quest_type = 'main'
    AND lower(COALESCE(q.branch, '')) NOT IN ('power', 'mobility')
    AND NOT EXISTS (
      SELECT 1 FROM class_quests o
      WHERE o.class_id = tgt_class AND lower(o.chain) = 'push' AND o.quest_type = 'main'
        AND lower(COALESCE(o.branch, '')) NOT IN ('power', 'mobility')
        AND q.id = ANY(o.prerequisites)
    );

  IF leaves IS NULL OR array_length(leaves, 1) < 2 THEN
    RAISE EXCEPTION 'expected >= 2 push TIER I leaves on the handstand class, found % — run the PUSH seed first',
      COALESCE(array_length(leaves, 1), 0);
  END IF;

  -- Copy the POWER + MOBILITY nodes with fresh ids and remapped INTERNAL prereqs.
  -- Each branch root's only source prereq points outside power/mobility (into the
  -- rest of Class II's handstand chain), so it drops out here → the root is left
  -- with no prereqs, then re-wired below.
  WITH src AS (
    SELECT * FROM class_quests
    WHERE class_id = src_class AND lower(chain) = 'handstand' AND quest_type = 'main'
      AND lower(branch) IN ('power', 'mobility')
  ),
  idmap AS MATERIALIZED (
    SELECT id AS old_id, gen_random_uuid() AS new_id FROM src
  )
  INSERT INTO class_quests
    (id, class_id, quest_type, chain, branch, order_index, name,
     lvl_reward, is_convergence, prerequisites, requirement_text)
  SELECT
    m.new_id,
    tgt_class,
    'main',
    'push',            -- fold into the single PUSH main quest
    s.branch,          -- keep 'power' / 'mobility' branch names
    s.order_index,
    s.name,
    s.lvl_reward,
    s.is_convergence,
    (SELECT COALESCE(array_agg(m2.new_id), '{}')::uuid[]
       FROM unnest(COALESCE(s.prerequisites, '{}')) AS p(old)
       JOIN idmap m2 ON m2.old_id = p.old),
    s.requirement_text
  FROM src s
  JOIN idmap m ON m.old_id = s.id;

  -- Wire each branch root (a copied node left with no prereqs) to converge from
  -- the two TIER I leaves and mark it a convergence node — this cross-branch
  -- (pike + dips) merge is exactly what the app detects as the TIER II boundary.
  UPDATE class_quests
  SET prerequisites = leaves, is_convergence = true
  WHERE class_id = tgt_class AND quest_type = 'main' AND lower(chain) = 'push'
    AND lower(COALESCE(branch, '')) IN ('power', 'mobility')
    AND (prerequisites IS NULL OR cardinality(prerequisites) = 0);

  RAISE NOTICE 'Handstand TIER II: copied % POWER/MOBILITY nodes; converged from % TIER I leaves',
    (SELECT count(*) FROM class_quests
       WHERE class_id = tgt_class AND lower(chain) = 'push' AND quest_type = 'main'
         AND lower(COALESCE(branch, '')) IN ('power', 'mobility')),
    array_length(leaves, 1);
END $$;
