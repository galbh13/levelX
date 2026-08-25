-- Handstand job — CLASS 2 gets a second main quest: HSPU (handstand push-ups).
--
-- Copies the static job's Class II 'hspu' MAIN quest (HSPU PROG + REQUIREMENT
-- branches converging into the MAIN line, exact nodes/branches/rewards/prereqs)
-- into the handstand job's second class (Handstand II, order_index 1), alongside
-- its existing BALANCE main quest. Kept under chain 'hspu' so the per-branch
-- layout tuning (BRANCH_LAYOUT 'hspu.requirement' / 'hspu.main' in
-- QuestTreeScreen) reproduces the exact same shape.
--
-- DB-side copy of the LIVE tree (drifts from the migration files): fresh ids,
-- remapped prerequisites (self-contained hspu chain → all internal). Idempotent.

DO $$
DECLARE
  src_class uuid;
  tgt_class uuid;
BEGIN
  -- Source: the static class that owns the 'hspu' main quest (Class II).
  SELECT c.id INTO src_class
  FROM classes c
  WHERE c.job = 'static'
    AND EXISTS (
      SELECT 1 FROM class_quests q
      WHERE q.class_id = c.id AND lower(q.chain) = 'hspu' AND q.quest_type = 'main'
    )
  ORDER BY c.order_index LIMIT 1;

  IF src_class IS NULL THEN
    RAISE EXCEPTION 'static HSPU (hspu) main quest not found';
  END IF;

  -- Target: the handstand job's 2nd class (must already exist — the BALANCE class).
  SELECT id INTO tgt_class
  FROM classes WHERE job = 'handstand' AND order_index = 1
  LIMIT 1;

  IF tgt_class IS NULL THEN
    RAISE EXCEPTION 'handstand class 2 not found — run 20260716_handstand_balance_class2.sql first';
  END IF;

  -- Clear any prior copy so re-running never duplicates.
  DELETE FROM class_quests
  WHERE class_id = tgt_class AND lower(chain) = 'hspu' AND quest_type = 'main';

  -- Copy the whole hspu tree verbatim.
  WITH src AS (
    SELECT * FROM class_quests
    WHERE class_id = src_class AND lower(chain) = 'hspu' AND quest_type = 'main'
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
    'hspu',           -- keep the slug so BRANCH_LAYOUT tuning applies
    s.branch,         -- hspu_prog / requirement / main
    s.order_index,
    s.name,
    s.lvl_reward,
    s.is_convergence, -- keep the MAIN convergence centered
    (SELECT COALESCE(array_agg(m2.new_id), '{}')::uuid[]
       FROM unnest(COALESCE(s.prerequisites, '{}')) AS p(old)
       JOIN idmap m2 ON m2.old_id = p.old),
    s.requirement_text
  FROM src s
  JOIN idmap m ON m.old_id = s.id;

  RAISE NOTICE 'Handstand II (class %) HSPU main quest: copied % nodes',
    tgt_class,
    (SELECT count(*) FROM class_quests
       WHERE class_id = tgt_class AND lower(chain) = 'hspu' AND quest_type = 'main');
END $$;
