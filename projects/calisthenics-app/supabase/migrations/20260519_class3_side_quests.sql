-- =============================================================================
-- Migration: Class III side quests (vsit, hs_beginners, isit, back_lever, hspu_90)
-- =============================================================================
--
-- Data-only migration. No schema changes. Inserts all Class III SIDE quests.
-- Two side-quest tiers, gated CROSS-CHAIN via the existing `prerequisites`
-- array (no tier column):
--   Tier 1 chains: vsit, hs_beginners
--   Tier 2 chains: isit, back_lever, hspu_90
-- The first node of every Tier 2 branch is a convergence node whose
-- prerequisites are L = the last (max order_index) node of every branch of
-- every Tier 1 side-quest chain.
--
-- order_index is per-branch, 0-based, sequential (matches step-1 main quests).
-- Every node: quest_type='side', lvl_reward=0. All UPDATEs are scoped to
-- quest_type='side' so step-1 main-quest data is never touched.
-- =============================================================================

-- ─── 1. Insert vsit (Tier 1) ──────────────────────────────────────────────────

INSERT INTO class_quests
  (id, class_id, quest_type, chain, branch, order_index, name, lvl_reward, is_convergence, prerequisites)
SELECT
  gen_random_uuid(), cls.id, 'side', 'vsit',
  v.branch::text, v.ord::int, v.name::text, v.reward::int, v.conv::boolean, '{}'::uuid[]
FROM (SELECT id FROM classes WHERE name = 'Class III') cls,
(VALUES
  ('hold',        0, 'L-sit 15 sec',          0, false),
  ('hold',        1, 'Bent knee V-sit 8 sec', 0, false),
  ('hold',        2, 'V-sit 1 sec',           0, false),
  ('hold',        3, 'V-sit 3 sec',           0, false),
  ('hold',        4, 'V-sit 5 sec',           0, false),
  ('strength',    0, 'Tuck V-sit floor 8 sec', 0, false),
  ('strength',    1, 'Tuck V-sit 6 sec',      0, false),
  ('strength',    2, 'Tuck V-sit 10 sec',     0, false),
  ('flexibility', 0, 'Pike Flex lvl 1',       0, false),
  ('flexibility', 1, 'Pike Flex lvl 2',       0, false),
  ('flexibility', 2, 'Pike Flex lvl 3',       0, false)
) v(branch, ord, name, reward, conv);

-- ─── 2. Insert hs_beginners (Tier 1) ──────────────────────────────────────────
-- mixed first node is a within-chain convergence of straddle + tuck.

INSERT INTO class_quests
  (id, class_id, quest_type, chain, branch, order_index, name, lvl_reward, is_convergence, prerequisites)
SELECT
  gen_random_uuid(), cls.id, 'side', 'hs_beginners',
  v.branch::text, v.ord::int, v.name::text, v.reward::int, v.conv::boolean, '{}'::uuid[]
FROM (SELECT id FROM classes WHERE name = 'Class III') cls,
(VALUES
  ('straddle', 0, '1 Straddle Rep',   0, false),
  ('straddle', 1, '3 Straddle Reps',  0, false),
  ('straddle', 2, '5 Straddle Reps',  0, false),
  ('tuck',     0, '1 Tuck Rep',       0, false),
  ('tuck',     1, '3 Tuck Reps',      0, false),
  ('tuck',     2, '5 Tuck Reps',      0, false),
  ('mixed',    0, '4 Tuck + 4 Straddle', 0, true),
  ('mixed',    1, '6 Tuck + 6 Straddle', 0, false),
  ('combos',   0, 'Press to Straddle to Diamond to Tuck and forth',          0, false),
  ('combos',   1, 'Press to Straddle to Diamond to Tuck to Straight to HSPU', 0, false),
  ('combos',   2, 'Press to 2 HSPU to Shapes 3 full rounds',                 0, false)
) v(branch, ord, name, reward, conv);

-- ─── 3. Insert Tier 2 chains (isit, back_lever, hspu_90) ───────────────────────
-- order_index 0 of every branch is a cross-tier convergence node.

INSERT INTO class_quests
  (id, class_id, quest_type, chain, branch, order_index, name, lvl_reward, is_convergence, prerequisites)
SELECT
  gen_random_uuid(), cls.id, 'side', v.chain::text,
  v.branch::text, v.ord::int, v.name::text, v.reward::int, v.conv::boolean, '{}'::uuid[]
FROM (SELECT id FROM classes WHERE name = 'Class III') cls,
(VALUES
  -- isit
  ('isit', 'skill',       0, '5 sec V-sit', 0, true),
  ('isit', 'skill',       1, '1 sec I-sit', 0, false),
  ('isit', 'skill',       2, '3 sec I-sit', 0, false),
  ('isit', 'skill',       3, '5 sec I-sit', 0, false),
  ('isit', 'flexibility', 0, 'Flex lvl 1',  0, true),
  ('isit', 'flexibility', 1, 'Flex lvl 2',  0, false),
  ('isit', 'flexibility', 2, 'Flex lvl 3',  0, false),
  -- back_lever (single linear branch named main)
  ('back_lever', 'main', 0, 'Tuck Back Lever 15 sec',          0, true),
  ('back_lever', 'main', 1, 'Advance Tuck Back Lever 12 sec',  0, false),
  ('back_lever', 'main', 2, 'Super Advance Back Lever 8 sec',  0, false),
  ('back_lever', 'main', 3, 'Incline Back Lever 8 sec',        0, false),
  ('back_lever', 'main', 4, 'Full Back Lever 2 sec',           0, false),
  ('back_lever', 'main', 5, 'Full Back Lever 5 sec',           0, false),
  -- hspu_90
  ('hspu_90', 'bent_arm_strength', 0, 'Bent arm elbow in 8 sec',   0, true),
  ('hspu_90', 'bent_arm_strength', 1, 'Bent arm elbow out 3 sec',  0, false),
  ('hspu_90', 'bent_arm_strength', 2, 'Bent arm elbow out 6 sec',  0, false),
  ('hspu_90', 'bent_arm_strength', 3, 'Bent arm elbow out 10 sec', 0, false),
  ('hspu_90', 'bent_arm_strength', 4, 'Bent arm elbow out 15 sec', 0, false),
  ('hspu_90', 'movement', 0, 'Negative to elbow in 3 sec',  0, true),
  ('hspu_90', 'movement', 1, 'Negative to elbow out 3 sec', 0, false),
  ('hspu_90', 'movement', 2, 'Negative to elbow out 6 sec', 0, false),
  ('hspu_90', 'movement', 3, '90 degree HSPU',              0, false)
) v(chain, branch, ord, name, reward, conv);

-- ─── 4. Generic same-branch sequential prerequisites (side only, excl. conv) ───

WITH cls AS (SELECT id FROM classes WHERE name = 'Class III')
UPDATE class_quests cq
SET prerequisites = ARRAY[prev.id]
FROM class_quests prev, cls
WHERE cq.class_id      = cls.id
  AND prev.class_id    = cls.id
  AND cq.quest_type    = 'side'
  AND prev.quest_type  = 'side'
  AND prev.chain       = cq.chain
  AND prev.branch IS NOT DISTINCT FROM cq.branch
  AND prev.order_index = cq.order_index - 1
  AND NOT cq.is_convergence;

-- ─── 5. mixed within-chain convergence (last straddle + last tuck) ─────────────

WITH cls AS (SELECT id FROM classes WHERE name = 'Class III')
UPDATE class_quests cq
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE class_id = (SELECT id FROM cls)
    AND quest_type = 'side'
    AND chain = 'hs_beginners'
    AND name IN ('5 Straddle Reps', '5 Tuck Reps')
)
FROM cls
WHERE cq.class_id = cls.id
  AND cq.quest_type = 'side'
  AND cq.chain = 'hs_beginners'
  AND cq.name = '4 Tuck + 4 Straddle';

-- ─── 6. Cross-tier convergence: Tier 2 first nodes ← L (Tier 1 side leaves) ────
-- L = last (max order_index) node of every branch of every Tier 1 side chain.

WITH cls AS (SELECT id FROM classes WHERE name = 'Class III'),
maxord AS (
  SELECT chain, branch, MAX(order_index) AS mo
  FROM class_quests
  WHERE class_id = (SELECT id FROM cls)
    AND quest_type = 'side'
    AND chain IN ('vsit', 'hs_beginners')
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
    AND cq.chain IN ('vsit', 'hs_beginners')
)
UPDATE class_quests cq
SET prerequisites = ARRAY(SELECT id FROM leaves)
WHERE cq.class_id = (SELECT id FROM cls)
  AND cq.quest_type = 'side'
  AND cq.chain IN ('isit', 'back_lever', 'hspu_90')
  AND cq.order_index = 0;

-- ─── Verification ─────────────────────────────────────────────────────────────
-- a) Counts per (chain, branch) — expected:
--    vsit/hold=5, vsit/strength=3, vsit/flexibility=3,
--    hs_beginners/straddle=3, hs_beginners/tuck=3, hs_beginners/mixed=2,
--    hs_beginners/combos=3, isit/skill=4, isit/flexibility=3,
--    back_lever/main=6, hspu_90/bent_arm_strength=5, hspu_90/movement=4
-- b) Each Tier 2 first node (order_index 0) has prereq array length = 7 (=|L|).
-- c) hs_beginners/mixed '4 Tuck + 4 Straddle' has 2 prereqs and is_convergence.
