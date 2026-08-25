-- Handstand Class III prestige line: LVL 90 ──────────────────────────────────
--
-- Class III was seeded at 80 (20260716_handstand_shapes_class3.sql). It joins
-- Class I and Class II on 90, so the whole handstand ladder now reads the same
-- level line.
--
-- The level gate is only the FIRST of Class III's prestige requirements; the
-- others (PIKE PRESS "One Pike Press", EXTREME COMBO's 2-rounds node, SHAPES'
-- final "6 Tuck + 6 Straddle", and any ONE side quest) live in lib/prestige.js
-- under PRESTIGE_REQUIREMENTS.handstand[2].
--
-- `classes.prestige_at` stays the single source for the level line: it drives
-- both the marker on the LVL bar and the `Reach LVL n` check in
-- evaluatePrestige(). Scoped to the handstand job's third class only, so the
-- static ladder's thresholds (85 / 100 / 160) are untouched. Idempotent.

UPDATE public.classes
SET prestige_at = 90
WHERE job = 'handstand' AND order_index = 2;

-- Verify:
-- SELECT name, job, order_index, prestige_at FROM classes ORDER BY job, order_index;
