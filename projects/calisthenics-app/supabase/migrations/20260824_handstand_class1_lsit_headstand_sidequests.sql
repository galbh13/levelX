-- Handstand job — CLASS 1 gets two more SIDE quests: L-SIT and HEADSTAND.
--
-- Copies the static job's Class I `l-sit` and `headstand` SIDE chains into the
-- handstand job's first class (Handstand I, order_index 0), keeping them typed
-- as side quests. Both land in **TIER I** next to the existing FROG chain.
--
-- Why they both end up Tier I: the app classifies a side chain as Tier II when
-- any of its nodes is gated by a prerequisite in a DIFFERENT chain
-- (`tier2SideChains` in lib/prestige.js). In static Class I, `headstand` IS a
-- Tier II chain — its branch roots (`disconnection` / `freestanding`) are
-- convergence nodes whose prerequisites point at the Tier I leaves (frog /
-- kick-up muscle-up / l-sit). Each chain here is copied with its OWN id map, so
-- only in-chain prerequisites survive the remap; the cross-chain gates drop out
-- and the branch roots are then cleared of their `is_convergence` flag. Result:
-- two self-contained Tier I chains.
--
-- DB-side copy of the LIVE tree (which drifts from the migration files): fresh
-- ids, remapped prereqs. Idempotent — re-running re-clears and re-copies.

DO $$
DECLARE
  src_class uuid;
  tgt_class uuid;
  chains    text[];
  ch        text;
  n_copied  int;
BEGIN
  -- Source: static Class I.
  SELECT id INTO src_class
  FROM classes WHERE job = 'static' AND order_index = 0
  LIMIT 1;
  IF src_class IS NULL THEN
    RAISE EXCEPTION 'static Class I (order_index 0) not found';
  END IF;

  -- Target: the handstand job's first class.
  SELECT id INTO tgt_class
  FROM classes WHERE job = 'handstand' AND order_index = 0
  LIMIT 1;
  IF tgt_class IS NULL THEN
    RAISE EXCEPTION 'handstand class 1 not found — run 20260714_jobs.sql first';
  END IF;

  -- Resolve the real chain slugs (live slugs are human strings: 'l-sit', 'l sit', …).
  SELECT array_agg(DISTINCT chain) INTO chains
  FROM class_quests
  WHERE class_id = src_class AND quest_type = 'side'
    AND (chain ~* 'l[- _]?sit' OR chain ~* 'headstand');

  IF chains IS NULL OR array_length(chains, 1) < 2 THEN
    RAISE EXCEPTION 'expected an l-sit AND a headstand side chain in static Class I, found: %',
      COALESCE(array_to_string(chains, ', '), '<none>');
  END IF;

  -- Copy each chain on its own id map (so cross-chain prereqs are dropped).
  FOREACH ch IN ARRAY chains LOOP
    -- Clear any prior copy so re-running never duplicates.
    DELETE FROM class_quests
    WHERE class_id = tgt_class AND quest_type = 'side' AND chain = ch;

    WITH src AS (
      SELECT * FROM class_quests
      WHERE class_id = src_class AND quest_type = 'side' AND chain = ch
    ),
    idmap AS MATERIALIZED (
      SELECT id AS old_id, gen_random_uuid() AS new_id FROM src
    )
    INSERT INTO class_quests
      (id, class_id, quest_type, chain, branch, order_index, name,
       lvl_reward, is_convergence, prerequisites, requirement_text)
    SELECT
      m.new_id,
      tgt_class,
      'side',
      s.chain,          -- keep the source slug → cards read "L-SIT" / "HEADSTAND"
      s.branch,
      s.order_index,
      s.name,
      s.lvl_reward,
      s.is_convergence,
      (SELECT COALESCE(array_agg(m2.new_id), '{}')::uuid[]
         FROM unnest(COALESCE(s.prerequisites, '{}')) AS p(old)
         JOIN idmap m2 ON m2.old_id = p.old),
      s.requirement_text
    FROM src s
    JOIN idmap m ON m.old_id = s.id;

    -- A node that only had cross-chain gates is now a free root, not a convergence.
    UPDATE class_quests
    SET is_convergence = false
    WHERE class_id = tgt_class AND quest_type = 'side' AND chain = ch
      AND is_convergence
      AND COALESCE(array_length(prerequisites, 1), 0) = 0;

    SELECT count(*) INTO n_copied
    FROM class_quests
    WHERE class_id = tgt_class AND quest_type = 'side' AND chain = ch;

    RAISE NOTICE 'Handstand I side quest "%": copied % nodes from static Class I', ch, n_copied;
  END LOOP;
END $$;
