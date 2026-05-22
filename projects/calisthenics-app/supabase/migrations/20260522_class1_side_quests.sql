-- =============================================================================
-- Migration: Class I side quests (frog, headstand, lsit, pull_over)
-- =============================================================================
--
-- Data-only migration. No schema changes. Inserts all Class I SIDE quests from
-- the hand-drawn plan. Two side-quest tiers gated CROSS-CHAIN via the existing
-- `prerequisites` array (no tier column) — same pattern as
-- 20260519_class3_side_quests.sql:
--   Tier 1 chains: frog, headstand
--   Tier 2 chains: lsit, pull_over
-- The first node of every Tier 2 chain is a convergence node whose prerequisites
-- are L = the last (max order_index) node of every branch of every Tier 1 chain,
-- so a Tier 2 side quest unlocks only after ALL Tier 1 side quests are done.
--
-- order_index is per-branch, 0-based, sequential. Every node: quest_type='side',
-- lvl_reward=0 (matches existing side quests). All writes are scoped to
-- quest_type='side' AND chain IN (the four new chains) so no other Class I data
-- is touched. Re-runnable: the four chains are deleted first.
-- =============================================================================

-- ─── 0. Idempotency — drop any prior copy of these four Class I side chains ────

DELETE FROM class_quests
WHERE class_id = (SELECT id FROM classes WHERE name = 'Class I')
  AND quest_type = 'side'
  AND chain IN ('frog', 'headstand', 'lsit', 'pull_over');

-- ─── 1. Insert frog (Tier 1, single linear branch) ────────────────────────────

INSERT INTO class_quests
  (id, class_id, quest_type, chain, branch, order_index, name, lvl_reward, is_convergence, prerequisites)
SELECT
  gen_random_uuid(), cls.id, 'side', 'frog',
  v.branch::text, v.ord::int, v.name::text, v.reward::int, v.conv::boolean, '{}'::uuid[]
FROM (SELECT id FROM classes WHERE name = 'Class I') cls,
(VALUES
  ('main', 0, 'Frog Float 10 sec', 0, false),
  ('main', 1, 'Frog 5 sec',        0, false),
  ('main', 2, 'Frog 10 sec',       0, false)
) v(branch, ord, name, reward, conv);

-- ─── 2. Insert headstand (Tier 1) — two independent branches ──────────────────

INSERT INTO class_quests
  (id, class_id, quest_type, chain, branch, order_index, name, lvl_reward, is_convergence, prerequisites)
SELECT
  gen_random_uuid(), cls.id, 'side', 'headstand',
  v.branch::text, v.ord::int, v.name::text, v.reward::int, v.conv::boolean, '{}'::uuid[]
FROM (SELECT id FROM classes WHERE name = 'Class I') cls,
(VALUES
  ('disconnection', 0, '5 sec Disconnection from Wall',  0, false),
  ('disconnection', 1, '10 sec Disconnection from Wall', 0, false),
  ('disconnection', 2, '20 sec Disconnection from Wall', 0, false),
  ('freestanding',  0, '3 sec Freestanding',  0, false),
  ('freestanding',  1, '7 sec Freestanding',  0, false),
  ('freestanding',  2, '12 sec Freestanding', 0, false),
  ('freestanding',  3, '20 sec Freestanding', 0, false)
) v(branch, ord, name, reward, conv);

-- ─── 3. Insert Tier 2 chains (lsit, pull_over) ────────────────────────────────
-- order_index 0 of every chain is a cross-tier convergence node.

INSERT INTO class_quests
  (id, class_id, quest_type, chain, branch, order_index, name, lvl_reward, is_convergence, prerequisites)
SELECT
  gen_random_uuid(), cls.id, 'side', v.chain::text,
  v.branch::text, v.ord::int, v.name::text, v.reward::int, v.conv::boolean, '{}'::uuid[]
FROM (SELECT id FROM classes WHERE name = 'Class I') cls,
(VALUES
  -- lsit (Pull-up bar / dip bar L-sit)
  ('lsit', 'main', 0, 'Tuck L-sit 10 sec',                   0, true),
  ('lsit', 'main', 1, 'One Leg Extended L-sit 8 sec (both)', 0, false),
  ('lsit', 'main', 2, 'L-sit 2 sec',                         0, false),
  ('lsit', 'main', 3, 'L-sit 6 sec',                         0, false),
  ('lsit', 'main', 4, 'L-sit 10 sec',                        0, false),
  -- pull_over
  ('pull_over', 'main', 0, '10 Pull-ups',           0, true),
  ('pull_over', 'main', 1, '1 Pull Over',           0, false),
  ('pull_over', 'main', 2, '3 Pull Overs in a Row', 0, false)
) v(chain, branch, ord, name, reward, conv);

-- ─── 4. Same-branch sequential prerequisites (excl. convergence first nodes) ──

WITH cls AS (SELECT id FROM classes WHERE name = 'Class I')
UPDATE class_quests cq
SET prerequisites = ARRAY[prev.id]
FROM class_quests prev, cls
WHERE cq.class_id      = cls.id
  AND prev.class_id    = cls.id
  AND cq.quest_type    = 'side'
  AND prev.quest_type  = 'side'
  AND cq.chain IN ('frog', 'headstand', 'lsit', 'pull_over')
  AND prev.chain       = cq.chain
  AND prev.branch IS NOT DISTINCT FROM cq.branch
  AND prev.order_index = cq.order_index - 1
  AND NOT cq.is_convergence;

-- ─── 5. Cross-tier convergence: Tier 2 first nodes ← L (Tier 1 side leaves) ────
-- L = last (max order_index) node of every branch of every Tier 1 side chain.

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
  AND cq.chain IN ('lsit', 'pull_over')
  AND cq.order_index = 0;

-- ─── Verification ─────────────────────────────────────────────────────────────
-- a) Counts per (chain, branch) — expected:
--    frog/main=3,
--    headstand/disconnection=3, headstand/freestanding=4,
--    lsit/main=5, pull_over/main=3
-- b) Each Tier 2 first node (order_index 0) has prereq array length = 3 (=|L|:
--    Frog 10 sec, 20 sec Disconnection from Wall, 20 sec Freestanding).
-- c) lsit/'Tuck L-sit 10 sec' and pull_over/'10 Pull-ups' are is_convergence.
