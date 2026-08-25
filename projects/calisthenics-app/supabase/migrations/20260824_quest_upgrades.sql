-- QUEST UPGRADES — a main quest's tier-2 face.
--
-- Some main quests have a harder version of themselves waiting behind them.
-- Clear every node of the base quest and a gold UPGRADE button reveals at the
-- foot of the tree; take it and the quest BECOMES its upgrade — the tree swaps
-- to the harder nodes and the Skills card carries the upgrade's name and
-- progress in the base quest's place. The player can switch back and forth
-- between the two versions at will; completions on both sides are untouched by
-- switching, and by the upgrade itself.
--
-- Handstand III's two pairs (base → upgrade):
--     comboes              → extreme_combo
--     straight_arm_presses → pike_press
--
-- NO quest rows move. `extreme_combo` and `pike_press` keep the
-- `quest_type = 'side'` they were seeded with (20260813_handstand_comboes_rework
-- / 20260813_handstand_class3_quest_splits); the APP stops listing them as
-- standalone side quests and shows them only as their base chain's upgraded
-- face. The pairing itself is a client-side map keyed by chain slug
-- (lib/questUpgrades.js) — chain slugs are stable across the live DB's drift
-- from these files, the same reasoning lib/prestige.js uses. That leaves
-- Handstand III with exactly one real side quest: SEVEN.
--
-- All this migration adds is the PER-PLAYER state: has this player taken the
-- upgrade on this chain? A row's presence = yes.

CREATE TABLE IF NOT EXISTS public.student_quest_upgrades (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  class_id    uuid NOT NULL REFERENCES public.classes(id)  ON DELETE CASCADE,
  -- The BASE chain's slug (e.g. 'comboes') — never the upgrade's. One upgrade
  -- per base chain per player, so the app can ask "is comboes upgraded?"
  -- without knowing what it upgrades into.
  base_chain  text NOT NULL,
  upgraded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, base_chain)
);

CREATE INDEX IF NOT EXISTS student_quest_upgrades_student_class_idx
  ON public.student_quest_upgrades (student_id, class_id);

ALTER TABLE public.student_quest_upgrades ENABLE ROW LEVEL SECURITY;

-- Self-scoped, exactly like `student_quest_completions`: the player owns their
-- own progression. Admin-as-coach (StudentDetailScreen → a player's Skills) gets
-- the same additive full access it has on the rest of the quest tables, via the
-- existing SECURITY DEFINER helper `public.is_admin()`.
DROP POLICY IF EXISTS "own quest upgrades"   ON public.student_quest_upgrades;
DROP POLICY IF EXISTS "admin quest upgrades" ON public.student_quest_upgrades;

CREATE POLICY "own quest upgrades"
  ON public.student_quest_upgrades FOR ALL
  USING      ( auth.uid() = student_id )
  WITH CHECK ( auth.uid() = student_id );

CREATE POLICY "admin quest upgrades"
  ON public.student_quest_upgrades FOR ALL
  USING      ( public.is_admin() )
  WITH CHECK ( public.is_admin() );
