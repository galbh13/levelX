-- =============================================================================
-- Migration: Class II + branch/prerequisites columns + Class I backfill
-- =============================================================================

-- ─── 1a. Schema additions ─────────────────────────────────────────────────────

ALTER TABLE class_quests
  ADD COLUMN IF NOT EXISTS branch           text,
  ADD COLUMN IF NOT EXISTS prerequisites    uuid[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_convergence   boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS requirement_text text;

UPDATE class_quests SET prerequisites = '{}' WHERE prerequisites IS NULL;

-- ─── 1b. Insert Class II ──────────────────────────────────────────────────────

INSERT INTO classes (id, name, order_index, description)
SELECT
  gen_random_uuid(),
  'Class II',
  1,
  'Advanced calisthenics — One Arm Pull-up, Handstand mastery, and Handstand Push-up progressions.'
WHERE NOT EXISTS (SELECT 1 FROM classes WHERE name = 'Class II');

-- ─── 1c. Insert Class II quests (prerequisites = '{}' on first pass) ──────────

-- ── MAIN: oapu ────────────────────────────────────────────────────────────────

INSERT INTO class_quests
  (id, class_id, quest_type, chain, branch, order_index, name, lvl_reward, is_convergence, prerequisites)
SELECT
  gen_random_uuid(), cls.id, 'main', 'oapu',
  v.branch::text, v.ord::int, v.name::text, v.reward::int, v.conv::boolean, '{}'::uuid[]
FROM (SELECT id FROM classes WHERE name = 'Class II') cls,
(VALUES
  ('negative',    0, '1 Negative OAPU with 1 finger',   0,  false),
  ('negative',    1, '3 Negative OAPU with 1 finger',   0,  false),
  ('negative',    2, '1 Negative OAPU',                  0,  false),
  ('negative',    3, '3 Negative OAPU',                  0,  false),
  ('negative',    4, '3 Negative OAPU x5 sec each',      4,  false),
  ('active_hold', 0, '5 sec Active Hold with 1 finger',  0,  false),
  ('active_hold', 1, '10 sec Active Hold with 1 finger', 0,  false),
  ('active_hold', 2, '3 sec Active Hold',                0,  false),
  ('active_hold', 3, '8 sec Active Hold',                0,  false),
  ('active_hold', 4, '12 sec Active Hold',               4,  false),
  ('band',        0, '10 OAPU with band/finger',         0,  false),
  ('band',        1, '2 OAPU with band/finger',          0,  false),
  ('band',        2, '3 OAPU with band/finger',          4,  false),
  ('main',        5, '1 OAPU',                           4,  true),
  ('main',        6, '2 OAPU',                           0,  false),
  ('main',        7, '3 OAPU',                           4,  false)
) v(branch, ord, name, reward, conv);

-- ── MAIN: handstand ───────────────────────────────────────────────────────────

INSERT INTO class_quests
  (id, class_id, quest_type, chain, branch, order_index, name, lvl_reward, is_convergence, prerequisites)
SELECT
  gen_random_uuid(), cls.id, 'main', 'handstand',
  v.branch::text, v.ord::int, v.name::text, v.reward::int, v.conv::boolean, '{}'::uuid[]
FROM (SELECT id FROM classes WHERE name = 'Class II') cls,
(VALUES
  ('power',        0, 'Wall HS Hold 10 sec',         0, false),
  ('power',        1, 'Wall HS Hold 20 sec',         0, false),
  ('power',        2, 'Wall HS Hold 30 sec',         0, false),
  ('power',        3, 'Wall HS Hold 40 sec',         5, false),
  ('balance',      0, 'HS Disconnections 2 sec',     0, false),
  ('balance',      1, 'HS Disconnections 5 sec',     0, false),
  ('balance',      2, 'HS Disconnections 10 sec',    0, true),
  ('balance',      3, 'HS Disconnections 20 sec',    5, false),
  ('mobility',     0, 'Superman 5 sec Hold',         0, false),
  ('mobility',     1, 'Superman 10 sec Hold',        0, false),
  ('mobility',     2, 'Weighted Superman 5 sec',     0, false),
  ('mobility',     3, 'Weighted Superman 10 sec',    0, false),
  ('freestanding', 0, 'Freestanding 5 sec',          0, true),
  ('freestanding', 1, 'Freestanding 10 sec',         5, false),
  ('freestanding', 2, 'Freestanding 20 sec',         0, true),
  ('freestanding', 3, 'Freestanding 30 sec',         5, false)
) v(branch, ord, name, reward, conv);

-- ── MAIN: hspu ────────────────────────────────────────────────────────────────

INSERT INTO class_quests
  (id, class_id, quest_type, chain, branch, order_index, name, lvl_reward, is_convergence, prerequisites)
SELECT
  gen_random_uuid(), cls.id, 'main', 'hspu',
  v.branch::text, v.ord::int, v.name::text, v.reward::int, v.conv::boolean, '{}'::uuid[]
FROM (SELECT id FROM classes WHERE name = 'Class II') cls,
(VALUES
  ('hspu_prog', 0, '1 Negative HSPU Wall',       0, false),
  ('hspu_prog', 1, '3 Negative HSPU Wall',       0, false),
  ('hspu_prog', 2, '1 HSPU Wall',                2, false),
  ('hspu_prog', 3, '3 HSPU Wall',                3, false),
  ('hspu_prog', 4, '8 HSPU Wall',                5, false),
  ('hs_hold',   0, 'HS Hold 20 sec',             0, false),
  ('hs_hold',   1, 'HS Hold 20 sec x3 in a row', 0, false),
  ('main',      5, '1 HSPU',                     5, true),
  ('main',      6, '2 HSPU',                     0, false),
  ('main',      7, '3 HSPU',                     5, false)
) v(branch, ord, name, reward, conv);

-- ── SIDE quests ───────────────────────────────────────────────────────────────

INSERT INTO class_quests
  (id, class_id, quest_type, chain, branch, order_index, name, lvl_reward,
   is_convergence, prerequisites, requirement_text)
SELECT
  gen_random_uuid(), cls.id, 'side',
  v.chain::text, NULL, v.ord::int, v.name::text, v.reward::int,
  false, '{}'::uuid[], v.req_text::text
FROM (SELECT id FROM classes WHERE name = 'Class II') cls,
(VALUES
  ('crow',        0, 'Floor Crow 15 sec',          0,  'Frog 15 sec'),
  ('crow',        1, 'Crow 5 sec',                 10, NULL),
  ('l_sit_floor', 0, 'One Leg L-Sit 10 sec',       0,  'Bar L-Sit 10 sec'),
  ('l_sit_floor', 1, 'L-Sit Floor 5 sec',          10, NULL),
  ('frog_to_hs',  0, 'Frog to HS Wall Assisted',   0,  'Frog unlocked + Freestanding HS 10 sec'),
  ('frog_to_hs',  1, 'Frog to HS',                 10, NULL),
  ('muscle_up',   0, 'Chest Pull Up',              0,  'No Requirements'),
  ('muscle_up',   1, 'Pupik Pull Up',              0,  NULL),
  ('muscle_up',   2, 'Muscle Up',                  10, NULL)
) v(chain, ord, name, reward, req_text);

-- ─── 1c. Set prerequisites (second pass) ─────────────────────────────────────

-- Generic: sequential same-branch prerequisites (excludes convergence nodes)
WITH cls AS (SELECT id FROM classes WHERE name = 'Class II')
UPDATE class_quests cq
SET prerequisites = ARRAY[prev.id]
FROM class_quests prev, cls
WHERE cq.class_id          = cls.id
  AND prev.class_id        = cls.id
  AND prev.chain           = cq.chain
  AND prev.branch IS NOT DISTINCT FROM cq.branch
  AND prev.order_index     = cq.order_index - 1
  AND NOT cq.is_convergence;

-- oapu: convergence at "1 OAPU"
WITH cls AS (SELECT id FROM classes WHERE name = 'Class II')
UPDATE class_quests cq
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE class_id = cls.id AND chain = 'oapu'
    AND name IN ('3 Negative OAPU x5 sec each', '12 sec Active Hold', '3 OAPU with band/finger')
)
FROM cls
WHERE cq.class_id = cls.id AND cq.chain = 'oapu' AND cq.name = '1 OAPU';

-- handstand: "HS Disconnections 2 sec" unlocks after "Wall HS Hold 30 sec" (cross-branch)
WITH cls AS (SELECT id FROM classes WHERE name = 'Class II')
UPDATE class_quests cq
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE class_id = cls.id AND chain = 'handstand' AND name = 'Wall HS Hold 30 sec'
)
FROM cls
WHERE cq.class_id = cls.id AND cq.chain = 'handstand' AND cq.name = 'HS Disconnections 2 sec';

-- handstand: convergence at "HS Disconnections 10 sec"
WITH cls AS (SELECT id FROM classes WHERE name = 'Class II')
UPDATE class_quests cq
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE class_id = cls.id AND chain = 'handstand'
    AND name IN ('HS Disconnections 5 sec', 'Wall HS Hold 40 sec', 'Weighted Superman 10 sec')
)
FROM cls
WHERE cq.class_id = cls.id AND cq.chain = 'handstand' AND cq.name = 'HS Disconnections 10 sec';

-- handstand: convergence at "Freestanding 5 sec"
WITH cls AS (SELECT id FROM classes WHERE name = 'Class II')
UPDATE class_quests cq
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE class_id = cls.id AND chain = 'handstand'
    AND name IN ('HS Disconnections 5 sec', 'Wall HS Hold 40 sec', 'Weighted Superman 10 sec')
)
FROM cls
WHERE cq.class_id = cls.id AND cq.chain = 'handstand' AND cq.name = 'Freestanding 5 sec';

-- handstand: convergence at "Freestanding 20 sec"
WITH cls AS (SELECT id FROM classes WHERE name = 'Class II')
UPDATE class_quests cq
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE class_id = cls.id AND chain = 'handstand'
    AND name IN ('HS Disconnections 20 sec', 'Freestanding 10 sec')
)
FROM cls
WHERE cq.class_id = cls.id AND cq.chain = 'handstand' AND cq.name = 'Freestanding 20 sec';

-- hspu: convergence at "1 HSPU"
WITH cls AS (SELECT id FROM classes WHERE name = 'Class II')
UPDATE class_quests cq
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE class_id = cls.id AND chain = 'hspu'
    AND name IN ('8 HSPU Wall', 'HS Hold 20 sec x3 in a row')
)
FROM cls
WHERE cq.class_id = cls.id AND cq.chain = 'hspu' AND cq.name = '1 HSPU';

-- ─── 1d. Backfill Class I ─────────────────────────────────────────────────────

-- Set branch = 'main' for all Class I quests
UPDATE class_quests
SET branch = 'main'
WHERE class_id = (SELECT id FROM classes WHERE order_index = 0);

-- Set sequential prerequisites: each quest's prereq = previous in same chain
-- First quest in each chain gets '{}' (COALESCE handles the no-prev case)
UPDATE class_quests cq
SET prerequisites = COALESCE(
  (
    SELECT ARRAY[prev.id]
    FROM class_quests prev
    WHERE prev.class_id    = cq.class_id
      AND prev.chain       = cq.chain
      AND prev.order_index = (
        SELECT MAX(p.order_index)
        FROM class_quests p
        WHERE p.class_id    = cq.class_id
          AND p.chain       = cq.chain
          AND p.order_index < cq.order_index
      )
    LIMIT 1
  ),
  '{}'::uuid[]
)
WHERE class_id = (SELECT id FROM classes WHERE order_index = 0);
