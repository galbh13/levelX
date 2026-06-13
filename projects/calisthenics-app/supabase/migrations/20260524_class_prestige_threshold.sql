-- Per-class prestige threshold.
--
-- The progress bar's MAX is derived at render time (sum of every quest's
-- lvl_reward in the class), so it is NOT stored. Only the prestige line is
-- configurable per class via this column. Default 80 preserves the prior
-- behaviour for every existing class.
ALTER TABLE classes ADD COLUMN IF NOT EXISTS prestige_at integer NOT NULL DEFAULT 80;

-- Class II (order_index = 1) prestiges at 100 (its quests sum to ~120 max).
UPDATE classes SET prestige_at = 100 WHERE order_index = 1;
