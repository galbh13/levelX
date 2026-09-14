-- Handstand job — the "CROW TO HANDSTAND" side quest's LEFT start node changes:
--
--   before          Crow 10 sec                    ─┐
--                   Negative Crow from Handstand   ─┴─→ Crow to Handstand
--
--   after           Crow to Handstand with Wall    ─┐
--                   Negative Crow from Handstand   ─┴─→ Crow to Handstand
--
-- Only the node's NAME changes. Its id, prerequisites (the Tier-I leaves that
-- gate this Tier-II chain), is_convergence flag and reward all stay as they
-- are, so the tree keeps its shape and nobody loses a completion they already
-- earned on that node.
--
-- Keys are taken from the LIVE tree, which does not match the older migration
-- files: the chain there is 'crow to handstand' (SPACES, not underscores) and
-- the branch column is blank on all three nodes, so branch is useless as a
-- handle and the node name is what identifies the left start.
--
-- Scoped to the handstand job — the static job's Class II copy of the same
-- chain (its own 'Crow 10 sec', id 7f0a070e-…) is deliberately left alone.
-- Idempotent: re-running renames nothing and is a no-op.

DO $$
DECLARE
  renamed int;
BEGIN
  UPDATE class_quests cq
  SET name = 'Crow to Handstand with Wall'
  FROM classes c
  WHERE c.id = cq.class_id
    AND c.job = 'handstand'
    AND cq.quest_type = 'side'
    AND cq.chain = 'crow to handstand'
    AND cq.name = 'Crow 10 sec';

  GET DIAGNOSTICS renamed = ROW_COUNT;

  IF renamed = 0 THEN
    -- Already renamed by an earlier run? Then this is fine. Otherwise the node
    -- moved again and the keys need another look.
    IF EXISTS (
      SELECT 1 FROM class_quests cq
      JOIN classes c ON c.id = cq.class_id
      WHERE c.job = 'handstand'
        AND cq.chain = 'crow to handstand'
        AND cq.name = 'Crow to Handstand with Wall'
    ) THEN
      RAISE NOTICE 'Already renamed — nothing to do.';
    ELSE
      RAISE EXCEPTION
        'No "Crow 10 sec" node in the handstand "crow to handstand" chain — re-check the live tree';
    END IF;
  ELSE
    RAISE NOTICE 'Renamed % node(s) to "Crow to Handstand with Wall"', renamed;
  END IF;
END $$;
