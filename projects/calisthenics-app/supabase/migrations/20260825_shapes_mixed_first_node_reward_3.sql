-- SHAPES (Handstand III) — '4 Tuck + 4 Straddle' reward: +4 → +3 ────────────
--
-- The MIXED convergence's first node paid +4, one step above the +3 leaves that
-- feed it. It's the same volume split across both shapes, so it should sit level
-- with them: +3. The second MIXED node ('6 Tuck + 6 Straddle', +5) is untouched
-- and keeps the ladder climbing.
--
-- Matched by branch + order_index (not name) — the live DB's node names drift
-- from the migration files (see CLAUDE.md).
--
-- Idempotent: re-running sets the same value.

DO $$
DECLARE
  cls uuid;
  n   int;
BEGIN
  SELECT id INTO cls FROM public.classes
  WHERE job = 'handstand' AND order_index = 2 LIMIT 1;
  IF cls IS NULL THEN
    RAISE EXCEPTION 'Handstand III not found';
  END IF;

  UPDATE public.class_quests SET lvl_reward = 3
  WHERE class_id = cls
    AND lower(chain) = 'shapes'
    AND quest_type = 'main'
    AND lower(branch) = 'mixed'
    AND order_index = 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'shapes/mixed #1 (4 Tuck + 4 Straddle) -> +3: % rows', n;
END $$;
