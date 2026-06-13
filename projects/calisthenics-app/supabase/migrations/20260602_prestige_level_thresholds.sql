-- =============================================================================
-- Migration: Per-class prestige LEVEL thresholds (85 / 100 / 160)
-- =============================================================================
--
-- `classes.prestige_at` (added in 20260524) stays the single source for the
-- LEVEL gate — it drives the progress-bar marker AND the level requirement
-- evaluated in lib/prestige.js. The full prestige gate (specific main quests +
-- 1 Tier II skill) lives in lib/prestige.js, keyed by class order_index; only
-- the level number is stored here.
--
-- Class I  (order_index 0) → 85
-- Class II (order_index 1) → 100   (already 100 from 20260524; reasserted)
-- Class III(order_index 2) → 160
--
-- Re-runnable: sets the same values every run.
--
-- NOTE: the live DB never received 20260524 (the column add), so this migration
-- is self-sufficient — it adds the column first (IF NOT EXISTS) before setting
-- per-class values.
-- =============================================================================

ALTER TABLE classes ADD COLUMN IF NOT EXISTS prestige_at integer NOT NULL DEFAULT 80;

UPDATE classes SET prestige_at = 85  WHERE order_index = 0;
UPDATE classes SET prestige_at = 100 WHERE order_index = 1;
UPDATE classes SET prestige_at = 160 WHERE order_index = 2;

-- ─── Verification ─────────────────────────────────────────────────────────────
-- SELECT name, order_index, prestige_at FROM classes ORDER BY order_index;
--   Class I → 85, Class II → 100, Class III → 160
