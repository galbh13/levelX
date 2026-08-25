-- Handstand HSPU main quest — rename the 'main' branch to 'hspu'.
--
-- The handstand job's hspu main quest (Handstand II) has branches
-- hspu_prog / requirement / main, where 'main' is the convergence line
-- (1 bent arm press to handstand → 1/2/3 HSPU). Renaming that branch to 'hspu'
-- makes its column label read "HSPU". Paired with the code change adding 'hspu'
-- to HANDSTAND_TIERED_CHAINS, this branch renders below a TIER II divider.
--
-- Scoped to job='handstand' so the STATIC hspu quest keeps its 'main' branch
-- (and its 'hspu.main' BRANCH_LAYOUT tuning). Idempotent.

UPDATE class_quests
SET branch = 'hspu'
WHERE quest_type = 'main'
  AND lower(chain) = 'hspu'
  AND branch = 'main'
  AND class_id IN (SELECT id FROM classes WHERE job = 'handstand');
