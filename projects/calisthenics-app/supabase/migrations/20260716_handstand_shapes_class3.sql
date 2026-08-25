-- Handstand job — CLASS 3: the SHAPES main quest.
--
-- Creates the handstand job's third class (order_index 2) and seeds its main
-- quest with a faithful copy of the static job's Class III "HS Beginners" SIDE
-- quest (the COMBOS / STRADDLE / TUCK branches and the MIXED convergence — exact
-- nodes / branches / rewards / prerequisites).
--
-- Two changes only, per request:
--   • it's retyped as the class's MAIN quest (quest_type = 'main'),
--   • the chain is renamed to 'shapes' (Skills card reads "SHAPES").
--
-- The live Class III side-chain slugs are human strings (spaces/hyphens), NOT the
-- underscore forms in the migration files, so the SOURCE is found by a fuzzy name
-- match (a static SIDE chain containing "beginner") and its real slug is captured.
-- DB-side copy of the LIVE tree: fresh ids, remapped prerequisites (all internal —
-- hs_beginners is a self-contained Tier-1 side chain). Idempotent.

DO $$
DECLARE
  src_class uuid;
  src_chain text;
  tgt_class uuid;
BEGIN
  -- Source: a static SIDE chain whose name reads like "HS/Handstand Beginners".
  -- Capture the real chain slug so the copy filters on it exactly.
  SELECT q.class_id, q.chain INTO src_class, src_chain
  FROM class_quests q
  JOIN classes c ON c.id = q.class_id
  WHERE c.job = 'static' AND q.quest_type = 'side' AND q.chain ILIKE '%beginner%'
  GROUP BY q.class_id, q.chain
  ORDER BY min(c.order_index)
  LIMIT 1;

  IF src_class IS NULL THEN
    RAISE EXCEPTION 'No static SIDE chain whose name contains "beginner" was found';
  END IF;

  -- Target: the handstand job's 3rd class — create it if missing.
  SELECT id INTO tgt_class
  FROM classes WHERE job = 'handstand' AND order_index = 2
  LIMIT 1;

  IF tgt_class IS NULL THEN
    INSERT INTO classes (id, name, order_index, description, prestige_at, job)
    VALUES (gen_random_uuid(), 'Handstand III', 2,
            'Shapes — press-to-handstand shapes & combos.', 80, 'handstand')
    RETURNING id INTO tgt_class;
  END IF;

  -- Clear any prior copy so re-running never duplicates.
  DELETE FROM class_quests
  WHERE class_id = tgt_class AND lower(chain) = 'shapes' AND quest_type = 'main';

  -- Copy the whole tree verbatim (branches / convergence / rewards preserved),
  -- retyped as 'main' under the new 'shapes' chain.
  WITH src AS (
    SELECT * FROM class_quests
    WHERE class_id = src_class AND chain = src_chain
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
    'main',           -- retyped as the class's main quest
    'shapes',         -- renamed chain → Skills card reads "SHAPES"
    s.branch,         -- keep combos / straddle / tuck / mixed
    s.order_index,
    s.name,
    s.lvl_reward,
    s.is_convergence, -- keep the MIXED convergence so its layout stays centered
    (SELECT COALESCE(array_agg(m2.new_id), '{}')::uuid[]
       FROM unnest(COALESCE(s.prerequisites, '{}')) AS p(old)
       JOIN idmap m2 ON m2.old_id = p.old),
    s.requirement_text
  FROM src s
  JOIN idmap m ON m.old_id = s.id;

  RAISE NOTICE 'Handstand III (class %) SHAPES: copied % nodes from static chain "%"',
    tgt_class,
    (SELECT count(*) FROM class_quests
       WHERE class_id = tgt_class AND lower(chain) = 'shapes' AND quest_type = 'main'),
    src_chain;
END $$;
