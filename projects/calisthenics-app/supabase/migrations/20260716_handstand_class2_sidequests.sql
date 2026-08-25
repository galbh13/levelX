-- Handstand job — CLASS 2 gets SIDE quests copied from static Class II.
--
-- Copies the static job's Class II SIDE quests into Handstand II (order_index 1):
--   • ALL Tier I side chains (e.g. crow / frog to hs / l-sit floor), and
--   • the Tier II chains "crow to handstand" + "l-sit to handstand",
--   • EXCLUDING the "straight legs muscle up" Tier II chain.
--
-- Selection = every static Class II side chain whose name does NOT contain
-- "muscle" (the one chain to skip). All chosen chains are copied TOGETHER in one
-- id-map so the Tier II chains' cross-chain convergence prerequisites (which point
-- at the Tier I leaves) remap onto the new ids — that cross-chain link is what the
-- app uses to regroup them into TIER I / TIER II. DB-side copy of the LIVE tree:
-- fresh ids, remapped prereqs. Idempotent. The NOTICE lists the chains copied so
-- the selection can be eyeballed.

DO $$
DECLARE
  src_class uuid;
  tgt_class uuid;
BEGIN
  -- Source: static Class II.
  SELECT id INTO src_class
  FROM classes WHERE job = 'static' AND order_index = 1
  LIMIT 1;
  IF src_class IS NULL THEN
    RAISE EXCEPTION 'static Class II (order_index 1) not found';
  END IF;

  -- Target: the handstand job's 2nd class.
  SELECT id INTO tgt_class
  FROM classes WHERE job = 'handstand' AND order_index = 1
  LIMIT 1;
  IF tgt_class IS NULL THEN
    RAISE EXCEPTION 'handstand class 2 not found — run 20260716_handstand_balance_class2.sql first';
  END IF;

  -- Clear any prior copy of these chains so re-running never duplicates.
  DELETE FROM class_quests
  WHERE class_id = tgt_class AND quest_type = 'side'
    AND chain IN (
      SELECT DISTINCT chain FROM class_quests
      WHERE class_id = src_class AND quest_type = 'side' AND chain NOT ILIKE '%muscle%'
    );

  -- Copy every selected side chain together (so cross-chain prereqs remap).
  WITH src AS (
    SELECT * FROM class_quests
    WHERE class_id = src_class AND quest_type = 'side' AND chain NOT ILIKE '%muscle%'
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
    s.chain,
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

  RAISE NOTICE 'Handstand II side quests: copied % nodes across chains: %',
    (SELECT count(*) FROM class_quests
       WHERE class_id = tgt_class AND quest_type = 'side'
         AND chain IN (SELECT DISTINCT chain FROM class_quests
                         WHERE class_id = src_class AND quest_type = 'side' AND chain NOT ILIKE '%muscle%')),
    (SELECT string_agg(DISTINCT chain, ', ')
       FROM class_quests
       WHERE class_id = src_class AND quest_type = 'side' AND chain NOT ILIKE '%muscle%');
END $$;
