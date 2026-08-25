-- Handstand job — CLASS 2: a short, single-tier BALANCE main quest.
--
-- Creates the handstand job's second class (order_index 1) and seeds its main
-- quest with a copy of the static job's Class II handstand BALANCE branch
-- (branch = 'balance'). The copy becomes its own chain ('balance') so the Skills
-- card reads "BALANCE", laid out as one simple column (branch 'main', no tier).
--
-- DB-side copy of the LIVE tree (drifts from the migration files): fresh ids,
-- remapped INTERNAL prerequisites; the branch root's source prereq points outside
-- 'balance' (into the rest of Class II's handstand chain) so it drops out here,
-- leaving a clean starting node. Idempotent — re-running re-copies cleanly.

DO $$
DECLARE
  src_class uuid;
  tgt_class uuid;
BEGIN
  -- Source: the static class that owns a handstand BALANCE branch (Class II).
  SELECT c.id INTO src_class
  FROM classes c
  WHERE c.job = 'static'
    AND EXISTS (
      SELECT 1 FROM class_quests q
      WHERE q.class_id = c.id AND lower(q.chain) = 'handstand' AND q.quest_type = 'main'
        AND lower(q.branch) = 'balance'
    )
  ORDER BY c.order_index LIMIT 1;

  IF src_class IS NULL THEN
    RAISE EXCEPTION 'static handstand BALANCE branch not found';
  END IF;

  -- Target: the handstand job's 2nd class — create it if missing.
  SELECT id INTO tgt_class
  FROM classes WHERE job = 'handstand' AND order_index = 1
  LIMIT 1;

  IF tgt_class IS NULL THEN
    INSERT INTO classes (id, name, order_index, description, prestige_at, job)
    VALUES (gen_random_uuid(), 'Handstand II', 1,
            'The balance path — a short main quest.', 80, 'handstand')
    RETURNING id INTO tgt_class;
  END IF;

  -- Clear any prior copy so re-running never duplicates.
  DELETE FROM class_quests
  WHERE class_id = tgt_class AND lower(chain) = 'balance' AND quest_type = 'main';

  -- Copy the BALANCE branch as a standalone single-column main quest.
  WITH src AS (
    SELECT * FROM class_quests
    WHERE class_id = src_class AND lower(chain) = 'handstand' AND quest_type = 'main'
      AND lower(branch) = 'balance'
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
    'balance',      -- its own chain → Skills card reads "BALANCE"
    'main',         -- single column, no sub-branch / tier
    s.order_index,
    s.name,
    s.lvl_reward,
    false,          -- standalone linear quest — no cross-branch convergence here
    (SELECT COALESCE(array_agg(m2.new_id), '{}')::uuid[]
       FROM unnest(COALESCE(s.prerequisites, '{}')) AS p(old)
       JOIN idmap m2 ON m2.old_id = p.old),
    s.requirement_text
  FROM src s
  JOIN idmap m ON m.old_id = s.id;

  RAISE NOTICE 'Handstand II (class %) BALANCE main quest: copied % nodes',
    tgt_class,
    (SELECT count(*) FROM class_quests
       WHERE class_id = tgt_class AND lower(chain) = 'balance' AND quest_type = 'main');
END $$;
