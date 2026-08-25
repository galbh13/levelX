-- HSPU (handstand job) — the REQUIREMENT branch becomes ONE mirrored node that
-- is earned in a DIFFERENT main quest.
--
-- Before: HSPU's REQUIREMENT branch held two of its own nodes ("HS Hold 20 sec"
-- and "HS Hold 20 sec x3 in a row"), completed from inside the HSPU tree.
-- After:  a single node that MIRRORS the BALANCE main quest's "Freestanding
-- 20 sec". It carries `mirror_quest_id` = that balance quest's id, so:
--   • it reads as done the moment the player confirms Freestanding 20 sec in
--     the BALANCE tree — nothing is stored against the mirror node itself;
--   • it can NOT be toggled from HSPU (the app blocks the tap and points the
--     player at the quest that owns it);
--   • it carries lvl_reward 0 — the LVL is paid once, in BALANCE.
--
-- Whatever depended on the retired requirement nodes (the MAIN convergence) is
-- rewired onto the mirror node. Idempotent — safe to re-run.

ALTER TABLE class_quests
  ADD COLUMN IF NOT EXISTS mirror_quest_id uuid
    REFERENCES class_quests(id) ON DELETE SET NULL;

COMMENT ON COLUMN class_quests.mirror_quest_id IS
  'Cross-quest requirement: this node is a read-only mirror of another class_quests row (usually in a different chain). It is DONE when the referenced quest is completed and can never be toggled directly.';

DO $$
DECLARE
  cls      uuid;
  src      uuid;
  src_name text;
  new_id   uuid;
  old_ids  uuid[];
BEGIN
  FOR cls IN
    SELECT DISTINCT q.class_id
    FROM class_quests q
    JOIN classes c ON c.id = q.class_id
    WHERE c.job = 'handstand'
      AND lower(q.chain) = 'hspu'
      AND q.quest_type = 'main'
  LOOP
    -- The node the requirement points at, in the SAME class's BALANCE main quest.
    SELECT id, name INTO src, src_name
    FROM class_quests
    WHERE class_id = cls
      AND lower(chain) = 'balance'
      AND quest_type = 'main'
      AND name ILIKE '%freestanding%20 sec%'
    ORDER BY order_index
    LIMIT 1;

    IF src IS NULL THEN
      RAISE NOTICE 'class %: no BALANCE "Freestanding 20 sec" node — skipped', cls;
      CONTINUE;
    END IF;

    -- Re-run guard: reuse the mirror node if this migration already ran.
    SELECT id INTO new_id
    FROM class_quests
    WHERE class_id = cls AND lower(chain) = 'hspu' AND quest_type = 'main'
      AND lower(branch) = 'requirement' AND mirror_quest_id = src
    LIMIT 1;

    IF new_id IS NULL THEN
      new_id := gen_random_uuid();
      INSERT INTO class_quests
        (id, class_id, quest_type, chain, branch, order_index, name,
         lvl_reward, is_convergence, prerequisites, mirror_quest_id)
      VALUES
        (new_id, cls, 'main', 'hspu', 'requirement', 0, src_name,
         0, false, '{}'::uuid[], src);
    END IF;

    -- Every OTHER node of the REQUIREMENT branch is retired.
    SELECT COALESCE(array_agg(id), '{}')::uuid[] INTO old_ids
    FROM class_quests
    WHERE class_id = cls AND lower(chain) = 'hspu' AND quest_type = 'main'
      AND lower(branch) = 'requirement' AND id <> new_id;

    -- Anything gated on a retired node is now gated on the mirror node.
    UPDATE class_quests t
    SET prerequisites = (
      SELECT COALESCE(array_agg(DISTINCT p), '{}')::uuid[]
      FROM (
        SELECT CASE WHEN e = ANY(old_ids) THEN new_id ELSE e END AS p
        FROM unnest(t.prerequisites) AS e
      ) s
    )
    WHERE t.class_id = cls
      AND t.prerequisites && old_ids;

    -- Drop players' completions of the retired nodes, then the nodes.
    DELETE FROM student_quest_completions WHERE quest_id = ANY(old_ids);
    DELETE FROM class_quests              WHERE id       = ANY(old_ids);

    RAISE NOTICE 'class %: HSPU REQUIREMENT → mirror of "%" (retired % node(s))',
      cls, src_name, coalesce(array_length(old_ids, 1), 0);
  END LOOP;
END $$;
