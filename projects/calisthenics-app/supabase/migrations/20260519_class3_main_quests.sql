-- =============================================================================
-- Migration: Class III + main quests (front_lever, planche)
-- =============================================================================
--
-- Data-only migration. No schema changes. Inserts the Class III row and its
-- two main-quest chains. Tiers are implemented purely via the existing
-- `prerequisites` array (NO tier column): the first node of every Tier 2
-- branch is a convergence node whose prerequisites are the LAST nodes of
-- every Tier 1 branch in the same chain.
--
-- order_index is CONTINUOUS within a branch across tiers (Tier 1 = 0..N,
-- Tier 2 = N+1..M) so the generic same-branch sequential-prereq UPDATE chains
-- each Tier 2 node onto its predecessor (incl. the convergence node).
-- =============================================================================

-- ─── 1. Insert Class III ──────────────────────────────────────────────────────

INSERT INTO classes (id, name, order_index, description)
SELECT
  gen_random_uuid(),
  'Class III',
  2,
  'Elite static strength — Front Lever and Planche progressions.'
WHERE NOT EXISTS (SELECT 1 FROM classes WHERE name = 'Class III');

-- ─── 2. Insert front_lever nodes (prerequisites = '{}' on first pass) ─────────

INSERT INTO class_quests
  (id, class_id, quest_type, chain, branch, order_index, name, lvl_reward, is_convergence, prerequisites)
SELECT
  gen_random_uuid(), cls.id, 'main', 'front_lever',
  v.branch::text, v.ord::int, v.name::text, v.reward::int, v.conv::boolean, '{}'::uuid[]
FROM (SELECT id FROM classes WHERE name = 'Class III') cls,
(VALUES
  -- Tier 1 · hold (0..8)
  ('hold',     0, '3 sec Tuck',                       0, false),
  ('hold',     1, '8 sec Tuck',                       0, false),
  ('hold',     2, '15 sec Tuck',                      0, false),
  ('hold',     3, '2 sec Advance Tuck',               0, false),
  ('hold',     4, '7 sec Advance Tuck',               0, false),
  ('hold',     5, '12 sec Advance Tuck',              0, false),
  ('hold',     6, '2 sec Super Advance Tuck',         0, false),
  ('hold',     7, '6 sec Super Advance Tuck',         0, false),
  ('hold',     8, '10 sec Super Advance Tuck',        0, false),
  -- Tier 1 · raises (0..8)
  ('raises',   0, '1 Tuck Raises',                    0, false),
  ('raises',   1, '3 Tuck Raises',                    0, false),
  ('raises',   2, '5 Tuck Raises',                    0, false),
  ('raises',   3, '1 Advance Tuck Raises',            0, false),
  ('raises',   4, '3 Advance Tuck Raises',            0, false),
  ('raises',   5, '5 Advance Tuck Raises',            0, false),
  ('raises',   6, '1 Super Advance Tuck Raises',      0, false),
  ('raises',   7, '3 Super Advance Tuck Raises',      0, false),
  ('raises',   8, '5 Super Advance Tuck Raises',      0, false),
  -- Tier 2 · hold (9..13) — first node is tier-crossing convergence
  ('hold',     9, 'Incline Front 5 sec',              0, true),
  ('hold',    10, 'Incline Front 10 sec',             0, false),
  ('hold',    11, 'Front Lever Stop',                 0, false),
  ('hold',    12, 'Front Lever 3 sec',                0, false),
  ('hold',    13, 'Front Lever 5 sec',                0, false),
  -- Tier 2 · raises (9..12) — first node is tier-crossing convergence
  ('raises',   9, '1 Front Raises',                   0, true),
  ('raises',  10, '3 Front Raises',                   0, false),
  ('raises',  11, '5 Front Raises',                   0, false),
  ('raises',  12, '7 Front Raises',                   0, false),
  -- Tier 2 · negative (9..13) — first node is tier-crossing convergence
  ('negative', 9, '1 Negative 3 sec',                 0, true),
  ('negative',10, '2 Negative 3 sec',                 0, false),
  ('negative',11, '3 Negative 3 sec',                 0, false),
  ('negative',12, '1 Negative 5 sec',                 0, false),
  ('negative',13, '1 Negative 7 sec',                 0, false)
) v(branch, ord, name, reward, conv);

-- ─── 3. Insert planche nodes (prerequisites = '{}' on first pass) ─────────────

INSERT INTO class_quests
  (id, class_id, quest_type, chain, branch, order_index, name, lvl_reward, is_convergence, prerequisites)
SELECT
  gen_random_uuid(), cls.id, 'main', 'planche',
  v.branch::text, v.ord::int, v.name::text, v.reward::int, v.conv::boolean, '{}'::uuid[]
FROM (SELECT id FROM classes WHERE name = 'Class III') cls,
(VALUES
  -- Tier 1 · hold (0..8)
  ('hold',     0, '3 sec Tuck',                       0, false),
  ('hold',     1, '8 sec Tuck',                       0, false),
  ('hold',     2, '15 sec Tuck',                      0, false),
  ('hold',     3, '2 sec Advance Tuck',               0, false),
  ('hold',     4, '7 sec Advance Tuck',               0, false),
  ('hold',     5, '12 sec Advance Tuck',              0, false),
  ('hold',     6, '2 sec Super Advance Tuck',         0, false),
  ('hold',     7, '6 sec Super Advance Tuck',         0, false),
  ('hold',     8, '10 sec Super Advance Tuck',        0, false),
  -- Tier 1 · press (0..2)
  ('press',    0, '1 Tuck Press',                     0, false),
  ('press',    1, '2 Tuck Press',                     0, false),
  ('press',    2, '3 Tuck Press',                     0, false),
  -- Tier 1 · negative (0..2)
  ('negative', 0, 'Negative Tuck to 10 sec Hold',            0, false),
  ('negative', 1, 'Negative Advance Tuck to 8 sec Hold',     0, false),
  ('negative', 2, 'Negative Super Advance Tuck to 6 sec Hold', 0, false),
  -- Tier 2 · hold (9..12) — first node is tier-crossing convergence
  ('hold',     9, 'Full Planche Stop',               0, true),
  ('hold',    10, '2 sec Full Planche',              0, false),
  ('hold',    11, '3 sec Full Planche',              0, false),
  ('hold',    12, '5 sec Full Planche',              0, false),
  -- Tier 2 · negative (9..13) — first node is tier-crossing convergence
  ('negative', 9, '1 Negative 3 sec',                0, true),
  ('negative',10, '2 Negative 3 sec',                0, false),
  ('negative',11, '3 Negative 3 sec',                0, false),
  ('negative',12, '1 Negative 5 sec',                0, false),
  ('negative',13, '1 Negative 7 sec',                0, false)
) v(branch, ord, name, reward, conv);

-- ─── 4. Generic same-branch sequential prerequisites (excludes convergence) ───

WITH cls AS (SELECT id FROM classes WHERE name = 'Class III')
UPDATE class_quests cq
SET prerequisites = ARRAY[prev.id]
FROM class_quests prev, cls
WHERE cq.class_id      = cls.id
  AND prev.class_id    = cls.id
  AND prev.chain       = cq.chain
  AND prev.branch IS NOT DISTINCT FROM cq.branch
  AND prev.order_index = cq.order_index - 1
  AND NOT cq.is_convergence;

-- ─── 5. Tier-crossing convergence prerequisites ───────────────────────────────
-- First node of each Tier 2 branch ← last node of EVERY Tier 1 branch in chain.

-- front_lever · Tier 2 first nodes ← FL T1 hold last + FL T1 raises last
WITH cls AS (SELECT id FROM classes WHERE name = 'Class III')
UPDATE class_quests cq
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE class_id = (SELECT id FROM cls)
    AND chain = 'front_lever'
    AND name IN (
      '10 sec Super Advance Tuck',   -- last of Tier 1 hold
      '5 Super Advance Tuck Raises'  -- last of Tier 1 raises
    )
)
FROM cls
WHERE cq.class_id = cls.id
  AND cq.chain = 'front_lever'
  AND cq.name IN ('Incline Front 5 sec', '1 Front Raises', '1 Negative 3 sec');

-- planche · Tier 2 first nodes ← PL T1 hold last + PL T1 press last + PL T1 negative last
WITH cls AS (SELECT id FROM classes WHERE name = 'Class III')
UPDATE class_quests cq
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE class_id = (SELECT id FROM cls)
    AND chain = 'planche'
    AND name IN (
      '10 sec Super Advance Tuck',               -- last of Tier 1 hold
      '3 Tuck Press',                            -- last of Tier 1 press
      'Negative Super Advance Tuck to 6 sec Hold' -- last of Tier 1 negative
    )
)
FROM cls
WHERE cq.class_id = cls.id
  AND cq.chain = 'planche'
  AND cq.name IN ('Full Planche Stop', '1 Negative 3 sec');

-- ─── Verification ─────────────────────────────────────────────────────────────
-- a) Class III appears at order_index 2:
--    SELECT name, order_index FROM classes ORDER BY order_index;
-- b) Node counts per branch:
--    front_lever/hold=14, front_lever/raises=13, front_lever/negative=5,
--    planche/hold=13, planche/press=3, planche/negative=8
-- c) Tier 2 first-node prereq array lengths: front_lever=2, planche=3.
