-- =============================================================================
-- Migration: Class I — swap headstand and kick_up_muscle_up side-quest tiers
-- =============================================================================
--
-- Tiers are structural (no tier column): a side chain is Tier 2 when its first
-- node converges on L = the leaves of every Tier 1 side chain (cross-chain
-- prereqs); a Tier 1 chain's first node is a root. This swaps:
--   • headstand          Tier 1 → Tier 2
--   • kick_up_muscle_up  Tier 2 → Tier 1
-- so the new tier sets become:
--   Tier 1: frog, kick-up muscle-up, l-sit
--   Tier 2: headstand, pull over, archer pull up, archer push up
--
-- CRITICAL — live-DB slug drift: the live `class_quests.chain` values are NOT the
-- underscore slugs in the older migration files (frog, headstand are bare words
-- and happen to match, but the rest are authored as human strings: 'kick-up
-- muscle-up', 'l-sit', 'pull over', 'archer pull up', 'archer push up'). SkillsScreen
-- renders the card title as `chain.toUpperCase()`, which is how we know. So this
-- migration matches chains by a NORMALIZED name — lower-cased, with -, _ and runs
-- of spaces collapsed to a single space — instead of a literal slug. That is
-- drift-proof and case/separator agnostic.
--
-- Structural & idempotent: leaves are found by MAX(order_index) per branch (never
-- by id), cross-chain prereqs are stripped set-wise, so it is safe to re-run.
-- =============================================================================

DO $$
DECLARE
  v_class_id uuid;
  v_leaves   uuid[];
  -- normalized chain-name sets
  v_tier1 text[] := ARRAY['frog', 'kick up muscle up', 'l sit'];
  v_tier2 text[] := ARRAY['headstand', 'pull over', 'archer pull up', 'archer push up'];
BEGIN
  SELECT id INTO v_class_id FROM classes WHERE name = 'Class I';

  -- 1. Tier 1 chains → roots: strip every CROSS-chain prereq from every node
  --    (keep same-chain sequential prereqs), and clear the convergence flag.
  UPDATE class_quests cq
  SET prerequisites = ARRAY(
        SELECT pid
        FROM unnest(cq.prerequisites) AS pid
        WHERE pid IN (
          SELECT id FROM class_quests s
          WHERE s.class_id   = v_class_id
            AND s.quest_type = 'side'
            AND s.chain      = cq.chain
        )
      ),
      is_convergence = false
  WHERE cq.class_id   = v_class_id
    AND cq.quest_type = 'side'
    AND lower(regexp_replace(cq.chain, '[-_ ]+', ' ', 'g')) = ANY(v_tier1);

  -- 2. New Tier-1 leaf set L = last (max order_index) node of every branch of the
  --    Tier 1 chains {frog, kick-up muscle-up}.
  SELECT ARRAY(
    SELECT cq.id
    FROM class_quests cq
    JOIN (
      SELECT chain, branch, MAX(order_index) AS mo
      FROM class_quests
      WHERE class_id   = v_class_id
        AND quest_type = 'side'
        AND lower(regexp_replace(chain, '[-_ ]+', ' ', 'g')) = ANY(v_tier1)
      GROUP BY chain, branch
    ) m
      ON cq.chain  = m.chain
     AND cq.branch IS NOT DISTINCT FROM m.branch
     AND cq.order_index = m.mo
    WHERE cq.class_id   = v_class_id
      AND cq.quest_type = 'side'
      AND lower(regexp_replace(cq.chain, '[-_ ]+', ' ', 'g')) = ANY(v_tier1)
  ) INTO v_leaves;

  -- 3. Tier 2 chains → first node of every branch (order_index 0) converges on L.
  UPDATE class_quests cq
  SET is_convergence = true,
      prerequisites  = v_leaves
  WHERE cq.class_id   = v_class_id
    AND cq.quest_type = 'side'
    AND lower(regexp_replace(cq.chain, '[-_ ]+', ' ', 'g')) = ANY(v_tier2)
    AND cq.order_index = 0;

  -- 4. Defensive: ensure NON-first Tier-2 nodes carry no cross-chain prereq, so
  --    each Tier-2 chain crosses chains only at its first node.
  UPDATE class_quests cq
  SET prerequisites = ARRAY(
        SELECT pid
        FROM unnest(cq.prerequisites) AS pid
        WHERE pid IN (
          SELECT id FROM class_quests s
          WHERE s.class_id   = v_class_id
            AND s.quest_type = 'side'
            AND s.chain      = cq.chain
        )
      )
  WHERE cq.class_id   = v_class_id
    AND cq.quest_type = 'side'
    AND lower(regexp_replace(cq.chain, '[-_ ]+', ' ', 'g')) = ANY(v_tier2)
    AND cq.order_index > 0;
END $$;

-- ─── Verification ─────────────────────────────────────────────────────────────
-- a) tier2SideChains() now returns {headstand, pull over, archer pull up,
--    archer push up}; frog, kick-up muscle-up & l-sit are Tier 1.
-- b) Every Tier-2 chain's order-0 node is is_convergence with prereqs = L
--    (= frog leaf + kick-up muscle-up leaf + l-sit leaf).
-- c) No frog / kick-up / l-sit node has a prereq outside its own chain, and none
--    is is_convergence (all three read as Tier 1 root chains).
