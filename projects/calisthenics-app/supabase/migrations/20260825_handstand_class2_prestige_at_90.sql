-- Handstand Class II prestige line: LVL 90 ───────────────────────────────────
--
-- The level gate is only the FIRST of Class II's prestige requirements; the
-- others (the BALANCE hidden challenge "HS Scale", HSPU's "2 HSPU", and one
-- Tier-2 side chain) live in lib/prestige.js under
-- PRESTIGE_REQUIREMENTS.handstand[1].
--
-- `classes.prestige_at` stays the single source for the level line: it drives
-- both the marker on the LVL bar and the `Reach LVL n` check in
-- evaluatePrestige(). Scoped to the handstand job's second class only, so the
-- static ladder's thresholds (85 / 100 / 160) are untouched. Idempotent.

UPDATE public.classes
SET prestige_at = 90
WHERE job = 'handstand' AND order_index = 1;

-- Verify:
-- SELECT name, job, order_index, prestige_at FROM classes ORDER BY job, order_index;
