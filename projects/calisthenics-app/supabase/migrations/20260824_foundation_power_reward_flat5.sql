-- FOUNDATION / POWER — every node pays +5 LVL ─────────────────────────────────
--
-- The POWER branch of the handstand job's Class I FOUNDATION main quest paid
-- nothing for the first three holds and +5 only at the tip:
--
--     Wall HS Hold 10 sec   0  →  5
--     Wall HS Hold 20 sec   0  →  5
--     Wall HS Hold 30 sec   0  →  5
--     Wall HS Hold 40 sec   5  →  5 (unchanged)
--
-- Each rung of the hold ladder is real work, so each rung is worth the same.
--
-- Scope: POWER branch only — MOBILITY, the hidden challenge, and every other
-- class keep their rewards. Matched by class/chain/branch rather than by name
-- or id because the live tree drifts from the migration files (see
-- 20260824_hidden_challenges.sql). Idempotent: re-running just re-sets 5 → 5.

DO $$
DECLARE
  tgt_class uuid;
  n int;
BEGIN
  SELECT id INTO tgt_class
  FROM public.classes WHERE job = 'handstand'
  ORDER BY order_index LIMIT 1;

  IF tgt_class IS NULL THEN
    RAISE EXCEPTION 'handstand class not found — run 20260714_jobs.sql first';
  END IF;

  UPDATE public.class_quests
  SET lvl_reward = 5
  WHERE class_id = tgt_class
    AND quest_type = 'main'
    AND lower(chain) = 'foundation'
    AND lower(COALESCE(branch, '')) = 'power'
    AND NOT is_hidden
    AND lvl_reward IS DISTINCT FROM 5;
  GET DIAGNOSTICS n = ROW_COUNT;

  IF n = 0 THEN
    RAISE NOTICE 'FOUNDATION/POWER already flat +5 (or branch not found)';
  ELSE
    RAISE NOTICE 'FOUNDATION/POWER: % node(s) set to +5 LVL', n;
  END IF;
END $$;
