-- =============================================================================
-- Migration: Class I side quest — archer_push_up (Tier 2)
-- =============================================================================
--
-- Data-only. Adds a new Tier 2 side chain in Class I. Tier is expressed
-- structurally: order_index 0 is a cross-tier convergence node whose
-- prerequisites are L = leaves of every branch of every Tier 1 side chain
-- (frog, headstand). Same pattern as 20260522_class1_side_quests.sql.
--
-- Re-runnable: deletes any prior copy of this chain before inserting.
-- =============================================================================

-- ─── 0. Idempotency ───────────────────────────────────────────────────────────

DELETE FROM class_quests
WHERE class_id = (SELECT id FROM classes WHERE name = 'Class I')
  AND quest_type = 'side'
  AND chain = 'archer_push_up';

-- ─── 1. Insert archer_push_up (single linear branch, 5 nodes) ─────────────────

INSERT INTO class_quests
  (id, class_id, quest_type, chain, branch, order_index, name, lvl_reward, is_convergence, prerequisites)
SELECT
  gen_random_uuid(), cls.id, 'side', 'archer_push_up',
  v.branch::text, v.ord::int, v.name::text, v.reward::int, v.conv::boolean, '{}'::uuid[]
FROM (SELECT id FROM classes WHERE name = 'Class I') cls,
(VALUES
  ('main', 0, '20 Push-ups',              0, true),
  ('main', 1, '2 Knee Archer Push-ups',   0, false),
  ('main', 2, '8 Knee Archer Push-ups',   0, false),
  ('main', 3, '2 Archer Push-ups',        0, false),
  ('main', 4, '10 Archer Push-ups',       0, false)
) v(branch, ord, name, reward, conv);

-- ─── 2. Same-branch sequential prerequisites (excl. convergence first node) ───

WITH cls AS (SELECT id FROM classes WHERE name = 'Class I')
UPDATE class_quests cq
SET prerequisites = ARRAY[prev.id]
FROM class_quests prev, cls
WHERE cq.class_id      = cls.id
  AND prev.class_id    = cls.id
  AND cq.quest_type    = 'side'
  AND prev.quest_type  = 'side'
  AND cq.chain         = 'archer_push_up'
  AND prev.chain       = 'archer_push_up'
  AND prev.branch IS NOT DISTINCT FROM cq.branch
  AND prev.order_index = cq.order_index - 1
  AND NOT cq.is_convergence;

-- ─── 3. Cross-tier convergence: first node ← leaves of every Tier 1 chain ─────

WITH cls AS (SELECT id FROM classes WHERE name = 'Class I'),
maxord AS (
  SELECT chain, branch, MAX(order_index) AS mo
  FROM class_quests
  WHERE class_id = (SELECT id FROM cls)
    AND quest_type = 'side'
    AND chain IN ('frog', 'headstand')
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
    AND cq.chain IN ('frog', 'headstand')
)
UPDATE class_quests cq
SET prerequisites = ARRAY(SELECT id FROM leaves)
WHERE cq.class_id = (SELECT id FROM cls)
  AND cq.quest_type = 'side'
  AND cq.chain = 'archer_push_up'
  AND cq.order_index = 0;

-- ─── Verification ─────────────────────────────────────────────────────────────
-- a) archer_push_up/main has 5 rows.
-- b) order_index 0 ('20 Push-ups') is_convergence=true, prereq length = 3
--    (Frog 10 sec, 20 sec Disconnection from Wall, 20 sec Freestanding).
-- c) Nodes 1..4 each have exactly one prereq = previous node in 'main'.
