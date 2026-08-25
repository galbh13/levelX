-- COMBOES + EXTREME COMBO (Handstand III) — reward retune ───────────────────
--
-- Both 3-node combo chains paid a near-flat +2/+3/+4, which read as no ladder
-- at all for the hardest content in the class. New curve for each:
--
--     node #1  →  +4
--     node #2  →  +6
--     node #3  →  +10
--
-- Matched by `order_index` (0/1/2) inside the chain, the same way
-- 20260813_handstand_comboes_rework.sql matched them, so it stays correct
-- regardless of the node names in the live DB (which drift from the migration
-- files — see CLAUDE.md).
--
-- 'comboes' is scoped to quest_type = 'main'. 'extreme_combo' is left
-- unconstrained on quest_type because the rework file inserted those nodes as
-- 'side' while the tree renders them under a MAIN QUEST badge.
--
-- Idempotent: re-running sets the same values.

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

  -- ── COMBOES (main) ───────────────────────────────────────────────────────
  UPDATE public.class_quests SET lvl_reward = 4
  WHERE class_id = cls AND lower(chain) = 'comboes'
    AND quest_type = 'main' AND order_index = 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'comboes #1 -> +4: % rows', n;

  UPDATE public.class_quests SET lvl_reward = 6
  WHERE class_id = cls AND lower(chain) = 'comboes'
    AND quest_type = 'main' AND order_index = 1;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'comboes #2 -> +6: % rows', n;

  UPDATE public.class_quests SET lvl_reward = 10
  WHERE class_id = cls AND lower(chain) = 'comboes'
    AND quest_type = 'main' AND order_index = 2;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'comboes #3 -> +10: % rows', n;

  -- ── EXTREME COMBO ────────────────────────────────────────────────────────
  UPDATE public.class_quests SET lvl_reward = 4
  WHERE class_id = cls AND lower(chain) = 'extreme_combo' AND order_index = 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'extreme combo #1 -> +4: % rows', n;

  UPDATE public.class_quests SET lvl_reward = 6
  WHERE class_id = cls AND lower(chain) = 'extreme_combo' AND order_index = 1;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'extreme combo #2 -> +6: % rows', n;

  UPDATE public.class_quests SET lvl_reward = 10
  WHERE class_id = cls AND lower(chain) = 'extreme_combo' AND order_index = 2;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'extreme combo #3 -> +10: % rows', n;
END $$;
