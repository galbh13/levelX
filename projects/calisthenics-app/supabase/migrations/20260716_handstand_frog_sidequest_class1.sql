-- Handstand job — CLASS 1 gets a SIDE quest: FROG.
--
-- Copies the static job's Class I 'frog' SIDE quest into the handstand job's
-- first class (Handstand I, order_index 0), verbatim and still typed as a side
-- quest. It shows in Handstand I's SIDE section (TIER I — frog is a self-contained
-- tier-1 side chain, so it carries no cross-chain prereqs).
--
-- Source found by fuzzy name match (Class I side-chain slugs are human strings),
-- capturing the real slug so the copy keeps the same chain name → card reads
-- "FROG". DB-side copy of the LIVE tree: fresh ids, remapped prereqs. Idempotent.

DO $$
DECLARE
  src_class uuid;
  src_chain text;
  tgt_class uuid;
BEGIN
  -- Source: a static SIDE chain named like "frog".
  SELECT q.class_id, q.chain INTO src_class, src_chain
  FROM class_quests q
  JOIN classes c ON c.id = q.class_id
  WHERE c.job = 'static' AND q.quest_type = 'side' AND q.chain ILIKE '%frog%'
  GROUP BY q.class_id, q.chain
  ORDER BY min(c.order_index) LIMIT 1;

  IF src_class IS NULL THEN
    RAISE EXCEPTION 'No static SIDE chain named like "frog" was found';
  END IF;

  -- Target: the handstand job's first class.
  SELECT id INTO tgt_class
  FROM classes WHERE job = 'handstand' AND order_index = 0
  LIMIT 1;

  IF tgt_class IS NULL THEN
    RAISE EXCEPTION 'handstand class 1 not found — run 20260714_jobs.sql first';
  END IF;

  -- Clear any prior copy so re-running never duplicates.
  DELETE FROM class_quests
  WHERE class_id = tgt_class AND chain = src_chain AND quest_type = 'side';

  -- Copy the whole frog chain verbatim, still as a SIDE quest.
  WITH src AS (
    SELECT * FROM class_quests
    WHERE class_id = src_class AND chain = src_chain AND quest_type = 'side'
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
    'side',
    s.chain,          -- keep the source slug → card reads "FROG"
    s.branch,
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

  RAISE NOTICE 'Handstand I FROG side quest: copied % nodes from static chain "%"',
    (SELECT count(*) FROM class_quests
       WHERE class_id = tgt_class AND chain = src_chain AND quest_type = 'side'),
    src_chain;
END $$;
