-- =============================================================================
-- Fix: HS Disconnections 2 sec prerequisites
-- =============================================================================
-- Corrects the parent nodes for the balance branch birth point.
-- Parents: Wall HS Hold 20 sec (power) + Superman 5 sec Hold (mobility)
-- =============================================================================

UPDATE class_quests
SET    prerequisites = ARRAY(
  SELECT id FROM class_quests
  WHERE  chain = 'handstand'
    AND  name IN ('Wall HS Hold 20 sec', 'Superman 5 sec Hold')
)
WHERE  chain = 'handstand' AND name = 'HS Disconnections 2 sec';

-- ─── Verification ────────────────────────────────────────────────────────────
-- Expected: prereq_names = {Wall HS Hold 20 sec, Superman 5 sec Hold}

SELECT q.name, array_agg(p.name) AS prereq_names
FROM   class_quests q
LEFT   JOIN class_quests p ON p.id = ANY(q.prerequisites)
WHERE  q.chain = 'handstand' AND q.name = 'HS Disconnections 2 sec'
GROUP  BY q.name;
