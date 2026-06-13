-- Remove EXP from the system.
--
-- EXP has been removed from the app entirely (no LEVEL/EXP card, no "+1 EXP"
-- daily-quest reward, no EXP stat on Workouts). The displayed EXP was always
-- DERIVED from completion counts, never read from this column, so dropping
-- `profiles.total_exp` loses no data the UI relied on. LVL (computed from quest
-- completions) and prestige (`profiles.prestige_count`) are unaffected.

alter table public.profiles
  drop column if exists total_exp;
