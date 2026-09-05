-- Handstand job — CLASS 3 loses the SIDE quest "TIGERBAND".
--
-- Reverses `20260825_handstand_class3_tigerband_sidequest.sql`: the one-node
-- chain isn't wanted in Handstand III for now. Nothing else in the app names
-- the chain (no upgrade pairing, no mirror, no hidden-challenge gate), so this
-- is a plain delete — no renumbering, no re-gating.
--
-- Order matters: completions first (FK → class_quests), then any stray
-- reference from OTHER nodes (a prerequisites[] entry or a mirror_quest_id
-- pointing at the node — neither should exist, but the live DB drifts from the
-- migrations, so we scrub rather than assume), then the node itself.
--
-- Chain matching is tolerant: the live slug is matched case-insensitively with
-- spaces/hyphens/underscores stripped, so 'TIGERBAND', 'tiger_band' and
-- 'Tiger Band' all resolve. Scoped to the handstand Class III side quests only.
--
-- Idempotent: running it twice deletes nothing the second time.

DO $$
DECLARE
  tgt_class uuid;
  doomed    uuid[];
BEGIN
  SELECT id INTO tgt_class
  FROM classes WHERE job = 'handstand' AND order_index = 2
  LIMIT 1;

  IF tgt_class IS NULL THEN
    RAISE EXCEPTION 'Handstand III not found — nothing to delete from';
  END IF;

  SELECT coalesce(array_agg(id), '{}'::uuid[]) INTO doomed
  FROM class_quests
  WHERE class_id = tgt_class
    AND quest_type = 'side'
    AND regexp_replace(lower(chain), '[^a-z0-9]', '', 'g') = 'tigerband';

  IF array_length(doomed, 1) IS NULL THEN
    RAISE NOTICE 'No TIGERBAND side quest in Handstand III (class %) — nothing to do', tgt_class;
    RETURN;
  END IF;

  -- 1. Player progress on those nodes.
  DELETE FROM student_quest_completions
  WHERE quest_id = ANY(doomed);

  -- 2. Any other node that points at them.
  UPDATE class_quests
  SET prerequisites = coalesce(
        (SELECT array_agg(p) FROM unnest(prerequisites) AS p WHERE p <> ALL(doomed)),
        '{}'::uuid[])
  WHERE prerequisites && doomed;

  UPDATE class_quests
  SET mirror_quest_id = NULL
  WHERE mirror_quest_id = ANY(doomed);

  -- 3. The nodes themselves.
  DELETE FROM class_quests
  WHERE id = ANY(doomed);

  RAISE NOTICE 'Handstand III (class %) SIDE quest "TIGERBAND" deleted: % node(s)',
    tgt_class, array_length(doomed, 1);
END $$;
