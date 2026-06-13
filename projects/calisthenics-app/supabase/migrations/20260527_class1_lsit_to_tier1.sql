-- =============================================================================
-- Migration: Move Class I side chain `lsit` from Tier 2 → Tier 1
-- =============================================================================
--
-- Tiers are structural: a side chain is Tier 2 iff its first node
-- (order_index 0) is a cross-chain convergence. To demote lsit to Tier 1:
--   1. Clear is_convergence and prerequisites on lsit's order_index 0 node.
--   2. Extend every remaining Tier 2 chain's convergence prereqs to include
--      lsit's leaf (last order_index of branch 'main'), so Tier 2 still gates
--      on ALL Tier 1 side leaves.
-- =============================================================================

-- ─── 1. Demote lsit's first node to a normal start ────────────────────────────

UPDATE class_quests
SET is_convergence = false,
    prerequisites  = '{}'::uuid[]
WHERE class_id = (SELECT id FROM classes WHERE name = 'Class I')
  AND quest_type = 'side'
  AND chain      = 'lsit'
  AND order_index = 0;

-- ─── 2. Add lsit leaf to every remaining Tier 2 chain's convergence prereqs ───

WITH cls AS (SELECT id FROM classes WHERE name = 'Class I'),
lsit_leaf AS (
  SELECT id
  FROM class_quests
  WHERE class_id = (SELECT id FROM cls)
    AND quest_type = 'side'
    AND chain = 'lsit'
    AND order_index = (
      SELECT MAX(order_index)
      FROM class_quests
      WHERE class_id = (SELECT id FROM cls)
        AND quest_type = 'side'
        AND chain = 'lsit'
    )
)
UPDATE class_quests cq
SET prerequisites = (
  SELECT ARRAY(SELECT DISTINCT unnest(cq.prerequisites || ARRAY(SELECT id FROM lsit_leaf)))
)
WHERE cq.class_id = (SELECT id FROM cls)
  AND cq.quest_type = 'side'
  AND cq.is_convergence = true
  AND cq.chain IN ('pull_over', 'archer_pull_up', 'archer_push_up');

-- ─── Verification ─────────────────────────────────────────────────────────────
-- a) lsit/order_index 0 ('Tuck L-sit 10 sec'): is_convergence=false, prereq=[].
-- b) pull_over/archer_pull_up/archer_push_up first nodes: prereq length = 4
--    (frog leaf, headstand/disconnection leaf, headstand/freestanding leaf,
--     lsit leaf).
