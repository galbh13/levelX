-- Handstand job — CLASS 3 gets a new SIDE quest: "MEXICAN HANDSTAND",
-- and class_quests gains the COACH-APPROVED flag the quest needs.
--
-- Shape (very short, one merge):
--
--        BRIDGE                    COACH
--   ┌──────────────────┐   ┌─────────────────────┐
--   │ Bridge 10 sec    │   │ Coach Approved     │
--   └────────┬─────────┘   └──────────┬──────────┘
--            └────────────┬───────────┘
--                 ┌───────┴────────┐
--                 │ Mexican 10 sec │   (convergence, +10 LVL — the whole quest's
--                 └────────────────┘    reward; both feeders pay 0)
--
-- `coach_approved` is a NEW, general column — not a Mexican-only hack. A node
-- carrying it is an ordinary quest (own completion row, own lvl_reward, gates
-- its children) except that ONLY the coach can check it, from the admin flow:
-- the player taps it and gets "your coach approves this one", never a confirm.
-- The app renders those nodes GREEN, the way mirrored requirements render
-- violet (see lib/coachQuests.js).
--
-- Idempotent: adds the column if missing, clears any prior copy of the chain,
-- then rebuilds.

ALTER TABLE class_quests
  ADD COLUMN IF NOT EXISTS coach_approved boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN class_quests.coach_approved IS
  'Coach-gated node: only the coach (admin flow) may complete it for a player. Otherwise an ordinary quest — it owns its completion row and pays its lvl_reward. Rendered green.';

DO $$
DECLARE
  tgt_class uuid;
  bridge_id uuid := gen_random_uuid();
  coach_id  uuid := gen_random_uuid();
  merge_id  uuid := gen_random_uuid();
BEGIN
  SELECT id INTO tgt_class
  FROM classes WHERE job = 'handstand' AND order_index = 2
  LIMIT 1;

  IF tgt_class IS NULL THEN
    RAISE EXCEPTION 'Handstand III not found — run 20260716_handstand_shapes_class3.sql first';
  END IF;

  -- Idempotent: clear any prior copy of this side quest (completions included,
  -- since the node ids are regenerated below).
  DELETE FROM student_quest_completions
  WHERE quest_id IN (
    SELECT id FROM class_quests
    WHERE class_id = tgt_class AND chain = 'MEXICAN_HANDSTAND' AND quest_type = 'side'
  );
  DELETE FROM class_quests
  WHERE class_id = tgt_class AND chain = 'MEXICAN_HANDSTAND' AND quest_type = 'side';

  INSERT INTO class_quests
    (id, class_id, quest_type, chain, branch, order_index, name,
     lvl_reward, is_convergence, prerequisites, coach_approved)
  VALUES
    -- Branch one: a single node, and that's the end of the branch.
    (bridge_id, tgt_class, 'side', 'MEXICAN_HANDSTAND', 'bridge', 0, 'Bridge 10 sec',
     0, false, '{}'::uuid[], false),
    -- Branch two: the coach's call — the only node in the app they own.
    (coach_id,  tgt_class, 'side', 'MEXICAN_HANDSTAND', 'coach',  0, 'Coach Approved',
     0, false, '{}'::uuid[], true),
    -- The two combine here.
    (merge_id,  tgt_class, 'side', 'MEXICAN_HANDSTAND', 'main',   0, 'Mexican 10 sec',
     10, true, ARRAY[bridge_id, coach_id], false);

  RAISE NOTICE 'Handstand III (class %) SIDE quest "MEXICAN HANDSTAND": 3 nodes', tgt_class;
END $$;
