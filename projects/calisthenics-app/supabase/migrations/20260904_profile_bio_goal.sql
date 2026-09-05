-- The player's own words on the PROFILE tab — bio + end goal (2026-09-04)
--
-- The System tab became PROFILE: a portrait, one editable node (PLAYER & GOALS)
-- and one locked node (THE SYSTEM [coming soon...]). The editable node writes
-- these two columns; nothing else reads them, and nothing is derived from them.
--
-- `bio`      — "who is this player" in their own words (free text).
-- `end_goal` — the skill/outcome they are chasing (free text).
--
-- Both are player-written and player-owned. The existing owner-update policy on
-- `profiles` (`auth.uid() = id`, plus the additive admin override from
-- 20260621_admin_manage_players.sql) already covers them — the same policy the
-- Player Card's avatar upload writes through — so no new policy is needed.
--
-- Idempotent — safe to re-run. (This project's live schema has drifted from
-- migrations before, so run it in Supabase → SQL Editor and don't assume.)

alter table public.profiles
  add column if not exists bio text;

alter table public.profiles
  add column if not exists end_goal text;
