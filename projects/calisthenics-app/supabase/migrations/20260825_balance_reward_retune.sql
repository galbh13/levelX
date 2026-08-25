-- Retune the BALANCE main quest rewards (handstand job) ─────────────────────
--
-- The chain was almost entirely flat: only the three upper nodes paid LVL
-- (+5 each) and everything below them paid 0, so 9/9 read as "+25" with no
-- sense of a ladder. This spreads the reward over the chain instead:
--
--     HS Disconnections 5 sec    →  +1
--     Freestanding 5 sec         →  +2
--     HS Disconnections 10 sec   →  +2
--     Freestanding 20 sec        →  +5
--     Freestanding 30 sec        →  +10
--
-- Untouched on purpose: "HS Disconnections 2 sec" (0), "Freestanding 10 sec"
-- (+5), "HS Disconnections 20 sec" (+5) and the hidden "HS Scale" challenge
-- (+10) — none of them were part of the retune.
--
-- Matched on `name` rather than on the current reward, because rewards in the
-- live DB drift from the migration files while names are stable (see CLAUDE.md).
-- Numbers are matched with \y word boundaries so "5 sec" never catches
-- "30 sec"/"20 sec". Scoped to `chain = 'balance'` + `quest_type = 'main'`, so
-- the HSPU freestanding MIRROR nodes (which must stay at lvl_reward = 0 — the
-- LVL is paid once, see lib/mirrorQuests.js) are not affected.
--
-- Idempotent: re-running sets the same values.

DO $$
DECLARE
  n int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.class_quests q
    JOIN public.classes c ON c.id = q.class_id
    WHERE c.job = 'handstand' AND lower(q.chain) = 'balance'
      AND q.quest_type = 'main'
  ) THEN
    RAISE EXCEPTION 'no handstand BALANCE main quest found — run 20260716_handstand_balance_class2.sql first';
  END IF;

  -- HS Disconnections 5 sec → +1
  UPDATE public.class_quests q SET lvl_reward = 1
  FROM public.classes c
  WHERE c.id = q.class_id AND c.job = 'handstand'
    AND lower(q.chain) = 'balance' AND q.quest_type = 'main'
    AND q.name ~* 'disconnect' AND q.name ~ '\y5\y';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'disconnections 5 sec -> +1: % rows', n;

  -- Freestanding 5 sec → +2  /  HS Disconnections 10 sec → +2
  UPDATE public.class_quests q SET lvl_reward = 2
  FROM public.classes c
  WHERE c.id = q.class_id AND c.job = 'handstand'
    AND lower(q.chain) = 'balance' AND q.quest_type = 'main'
    AND ( (q.name ~* 'freestanding' AND q.name ~ '\y5\y')
       OR (q.name ~* 'disconnect'   AND q.name ~ '\y10\y') );
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'freestanding 5 sec / disconnections 10 sec -> +2: % rows', n;

  -- Freestanding 20 sec → +5
  UPDATE public.class_quests q SET lvl_reward = 5
  FROM public.classes c
  WHERE c.id = q.class_id AND c.job = 'handstand'
    AND lower(q.chain) = 'balance' AND q.quest_type = 'main'
    AND q.name ~* 'freestanding' AND q.name ~ '\y20\y';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'freestanding 20 sec -> +5: % rows', n;

  -- Freestanding 30 sec → +10
  UPDATE public.class_quests q SET lvl_reward = 10
  FROM public.classes c
  WHERE c.id = q.class_id AND c.job = 'handstand'
    AND lower(q.chain) = 'balance' AND q.quest_type = 'main'
    AND q.name ~* 'freestanding' AND q.name ~ '\y30\y';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'freestanding 30 sec -> +10: % rows', n;
END $$;
