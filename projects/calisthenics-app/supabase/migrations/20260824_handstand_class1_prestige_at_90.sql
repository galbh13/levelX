-- Handstand Class I prestige line: LVL 80 → 90 ───────────────────────────────
--
-- The level gate is only the FIRST of Class I's three prestige requirements;
-- the other two (the FOUNDATION hidden challenge + both PUSH branch tips —
-- "16 dips" and "10 pike push-ups") live in lib/prestige.js under
-- PRESTIGE_REQUIREMENTS.handstand[0].
--
-- `classes.prestige_at` stays the single source for the level line: it drives
-- both the marker on the LVL bar and the `Reach LVL n` check in
-- evaluatePrestige(). Scoped to the handstand job's first class only, so the
-- static ladder's thresholds (85 / 100 / 160) are untouched. Idempotent.

UPDATE public.classes
SET prestige_at = 90
WHERE job = 'handstand' AND order_index = 0;

-- Verify:
-- SELECT name, job, order_index, prestige_at FROM classes ORDER BY job, order_index;
