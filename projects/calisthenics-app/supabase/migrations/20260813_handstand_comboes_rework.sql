-- Handstand III (order_index 2) — COMBOES rework + new EXTREME COMBO side quest.
--
-- 1. COMBOES (main, chain 'comboes'): rename the 3 nodes to the shapes-based
--    progression and move them onto a 'basic_combo' branch (label "BASIC COMBO").
--    Matched by order_index (0/1/2) so it's independent of the old names.
--    Rewards (+2/+3/+4) are left as-is.
--
-- 2. NEW side quest 'extreme_combo' (label "EXTREME COMBO"): 3 linear nodes.
--    Rewards 2/3/4 are PLACEHOLDERS — adjust freely. Idempotent (clears + rebuilds).

DO $$
DECLARE
  cls     uuid;
  ex_names text[] := ARRAY[
    'Press to straight for 5 sec to 1 HSPU to shapes and finish with negative press',
    'Press to straight for 5 sec to 1 HSPU and finish with negative press (2 rounds in a row)',
    'Press to straight for 5 sec to 1 HSPU and finish with negative press (3 rounds in a row)'
  ];
  ex_rewards int[] := ARRAY[2, 3, 4];   -- placeholder rewards
  i        int;
  new_id   uuid;
  prev_id  uuid := NULL;
BEGIN
  SELECT id INTO cls FROM classes WHERE job = 'handstand' AND order_index = 2 LIMIT 1;
  IF cls IS NULL THEN
    RAISE EXCEPTION 'Handstand III not found';
  END IF;

  -- ── 1. Rename + re-branch the COMBOES nodes ──────────────────────────────
  UPDATE class_quests SET
    name = 'Press to Shapes and finish with negative press', branch = 'basic_combo'
  WHERE class_id = cls AND chain = 'comboes' AND quest_type = 'main' AND order_index = 0;

  UPDATE class_quests SET
    name = 'Press to two rounds of shapes and finish with negative press', branch = 'basic_combo'
  WHERE class_id = cls AND chain = 'comboes' AND quest_type = 'main' AND order_index = 1;

  UPDATE class_quests SET
    name = 'Press to three rounds of shapes and finish with negative press', branch = 'basic_combo'
  WHERE class_id = cls AND chain = 'comboes' AND quest_type = 'main' AND order_index = 2;

  -- ── 2. New EXTREME COMBO side quest ──────────────────────────────────────
  DELETE FROM class_quests
  WHERE class_id = cls AND chain = 'extreme_combo' AND quest_type = 'side';

  FOR i IN 1 .. array_length(ex_names, 1) LOOP
    new_id := gen_random_uuid();
    INSERT INTO class_quests
      (id, class_id, quest_type, chain, branch, order_index, name,
       lvl_reward, is_convergence, prerequisites)
    VALUES (
      new_id, cls, 'side', 'extreme_combo', 'main', i - 1, ex_names[i],
      ex_rewards[i], false,
      CASE WHEN prev_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[prev_id] END
    );
    prev_id := new_id;
  END LOOP;

  RAISE NOTICE 'Handstand III: COMBOES renamed/re-branched + EXTREME COMBO created';
END $$;
