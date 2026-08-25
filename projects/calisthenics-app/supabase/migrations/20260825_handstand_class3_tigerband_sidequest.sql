-- Handstand job — CLASS 3 gets a new SIDE quest: "TIGERBAND".
--
-- The smallest quest in the app: ONE node, one branch, and that node IS the
-- quest. Completing it pays the whole reward.
--
--                   ┌──────────────┐
--                   │  TigerBand   │  (+10 LVL)
--                   └──────────────┘
--
-- No prerequisites (Tier 1 — it is not gated behind any other side chain), no
-- convergence, no coach approval. The chain slug is 'TIGERBAND' so the card
-- reads "TIGERBAND", the same way 'SEVEN' does.
--
-- Idempotent: clears any prior copy of this chain (completions included, since
-- the node id is regenerated), then rebuilds.

DO $$
DECLARE
  tgt_class uuid;
  node_id   uuid := gen_random_uuid();
BEGIN
  SELECT id INTO tgt_class
  FROM classes WHERE job = 'handstand' AND order_index = 2
  LIMIT 1;

  IF tgt_class IS NULL THEN
    RAISE EXCEPTION 'Handstand III not found — run 20260716_handstand_shapes_class3.sql first';
  END IF;

  DELETE FROM student_quest_completions
  WHERE quest_id IN (
    SELECT id FROM class_quests
    WHERE class_id = tgt_class AND chain = 'TIGERBAND' AND quest_type = 'side'
  );
  DELETE FROM class_quests
  WHERE class_id = tgt_class AND chain = 'TIGERBAND' AND quest_type = 'side';

  INSERT INTO class_quests
    (id, class_id, quest_type, chain, branch, order_index, name,
     lvl_reward, is_convergence, prerequisites)
  VALUES
    (node_id, tgt_class, 'side', 'TIGERBAND', 'main', 0, 'TigerBand',
     10, false, '{}'::uuid[]);

  RAISE NOTICE 'Handstand III (class %) SIDE quest "TIGERBAND": 1 node, +10 LVL', tgt_class;
END $$;
