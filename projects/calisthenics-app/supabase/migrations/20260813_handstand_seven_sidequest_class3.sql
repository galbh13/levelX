-- Handstand job — CLASS 3 gets a new SIDE quest: "7".
--
-- A brand-new (not copied) SIDE quest on Handstand III (order_index 2), with two
-- linear branches. The chain slug is 'SEVEN' so the card reads "SEVEN". Each node's
-- prerequisite is the previous node in its branch (two independent straight
-- chains). The per-node "points" the user gave become lvl_reward (+N LVL badge).
--
--   Branch one_leg  (One leg 7):
--     1 rep each  (+1),  3 rep each (+2),  5 rep each (+3),  7 rep each (+4)
--   Branch full_hold (Full 7 hold):
--     3 sec (+1),  7 sec (+2),  10 sec (+3),  15 sec (+4)
--
-- Idempotent: clears any prior copy of this chain, then rebuilds.

DO $$
DECLARE
  tgt_class uuid;
  branches  text[] := ARRAY['one_leg', 'full_hold'];
  names     text[][] := ARRAY[
    ARRAY['One leg 7 — 1 rep each', 'One leg 7 — 3 rep each',
          'One leg 7 — 5 rep each', 'One leg 7 — 7 rep each'],
    ARRAY['Full 7 hold — 3 sec', 'Full 7 hold — 7 sec',
          'Full 7 hold — 10 sec', 'Full 7 hold — 15 sec']
  ];
  rewards   int[] := ARRAY[1, 2, 3, 4];   -- points → lvl_reward, per node
  b         int;
  i         int;
  new_id    uuid;
  prev_id   uuid;
BEGIN
  SELECT id INTO tgt_class
  FROM classes WHERE job = 'handstand' AND order_index = 2
  LIMIT 1;

  IF tgt_class IS NULL THEN
    RAISE EXCEPTION 'Handstand III not found — run 20260716_handstand_shapes_class3.sql first';
  END IF;

  -- Idempotent: clear any prior copy of this side quest.
  DELETE FROM class_quests
  WHERE class_id = tgt_class AND chain = 'SEVEN' AND quest_type = 'side';

  FOR b IN 1 .. array_length(branches, 1) LOOP
    prev_id := NULL;
    FOR i IN 1 .. array_length(rewards, 1) LOOP
      new_id := gen_random_uuid();
      INSERT INTO class_quests
        (id, class_id, quest_type, chain, branch, order_index, name,
         lvl_reward, is_convergence, prerequisites)
      VALUES (
        new_id, tgt_class, 'side', 'SEVEN', branches[b], i - 1, names[b][i],
        rewards[i], false,
        CASE WHEN prev_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[prev_id] END
      );
      prev_id := new_id;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Handstand III (class %) SIDE quest "SEVEN": created % nodes',
    tgt_class, array_length(branches, 1) * array_length(rewards, 1);
END $$;
