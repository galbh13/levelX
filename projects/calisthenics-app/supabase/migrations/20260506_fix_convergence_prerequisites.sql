-- =============================================================================
-- Fix: convergence-node prerequisites for Class II
-- =============================================================================
--
-- Several convergence nodes were left with a single sequential prerequisite
-- (from the generic same-branch UPDATE) instead of the multi-branch array
-- they actually need. Re-set them here, scoped to Class II.
--
-- =============================================================================

-- ─── handstand ────────────────────────────────────────────────────────────────

-- HS Disconnections 10 sec ← HS Disc 5 sec + Wall HS Hold 40 sec + Weighted Superman 10 sec
UPDATE class_quests
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE class_id = (SELECT id FROM classes WHERE name = 'Class II')
    AND chain = 'handstand'
    AND name IN (
      'HS Disconnections 5 sec',
      'Wall HS Hold 40 sec',
      'Weighted Superman 10 sec'
    )
)
WHERE class_id = (SELECT id FROM classes WHERE name = 'Class II')
  AND chain = 'handstand'
  AND name  = 'HS Disconnections 10 sec';

-- Freestanding 5 sec ← HS Disc 5 sec + Wall HS Hold 40 sec + Weighted Superman 10 sec
UPDATE class_quests
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE class_id = (SELECT id FROM classes WHERE name = 'Class II')
    AND chain = 'handstand'
    AND name IN (
      'HS Disconnections 5 sec',
      'Wall HS Hold 40 sec',
      'Weighted Superman 10 sec'
    )
)
WHERE class_id = (SELECT id FROM classes WHERE name = 'Class II')
  AND chain = 'handstand'
  AND name  = 'Freestanding 5 sec';

-- Freestanding 20 sec ← HS Disc 20 sec + Freestanding 10 sec
UPDATE class_quests
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE class_id = (SELECT id FROM classes WHERE name = 'Class II')
    AND chain = 'handstand'
    AND name IN (
      'HS Disconnections 20 sec',
      'Freestanding 10 sec'
    )
)
WHERE class_id = (SELECT id FROM classes WHERE name = 'Class II')
  AND chain = 'handstand'
  AND name  = 'Freestanding 20 sec';

-- ─── oapu ─────────────────────────────────────────────────────────────────────

-- 1 OAPU ← 3 Negative OAPU x5 sec each + 12 sec Active Hold + 3 OAPU with band/finger
UPDATE class_quests
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE class_id = (SELECT id FROM classes WHERE name = 'Class II')
    AND chain = 'oapu'
    AND name IN (
      '3 Negative OAPU x5 sec each',
      '12 sec Active Hold',
      '3 OAPU with band/finger'
    )
)
WHERE class_id = (SELECT id FROM classes WHERE name = 'Class II')
  AND chain = 'oapu'
  AND name  = '1 OAPU';

-- ─── hspu ─────────────────────────────────────────────────────────────────────

-- 1 HSPU ← 8 HSPU Wall + HS Hold 20 sec x3 in a row
UPDATE class_quests
SET prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE class_id = (SELECT id FROM classes WHERE name = 'Class II')
    AND chain = 'hspu'
    AND name IN (
      '8 HSPU Wall',
      'HS Hold 20 sec x3 in a row'
    )
)
WHERE class_id = (SELECT id FROM classes WHERE name = 'Class II')
  AND chain = 'hspu'
  AND name  = '1 HSPU';

-- ─── Verification ─────────────────────────────────────────────────────────────
-- Run this after applying. Expected counts:
--   handstand · HS Disconnections 10 sec   → 3
--   handstand · Freestanding 5 sec         → 3
--   handstand · Freestanding 20 sec        → 2
--   oapu      · 1 OAPU                     → 3
--   hspu      · 1 HSPU                     → 2

SELECT chain,
       name,
       COALESCE(array_length(prerequisites, 1), 0) AS prereq_count
FROM   class_quests
WHERE  is_convergence = TRUE
ORDER  BY chain, name;
