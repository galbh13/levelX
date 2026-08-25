-- HIDDEN CHALLENGE — the BALANCE main quest gets a bonus node: "HS Scale"
-- (Handstand Scale), revealed only once the player clears the tip of the quest
-- ("Freestanding 30 sec").
--
-- Same mechanism as the FOUNDATION challenge (20260824_hidden_challenges.sql):
-- `is_hidden = true` filters the node out of the tree, the node count and the
-- Skills chain counter until EVERY id in `prerequisites` is completed — then it
-- drops in, already unlocked, wearing the gold "✦ HIDDEN CHALLENGE ✦" banner.
--
-- Layout note: `branch = 'challenge'` gives it the banner (the banner replaces
-- the branch label of a branch made of hidden nodes), and `is_convergence = true`
-- keeps it centred UNDER "Freestanding 30 sec" instead of claiming a column of
-- its own — a convergence/post-convergence node inherits its parent's x.
--
-- Like the other handstand migrations this matches the LIVE tree structurally
-- (ids and rewards drift from the migration files) and is idempotent.
--
-- CAUTION: re-running 20260716_handstand_balance_class2.sql wipes and re-copies
-- the whole BALANCE chain — run THIS file again afterwards to restore the node.

ALTER TABLE public.class_quests
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

DO $$
DECLARE
  cls        uuid;
  tip        uuid;
  tip_name   text;
  next_order integer;
  touched    integer := 0;
BEGIN
  -- Every class (handstand job) that owns a BALANCE main quest.
  FOR cls IN
    SELECT DISTINCT q.class_id
    FROM public.class_quests q
    JOIN public.classes c ON c.id = q.class_id
    WHERE c.job = 'handstand'
      AND lower(q.chain) = 'balance'
      AND q.quest_type = 'main'
  LOOP
    -- The TIP of the quest = the node nothing else in BALANCE depends on.
    -- Resolved structurally so a renamed/extended chain still works, but
    -- preferring the "Freestanding 30 sec" node when it is there (it is the
    -- qualification the challenge is meant to hang off).
    SELECT q.id, q.name INTO tip, tip_name
    FROM public.class_quests q
    WHERE q.class_id = cls AND q.quest_type = 'main'
      AND lower(q.chain) = 'balance'
      AND NOT q.is_hidden
      AND NOT EXISTS (
        SELECT 1 FROM public.class_quests c2
        WHERE c2.class_id = cls AND c2.quest_type = 'main'
          AND lower(c2.chain) = 'balance'
          AND q.id = ANY(COALESCE(c2.prerequisites, '{}'))
      )
    ORDER BY (q.name ILIKE '%freestanding%30%') DESC, q.order_index DESC
    LIMIT 1;

    IF tip IS NULL THEN
      RAISE NOTICE 'class %: no BALANCE tip node found — skipped', cls;
      CONTINUE;
    END IF;

    SELECT COALESCE(max(order_index), -1) + 1 INTO next_order
    FROM public.class_quests
    WHERE class_id = cls AND quest_type = 'main' AND lower(chain) = 'balance';

    IF EXISTS (
      SELECT 1 FROM public.class_quests
      WHERE class_id = cls AND quest_type = 'main'
        AND lower(chain) = 'balance' AND name = 'HS Scale'
    ) THEN
      UPDATE public.class_quests
      SET branch = 'challenge', is_hidden = true, is_convergence = true,
          prerequisites = ARRAY[tip]
      WHERE class_id = cls AND quest_type = 'main'
        AND lower(chain) = 'balance' AND name = 'HS Scale';
    ELSE
      INSERT INTO public.class_quests
        (class_id, quest_type, chain, branch, order_index, name, lvl_reward,
         is_convergence, prerequisites, is_hidden)
      VALUES
        (cls, 'main', 'balance', 'challenge', next_order,
         'HS Scale', 10, true, ARRAY[tip], true);
    END IF;

    touched := touched + 1;
    RAISE NOTICE 'class %: hidden challenge "HS Scale" gated on "%" (%)',
      cls, tip_name, tip;
  END LOOP;

  IF touched = 0 THEN
    RAISE EXCEPTION 'no handstand BALANCE main quest found — run 20260716_handstand_balance_class2.sql first';
  END IF;
END $$;
