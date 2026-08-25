-- Handstand job — CLASS 3 gets a second main quest: STRAIGHT ARM PRESSES.
--
-- A brand-new (not copied) single-column linear main quest on Handstand III
-- (order_index 2), alongside its existing SHAPES quest. Seven nodes in order:
--   1. One Straddle Negative
--   2. One Straddle Press
--   3. Two Straddle Presses
--   4. Three Straddle Presses
--   5. One Pike Negative
--   6. One Pike Press
--   7. Two Pike Presses
--
-- Each node's prerequisite is the previous one (a straight chain). lvl_reward
-- values here are PLACEHOLDERS — adjust freely. Idempotent (clears + rebuilds).

DO $$
DECLARE
  tgt_class uuid;
  names   text[] := ARRAY[
    'One Straddle Negative',
    'One Straddle Press',
    'Two Straddle Presses',
    'Three Straddle Presses',
    'One Pike Negative',
    'One Pike Press',
    'Two Pike Presses'
  ];
  rewards int[] := ARRAY[1, 2, 3, 4, 2, 3, 5];   -- placeholder rewards
  i        int;
  new_id   uuid;
  prev_id  uuid := NULL;
BEGIN
  SELECT id INTO tgt_class
  FROM classes WHERE job = 'handstand' AND order_index = 2
  LIMIT 1;

  IF tgt_class IS NULL THEN
    RAISE EXCEPTION 'Handstand III not found — run 20260716_handstand_shapes_class3.sql first';
  END IF;

  -- Idempotent: clear any prior copy of this quest.
  DELETE FROM class_quests
  WHERE class_id = tgt_class AND lower(chain) = 'straight_arm_presses' AND quest_type = 'main';

  FOR i IN 1 .. array_length(names, 1) LOOP
    new_id := gen_random_uuid();
    INSERT INTO class_quests
      (id, class_id, quest_type, chain, branch, order_index, name,
       lvl_reward, is_convergence, prerequisites)
    VALUES (
      new_id, tgt_class, 'main', 'straight_arm_presses', 'main', i - 1, names[i],
      rewards[i], false,
      CASE WHEN prev_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[prev_id] END
    );
    prev_id := new_id;
  END LOOP;

  RAISE NOTICE 'Handstand III (class %) STRAIGHT ARM PRESSES: created % nodes',
    tgt_class, array_length(names, 1);
END $$;
