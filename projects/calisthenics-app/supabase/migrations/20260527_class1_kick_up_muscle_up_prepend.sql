-- =============================================================================
-- Migration: Prepend '3 Chest Pull-ups' to Class I side chain kick_up_muscle_up
-- =============================================================================
--
-- Inserts a new node at the start of the kick_up_muscle_up/main chain. The new
-- node takes over the Tier-2 convergence role (carrying the original first
-- node's cross-tier prerequisites); existing nodes shift +1 in order_index and
-- the original first node becomes a normal sequential node prereq'd on the new
-- one.
--
-- Re-runnable: skips the insert if a node named '3 Chest Pull-ups' already
-- exists in this chain.
-- =============================================================================

DO $$
DECLARE
  v_class_id      uuid;
  v_old_first_id  uuid;
  v_old_first_conv boolean;
  v_old_first_prereqs uuid[];
  v_new_id        uuid := gen_random_uuid();
BEGIN
  SELECT id INTO v_class_id FROM classes WHERE name = 'Class I';

  -- Idempotency: bail if already inserted
  IF EXISTS (
    SELECT 1 FROM class_quests
    WHERE class_id = v_class_id
      AND quest_type = 'side'
      AND chain = 'kick_up_muscle_up'
      AND name = '3 Chest Pull-ups'
  ) THEN
    RETURN;
  END IF;

  -- Capture the current order-0 node's convergence flag + prereqs
  SELECT id, is_convergence, prerequisites
    INTO v_old_first_id, v_old_first_conv, v_old_first_prereqs
  FROM class_quests
  WHERE class_id = v_class_id
    AND quest_type = 'side'
    AND chain = 'kick_up_muscle_up'
    AND branch = 'main'
    AND order_index = 0;

  -- Shift every existing node in chain by +1 (descending to avoid uniqueness clash)
  UPDATE class_quests
  SET order_index = order_index + 1
  WHERE class_id = v_class_id
    AND quest_type = 'side'
    AND chain = 'kick_up_muscle_up';

  -- Insert the new first node, inheriting the old first node's tier role
  INSERT INTO class_quests
    (id, class_id, quest_type, chain, branch, order_index, name, lvl_reward, is_convergence, prerequisites)
  VALUES
    (v_new_id, v_class_id, 'side', 'kick_up_muscle_up', 'main', 0,
     '3 Chest Pull-ups', 0, v_old_first_conv, v_old_first_prereqs);

  -- The previously-first node (now order 1) becomes a normal sequential node
  UPDATE class_quests
  SET is_convergence = false,
      prerequisites  = ARRAY[v_new_id]
  WHERE id = v_old_first_id;
END $$;

-- ─── Verification ─────────────────────────────────────────────────────────────
-- a) kick_up_muscle_up/main now has 3 nodes:
--    0 '3 Chest Pull-ups', 1 'high kick-up pull-up', 2 'kick-up muscle-up'.
-- b) Node 0 carries the tier role previously held by node 1
--    (is_convergence + Tier 1 leaf prereqs).
-- c) Node 1's prereq = [node 0 id]; node 2 unchanged.
