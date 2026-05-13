-- =============================================================================
-- Fix: full DAG for the handstand chain + convergence prereqs in oapu / hspu
-- =============================================================================
--
-- Re-derives every prerequisite array for the handstand chain from scratch,
-- and re-asserts is_convergence flags. Also fixes the two known broken
-- convergences in oapu and hspu.
--
-- All lookups go through name-by-chain subqueries — no hardcoded UUIDs.
--
-- =============================================================================

-- ─── 1. Reset is_convergence on all handstand nodes ───────────────────────────

UPDATE class_quests
SET is_convergence = FALSE
WHERE chain = 'handstand';

UPDATE class_quests
SET is_convergence = TRUE
WHERE chain = 'handstand'
  AND name IN (
    'HS Disconnections 5 sec',
    'HS Disconnections 10 sec',
    'Freestanding 5 sec',
    'Freestanding 20 sec'
  );

-- ─── 2. Handstand prerequisites — power branch ────────────────────────────────

UPDATE class_quests
SET prerequisites = '{}'::uuid[]
WHERE chain = 'handstand' AND name = 'Wall HS Hold 10 sec';

UPDATE class_quests
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE chain = 'handstand' AND name = 'Wall HS Hold 10 sec'
)
WHERE chain = 'handstand' AND name = 'Wall HS Hold 20 sec';

UPDATE class_quests
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE chain = 'handstand' AND name = 'Wall HS Hold 20 sec'
)
WHERE chain = 'handstand' AND name = 'Wall HS Hold 30 sec';

UPDATE class_quests
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE chain = 'handstand' AND name = 'Wall HS Hold 30 sec'
)
WHERE chain = 'handstand' AND name = 'Wall HS Hold 40 sec';

-- ─── 3. Handstand prerequisites — balance branch ──────────────────────────────

UPDATE class_quests
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE chain = 'handstand' AND name = 'Wall HS Hold 20 sec'
)
WHERE chain = 'handstand' AND name = 'HS Disconnections 2 sec';

UPDATE class_quests
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE chain = 'handstand'
    AND name IN ('HS Disconnections 2 sec', 'Wall HS Hold 30 sec')
)
WHERE chain = 'handstand' AND name = 'HS Disconnections 5 sec';

UPDATE class_quests
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE chain = 'handstand'
    AND name IN (
      'HS Disconnections 5 sec',
      'Wall HS Hold 40 sec',
      'Weighted Superman 10 sec'
    )
)
WHERE chain = 'handstand' AND name = 'HS Disconnections 10 sec';

UPDATE class_quests
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE chain = 'handstand' AND name = 'HS Disconnections 10 sec'
)
WHERE chain = 'handstand' AND name = 'HS Disconnections 20 sec';

-- ─── 4. Handstand prerequisites — mobility branch ─────────────────────────────

UPDATE class_quests
SET prerequisites = '{}'::uuid[]
WHERE chain = 'handstand' AND name = 'Superman 5 sec Hold';

UPDATE class_quests
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE chain = 'handstand' AND name = 'Superman 5 sec Hold'
)
WHERE chain = 'handstand' AND name = 'Superman 10 sec Hold';

UPDATE class_quests
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE chain = 'handstand' AND name = 'Superman 10 sec Hold'
)
WHERE chain = 'handstand' AND name = 'Weighted Superman 5 sec';

UPDATE class_quests
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE chain = 'handstand' AND name = 'Weighted Superman 5 sec'
)
WHERE chain = 'handstand' AND name = 'Weighted Superman 10 sec';

-- ─── 5. Handstand prerequisites — freestanding branch ─────────────────────────

UPDATE class_quests
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE chain = 'handstand'
    AND name IN (
      'HS Disconnections 5 sec',
      'Wall HS Hold 40 sec',
      'Weighted Superman 10 sec'
    )
)
WHERE chain = 'handstand' AND name = 'Freestanding 5 sec';

UPDATE class_quests
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE chain = 'handstand' AND name = 'Freestanding 5 sec'
)
WHERE chain = 'handstand' AND name = 'Freestanding 10 sec';

UPDATE class_quests
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE chain = 'handstand'
    AND name IN ('HS Disconnections 20 sec', 'Freestanding 10 sec')
)
WHERE chain = 'handstand' AND name = 'Freestanding 20 sec';

UPDATE class_quests
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE chain = 'handstand' AND name = 'Freestanding 20 sec'
)
WHERE chain = 'handstand' AND name = 'Freestanding 30 sec';

-- ─── 6. OAPU convergence: 1 OAPU ──────────────────────────────────────────────

UPDATE class_quests
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE chain = 'oapu'
    AND name IN (
      '3 Negative OAPU x5 sec each',
      '12 sec Active Hold',
      '3 OAPU with band/finger'
    )
)
WHERE chain = 'oapu' AND name = '1 OAPU';

-- ─── 7. HSPU convergence: 1 HSPU ──────────────────────────────────────────────

UPDATE class_quests
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE chain = 'hspu'
    AND name IN ('8 HSPU Wall', 'HS Hold 20 sec x3 in a row')
)
WHERE chain = 'hspu' AND name = '1 HSPU';

-- ─── 8. Verification ──────────────────────────────────────────────────────────

SELECT chain,
       name,
       branch,
       order_index,
       is_convergence,
       COALESCE(array_length(prerequisites, 1), 0) AS prereq_count
FROM   class_quests
WHERE  chain IN ('handstand', 'oapu', 'hspu')
ORDER  BY chain, branch, order_index;
