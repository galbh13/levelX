-- =============================================================================
-- Migration: Promote Class II side chain `muscle_up` from Tier 1 → Tier 2
-- =============================================================================
--
-- Tier is structural: a side chain is Tier 2 iff its first node
-- (order_index 0) is_convergence with prerequisites pointing at the leaves of
-- every Tier 1 side chain. Class II Tier 1 side chains (after this change):
-- crow, l_sit_floor, frog_to_hs.
--
-- Re-runnable: the UPDATE sets the same state every run.
-- =============================================================================

WITH cls AS (SELECT id FROM classes WHERE name = 'Class II'),
maxord AS (
  SELECT chain, branch, MAX(order_index) AS mo
  FROM class_quests
  WHERE class_id = (SELECT id FROM cls)
    AND quest_type = 'side'
    AND chain IN ('crow', 'l_sit_floor', 'frog_to_hs')
  GROUP BY chain, branch
),
leaves AS (
  SELECT cq.id
  FROM class_quests cq
  JOIN maxord m
    ON cq.chain = m.chain
   AND cq.branch IS NOT DISTINCT FROM m.branch
   AND cq.order_index = m.mo
  WHERE cq.class_id = (SELECT id FROM cls)
    AND cq.quest_type = 'side'
    AND cq.chain IN ('crow', 'l_sit_floor', 'frog_to_hs')
)
UPDATE class_quests cq
SET is_convergence = true,
    prerequisites  = ARRAY(SELECT id FROM leaves)
WHERE cq.class_id = (SELECT id FROM cls)
  AND cq.quest_type = 'side'
  AND cq.chain      IN ('muscle_up', 'straight_legs_muscle_up')
  AND cq.order_index = 0;

-- ─── Verification ─────────────────────────────────────────────────────────────
-- a) muscle_up/order_index 0 ('Chest Pull Up'): is_convergence=true,
--    prereq length = 3 (Crow 5 sec, L-Sit Floor 5 sec, Frog to HS).
-- b) muscle_up nodes 1 and 2 unchanged.
