-- =============================================================================
-- Migration: Class II side quest — crow_to_handstand (Tier 2)
-- =============================================================================
--
-- Two parallel start branches ('a', 'b') merging into a trunk node on branch
-- 'main'. Tier 2 is expressed by the branch-start nodes carrying cross-tier
-- prerequisites = leaves of every Class II Tier 1 side chain
-- (crow, l_sit_floor, frog_to_hs). The trunk convergence merges the two
-- branch starts within this chain.
--
--   a:0  Crow 10 sec                     ─┐                ┌─→ main:0 Crow to Handstand
--   b:0  Negative Crow from Handstand    ─┘                │   (is_convergence; merges a:0 + b:0)
--   (each is_convergence on Tier-1 leaves) ─────────────────┘
--
-- Re-runnable: deletes any prior copy of this chain first.
-- =============================================================================

-- ─── 0. Idempotency ───────────────────────────────────────────────────────────

DELETE FROM class_quests
WHERE class_id = (SELECT id FROM classes WHERE name = 'Class II')
  AND quest_type = 'side'
  AND chain = 'crow_to_handstand';

-- ─── 1. Insert the three nodes ────────────────────────────────────────────────

INSERT INTO class_quests
  (id, class_id, quest_type, chain, branch, order_index, name, lvl_reward, is_convergence, prerequisites)
SELECT
  gen_random_uuid(), cls.id, 'side', 'crow_to_handstand',
  v.branch::text, v.ord::int, v.name::text, v.reward::int, v.conv::boolean, '{}'::uuid[]
FROM (SELECT id FROM classes WHERE name = 'Class II') cls,
(VALUES
  ('a',    0, 'Crow 10 sec',                  0, true),
  ('b',    0, 'Negative Crow from Handstand', 0, true),
  ('main', 0, 'Crow to Handstand',            0, true)
) v(branch, ord, name, reward, conv);

-- ─── 2. Cross-tier prereqs on the two start branches (Tier 2 gating) ──────────

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
SET prerequisites = ARRAY(SELECT id FROM leaves)
WHERE cq.class_id = (SELECT id FROM cls)
  AND cq.quest_type = 'side'
  AND cq.chain = 'crow_to_handstand'
  AND cq.branch IN ('a', 'b');

-- ─── 3. Within-chain convergence: main:0 ← (a:0, b:0) ─────────────────────────

WITH cls AS (SELECT id FROM classes WHERE name = 'Class II'),
starts AS (
  SELECT id FROM class_quests
  WHERE class_id = (SELECT id FROM cls)
    AND quest_type = 'side'
    AND chain = 'crow_to_handstand'
    AND branch IN ('a', 'b')
)
UPDATE class_quests cq
SET prerequisites = ARRAY(SELECT id FROM starts)
WHERE cq.class_id = (SELECT id FROM cls)
  AND cq.quest_type = 'side'
  AND cq.chain = 'crow_to_handstand'
  AND cq.branch = 'main';

-- ─── Verification ─────────────────────────────────────────────────────────────
-- a) 3 rows in chain 'crow_to_handstand'. All is_convergence=true.
-- b) a:0 and b:0 each have prereq length = 3 (Tier 1 leaves).
-- c) main:0 prereq = [a:0 id, b:0 id] (length 2).
