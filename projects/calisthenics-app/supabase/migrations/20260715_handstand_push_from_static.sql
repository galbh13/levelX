-- Seed the handstand job's first class with the static job's PUSH main-quest
-- chain — an exact copy of the live tree (nodes, branches, order, lvl rewards,
-- convergence flags, prerequisites).
--
-- Why a DB-side copy: the live PUSH tree was authored in the Supabase dashboard
-- and drifts from the migration files, so we can't rebuild it from a static
-- INSERT list. This reads whatever is LIVE in `class_quests` and clones it,
-- generating fresh ids and REMAPPING each node's `prerequisites` uuid[] to the
-- new ids so the tree wires up identically on the handstand class.
--
-- Idempotent: it first clears any existing PUSH main quests on the handstand
-- class, then re-copies. Safe to re-run (e.g. to re-sync after editing static).

DO $$
DECLARE
  src_class uuid;
  tgt_class uuid;
BEGIN
  -- Target: the handstand job's first class (Handstand I, from 20260714_jobs.sql).
  SELECT id INTO tgt_class
  FROM classes
  WHERE job = 'handstand'
  ORDER BY order_index
  LIMIT 1;

  -- Source: the static class that owns a PUSH main chain (lowest order_index).
  SELECT c.id INTO src_class
  FROM classes c
  WHERE c.job = 'static'
    AND EXISTS (
      SELECT 1 FROM class_quests q
      WHERE q.class_id = c.id AND lower(q.chain) = 'push' AND q.quest_type = 'main'
    )
  ORDER BY c.order_index
  LIMIT 1;

  IF tgt_class IS NULL THEN
    RAISE EXCEPTION 'handstand class not found — run 20260714_jobs.sql first';
  END IF;
  IF src_class IS NULL THEN
    RAISE EXCEPTION 'no static PUSH main-quest chain found to copy';
  END IF;

  -- Clear any prior copy so re-running never duplicates. (A freshly seeded
  -- handstand class has no completions, so nothing depends on these rows.)
  DELETE FROM class_quests
  WHERE class_id = tgt_class AND lower(chain) = 'push' AND quest_type = 'main';

  -- Clone each source node with a new id, then remap its prerequisites to the
  -- matching new ids. idmap is MATERIALIZED so gen_random_uuid() is evaluated
  -- ONCE per source row (a CTE referenced twice would otherwise re-roll the uuid
  -- and break the mapping).
  WITH src AS (
    SELECT * FROM class_quests
    WHERE class_id = src_class AND lower(chain) = 'push' AND quest_type = 'main'
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
    s.quest_type,
    s.chain,
    s.branch,
    s.order_index,
    s.name,
    s.lvl_reward,
    s.is_convergence,
    CASE
      WHEN s.prerequisites IS NULL THEN NULL
      ELSE (
        SELECT COALESCE(array_agg(m2.new_id), '{}')::uuid[]
        FROM unnest(s.prerequisites) AS p(old)
        JOIN idmap m2 ON m2.old_id = p.old
      )
    END,
    s.requirement_text
  FROM src s
  JOIN idmap m ON m.old_id = s.id;

  -- Give the two tier-1 skill lines their own branches (the push-ups spine stays
  -- 'main'). Static seeds pike/dips on branch 'main'; splitting them here makes the
  -- later TIER II merge (power/mobility) a genuine CROSS-branch convergence, which
  -- is what the app's tier detector keys on. See 20260716_handstand_push_branch_split.sql.
  UPDATE class_quests SET branch = 'pike'
  WHERE class_id = tgt_class AND lower(chain) = 'push' AND quest_type = 'main'
    AND name ILIKE '%pike%';
  UPDATE class_quests SET branch = 'dips'
  WHERE class_id = tgt_class AND lower(chain) = 'push' AND quest_type = 'main'
    AND name ILIKE '%dips%';

  RAISE NOTICE 'Copied % PUSH main-quest nodes from static class % to handstand class %',
    (SELECT count(*) FROM class_quests WHERE class_id = tgt_class AND lower(chain) = 'push' AND quest_type = 'main'),
    src_class, tgt_class;
END $$;
