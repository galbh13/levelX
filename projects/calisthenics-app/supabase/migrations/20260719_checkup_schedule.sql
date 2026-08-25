-- Check-up schedule — a recurring weekly check-up DAY per player
-- ─────────────────────────────────────────────────────────────────────────────
-- The admin (coach) sets which weekday a player submits their check-up on (e.g.
-- "every Tuesday"). It's a systematic pattern, not a one-off: the player sees the
-- next due date on their check-up screen, with a one-day grace window (submitting
-- the day AFTER still counts, for when life happens).
--
-- Stored on profiles so it lives with the player and reads/writes ride the
-- existing profiles RLS (owner reads own row; the is_admin() override in
-- 20260621_admin_manage_players.sql lets the admin write another player's).
-- 0 = Sunday … 6 = Saturday. NULL = no check-up day set yet.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles add column if not exists checkup_day smallint;

comment on column public.profiles.checkup_day is
  '0=Sun..6=Sat recurring weekly check-up day set by the admin; NULL = unscheduled';
