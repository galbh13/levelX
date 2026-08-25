-- Consolidated, self-verifying fix for the handstand PUSH main quest's TIER II.
-- Supersedes 20260716_handstand_push_branch_split.sql (safe to run over it).
--
-- Does three idempotent things, then prints diagnostics:
--   1. Splits the tier-1 skill lines into their own branches ('pike' / 'dips';
--      the push-ups spine stays 'main').
--   2. Recomputes the tier-1 leaves (pike + dips tips).
--   3. Re-asserts each tier-2 branch root (lowest order_index of 'power' /
--      'mobility') as an is_convergence node whose prerequisites are BOTH leaves.
--
-- The app draws the TIER II divider when a convergence node's prerequisites span
-- 2+ branches. So after this runs, the "leaf branches distinct" NOTICE MUST be
-- >= 2. If it prints 1, the pike/dips rename didn't match and we'll see why.

DO $$
DECLARE
  tgt_class         uuid;
  leaves            uuid[];
  leaf_branch_count int;
  b                 text;
  root_id           uuid;
BEGIN
  SELECT id INTO tgt_class
  FROM classes WHERE job = 'handstand'
  ORDER BY order_index LIMIT 1;
  IF tgt_class IS NULL THEN
    RAISE EXCEPTION 'handstand class not found — run 20260714_jobs.sql first';
  END IF;

  -- 1) Split tier-1 skill lines into their own branches.
  UPDATE class_quests SET branch = 'pike'
  WHERE class_id = tgt_class AND lower(chain) = 'push' AND quest_type = 'main'
    AND name ILIKE '%pike%';
  UPDATE class_quests SET branch = 'dips'
  WHERE class_id = tgt_class AND lower(chain) = 'push' AND quest_type = 'main'
    AND name ILIKE '%dips%';

  -- 2) Tier-1 leaves: push nodes (excluding tier-2 branches) that nothing else in
  --    tier-1 depends on — the pike + dips tips.
  SELECT array_agg(q.id) INTO leaves
  FROM class_quests q
  WHERE q.class_id = tgt_class AND lower(q.chain) = 'push' AND q.quest_type = 'main'
    AND lower(COALESCE(q.branch, '')) NOT IN ('power', 'mobility')
    AND NOT EXISTS (
      SELECT 1 FROM class_quests o
      WHERE o.class_id = tgt_class AND lower(o.chain) = 'push' AND o.quest_type = 'main'
        AND lower(COALESCE(o.branch, '')) NOT IN ('power', 'mobility')
        AND q.id = ANY(o.prerequisites)
    );

  IF leaves IS NULL OR array_length(leaves, 1) < 2 THEN
    RAISE EXCEPTION 'expected >= 2 push tier-1 leaves, found % — is the PUSH seed loaded?',
      COALESCE(array_length(leaves, 1), 0);
  END IF;

  -- 3) Re-assert each tier-2 branch root as a convergence from BOTH leaves.
  FOREACH b IN ARRAY ARRAY['power', 'mobility'] LOOP
    SELECT id INTO root_id
    FROM class_quests
    WHERE class_id = tgt_class AND lower(chain) = 'push' AND quest_type = 'main'
      AND lower(branch) = b
    ORDER BY order_index ASC
    LIMIT 1;
    IF root_id IS NOT NULL THEN
      UPDATE class_quests
      SET prerequisites = leaves, is_convergence = true
      WHERE id = root_id;
    END IF;
  END LOOP;

  -- ── Diagnostics ────────────────────────────────────────────────────────────
  SELECT count(DISTINCT p.branch) INTO leaf_branch_count
  FROM class_quests p WHERE p.id = ANY(leaves);

  RAISE NOTICE 'push-main branches now: %',
    (SELECT string_agg(t.b, ', ' ORDER BY t.b)
       FROM (SELECT DISTINCT COALESCE(branch, '(null)') AS b
               FROM class_quests
              WHERE class_id = tgt_class AND lower(chain) = 'push' AND quest_type = 'main') t);
  RAISE NOTICE 'tier-1 leaf branches distinct = %  (need >= 2 for TIER II to render)',
    leaf_branch_count;
  RAISE NOTICE 'convergence roots (power/mobility) is_convergence set = %',
    (SELECT count(*) FROM class_quests
       WHERE class_id = tgt_class AND lower(chain) = 'push' AND quest_type = 'main'
         AND lower(branch) IN ('power', 'mobility') AND is_convergence = true);
END $$;
