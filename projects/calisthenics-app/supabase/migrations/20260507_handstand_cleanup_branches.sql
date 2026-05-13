-- =============================================================================
-- Handstand cleanup: branches, prerequisites, and convergence flags
-- =============================================================================
--
-- The handstand chain has exactly 3 branches: power, balance, mobility.
-- Earlier work mistakenly created `power_left`, `power_right`, and
-- `freestanding` branches. This migration:
--
--   1. Re-assigns every misplaced node to its correct branch.
--   2. Re-derives all prerequisites from scratch (name-based lookups, no UUIDs).
--   3. Re-asserts is_convergence so ONLY the two true merge nodes are flagged:
--        - HS Disconnections 2 sec  (power + mobility → births balance)
--        - Freestanding 20 sec      (internal balance merge)
--
-- Does NOT touch the oapu or hspu chains.
--
-- =============================================================================

-- ─── 1. Re-assign branch column for misplaced handstand nodes ────────────────

UPDATE class_quests
SET    branch = 'balance'
WHERE  chain = 'handstand'
  AND  name IN (
    'HS Disconnections 2 sec',
    'HS Disconnections 5 sec',
    'HS Disconnections 10 sec',
    'HS Disconnections 20 sec',
    'Freestanding 5 sec',
    'Freestanding 10 sec',
    'Freestanding 20 sec',
    'Freestanding 30 sec'
  );

-- ─── 2. Reset is_convergence on all handstand nodes, then flag only the two ──

UPDATE class_quests
SET    is_convergence = FALSE
WHERE  chain = 'handstand';

UPDATE class_quests
SET    is_convergence = TRUE
WHERE  chain = 'handstand'
  AND  name IN (
    'HS Disconnections 2 sec',
    'Freestanding 20 sec'
  );

-- ─── 3. Power branch — straight 4-node column ────────────────────────────────

UPDATE class_quests
SET    prerequisites = '{}'::uuid[]
WHERE  chain = 'handstand' AND name = 'Wall HS Hold 10 sec';

UPDATE class_quests
SET    prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE  chain = 'handstand' AND name = 'Wall HS Hold 10 sec'
)
WHERE  chain = 'handstand' AND name = 'Wall HS Hold 20 sec';

UPDATE class_quests
SET    prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE  chain = 'handstand' AND name = 'Wall HS Hold 20 sec'
)
WHERE  chain = 'handstand' AND name = 'Wall HS Hold 30 sec';

UPDATE class_quests
SET    prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE  chain = 'handstand' AND name = 'Wall HS Hold 30 sec'
)
WHERE  chain = 'handstand' AND name = 'Wall HS Hold 40 sec';

-- ─── 4. Mobility branch — straight 4-node column ─────────────────────────────

UPDATE class_quests
SET    prerequisites = '{}'::uuid[]
WHERE  chain = 'handstand' AND name = 'Superman 5 sec Hold';

UPDATE class_quests
SET    prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE  chain = 'handstand' AND name = 'Superman 5 sec Hold'
)
WHERE  chain = 'handstand' AND name = 'Superman 10 sec Hold';

UPDATE class_quests
SET    prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE  chain = 'handstand' AND name = 'Superman 10 sec Hold'
)
WHERE  chain = 'handstand' AND name = 'Weighted Superman 5 sec';

UPDATE class_quests
SET    prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE  chain = 'handstand' AND name = 'Weighted Superman 5 sec'
)
WHERE  chain = 'handstand' AND name = 'Weighted Superman 10 sec';

-- ─── 5. Balance branch — born from power+mobility merge, internal split+merge ─

-- Birth of balance: power + mobility merge
UPDATE class_quests
SET    prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE  chain = 'handstand'
    AND  name IN ('Wall HS Hold 20 sec', 'Superman 10 sec Hold')
)
WHERE  chain = 'handstand' AND name = 'HS Disconnections 2 sec';

UPDATE class_quests
SET    prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE  chain = 'handstand' AND name = 'HS Disconnections 2 sec'
)
WHERE  chain = 'handstand' AND name = 'HS Disconnections 5 sec';

-- Internal split: HS Disconnections 5 sec → 10 sec  (left)
UPDATE class_quests
SET    prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE  chain = 'handstand' AND name = 'HS Disconnections 5 sec'
)
WHERE  chain = 'handstand' AND name = 'HS Disconnections 10 sec';

-- Internal split: HS Disconnections 5 sec → Freestanding 5 sec  (right)
UPDATE class_quests
SET    prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE  chain = 'handstand' AND name = 'HS Disconnections 5 sec'
)
WHERE  chain = 'handstand' AND name = 'Freestanding 5 sec';

UPDATE class_quests
SET    prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE  chain = 'handstand' AND name = 'HS Disconnections 10 sec'
)
WHERE  chain = 'handstand' AND name = 'HS Disconnections 20 sec';

UPDATE class_quests
SET    prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE  chain = 'handstand' AND name = 'Freestanding 5 sec'
)
WHERE  chain = 'handstand' AND name = 'Freestanding 10 sec';

-- Internal merge: HS Disconnections 20 sec + Freestanding 10 sec → Freestanding 20 sec
UPDATE class_quests
SET    prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE  chain = 'handstand'
    AND  name IN ('HS Disconnections 20 sec', 'Freestanding 10 sec')
)
WHERE  chain = 'handstand' AND name = 'Freestanding 20 sec';

UPDATE class_quests
SET    prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE  chain = 'handstand' AND name = 'Freestanding 20 sec'
)
WHERE  chain = 'handstand' AND name = 'Freestanding 30 sec';

-- ─── 6. Verification ─────────────────────────────────────────────────────────
-- Expected: power = 4, balance = 8, mobility = 4. Total = 16.

SELECT branch, name, prerequisites, is_convergence
FROM   class_quests
WHERE  chain = 'handstand'
ORDER  BY branch, name;
