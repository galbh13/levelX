-- THE 4-WEEK PLAN — the coach's onboarding runway, and the clock that runs it
-- ─────────────────────────────────────────────────────────────────────────────
-- Run this whole file on the live project. It is IDEMPOTENT and safe to re-run:
-- every create is `if not exists`, every policy is dropped before it is made, the
-- one column drop is `if exists`, and the backfill at the bottom is
-- `on conflict do nothing`. It also converges a database that got the 2026-09-18
-- cut of the plan table (which had a `focus` column) — that column is dropped
-- here. Supersedes 20260918_four_week_plan.sql + 20260919_plan_start.sql, which
-- were folded into this one file on 2026-09-19 and deleted.
--
-- WHY IT EXISTS
-- A new disciple lands in a system with a quest tree, a class ladder, daily
-- quests, workouts and a weekly check-up all switched on at once. The check-up
-- cycle (checkup_goals) only starts producing direction AFTER the first
-- submission — which leaves the first month, the month people quit in, with no
-- map. This is that map: four weeks, written by the coach ONCE, read by the
-- player from the 4-WEEK PLAN node on their PROFILE tab. It is for the player
-- who is brand NEW, or the one who got STUCK.
--
-- TWO TABLES, TWO QUESTIONS
--   plan_weeks — WHAT each week is. Four rows per player.
--   plan_runs  — WHEN it started. One row per player, and every number the
--                screen shows (which week, which day of it, how many days left,
--                the calendar range on each card) is derived from that one date.
--
-- WHO WRITES IT. The coach alone, and they write it from the PLAYER's own
-- PROFILE screen (AdminDashboard → player → PROFILE → 4-WEEK PLAN), which is the
-- admin copy of the player's screen — so the coach authors the plan inside the
-- exact page the player reads it in. Every write leans on the same is_admin()
-- helper the rest of the admin surface uses (defined in
-- 20260604_gallery_add_exercise_fixes.sql).
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══ 1. plan_weeks — the content ═══════════════════════════════════════════════
--
-- FOUR WEEKS, NOT N. The week count is fixed at four on purpose — it is a
-- runway, not a programme. `week_index` is CHECK-constrained to 1..4 so nothing
-- (a stray write, a future screen) can quietly turn it into an open-ended plan.
--
-- ONE ROW PER WEEK, four per player, unique on (student_id, week_index) — so the
-- editor upserts a week without having to know whether it already exists, and a
-- player with no plan is simply a player with no rows. There is no parent `plan`
-- row and no publish flag: an unwritten week is an EMPTY week, and the node
-- itself tells the player their coach hasn't written it yet. A second table and
-- a draft/published state would buy nothing for a four-row document only one
-- person ever edits.
--
-- THREE FIELDS PER WEEK, because that is the shape of the answer the coach gives:
--   goal     — what this week is FOR, one line. The headline.
--   guidance — what to actually do. The paragraph.
--   modules  — which pieces of the course to watch this week.
-- All three are nullable text: a coach who only writes a goal for week 4 gets a
-- week 4 with a goal, not a validation error.

create table if not exists public.plan_weeks (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid     not null references public.profiles(id) on delete cascade,
  week_index  smallint not null check (week_index between 1 and 4),
  -- The three fields of a week. All nullable — a half-written plan is a valid
  -- plan, and the screen renders whatever is there.
  goal        text,
  guidance    text,
  modules     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- One row per week per player. This is what lets the editor UPSERT a week
  -- blind, with no read-then-insert-or-update dance.
  unique (student_id, week_index)
);

-- A fourth field, `focus` ("what to watch for in yourself as the week passes"),
-- was cut on 2026-09-19: it said what goal and guidance already said, one box
-- further down. Dropped here so a database that got the 2026-09-18 cut converges
-- with one that is seeing this file for the first time.
alter table public.plan_weeks drop column if exists focus;

-- The only read anyone makes is this player's four weeks, in order. The unique
-- constraint above already indexes (student_id, week_index), so no second index.

alter table public.plan_weeks enable row level security;

-- The coach authors everything.
drop policy if exists "admin all plan weeks" on public.plan_weeks;
create policy "admin all plan weeks"
  on public.plan_weeks for all to authenticated
  using ( public.is_admin() ) with check ( public.is_admin() );

-- The player READS their own plan and nothing else. Deliberately no update
-- policy: unlike checkup_goals there is no tick here — the plan is something the
-- player follows, not something they fill in. If a per-week "done" tick is ever
-- added, it needs BOTH an update policy AND a column guard trigger (see
-- 20260918_checkup_goals.sql's checkup_goal_guard for the pattern), or the
-- player could rewrite the coach's words.
drop policy if exists "owner read plan weeks" on public.plan_weeks;
create policy "owner read plan weeks"
  on public.plan_weeks for select to authenticated
  using ( auth.uid() = student_id );


-- ═══ 2. plan_runs — the clock ══════════════════════════════════════════════════
--
-- plan_weeks says WHAT each week is; it says nothing about WHEN. Without a start
-- date the player has to remember which week they are in, and "which week am I
-- in" is exactly the guess the plan exists to remove — a player who is three days
-- behind can't know they are behind, so they never make up the ground.
--
-- So the coach STARTS the plan: today or tomorrow, on a button, at the moment
-- they hand it over. That one date is all the clock needs — everything else is
-- derived, so there is no per-week state to keep in sync and nothing to migrate
-- if the maths changes.
--
-- WHY ITS OWN TABLE rather than a column on `profiles`: `profiles` is read by
-- nearly every screen in the app, and a missing column there fails the WHOLE
-- PostgREST select (the lesson of 20260904_profile_bio_goal.sql) — an unmigrated
-- live DB would take the Player Card down with it. Here a missing table degrades
-- to "the coach hasn't started your plan yet", which is a real state anyway.
--
-- WHY A DATE AND NOT A TIMESTAMP: the plan is counted in whole days, in the
-- coach's calendar. `lib/israelDate.js` is the app's day boundary (Asia/Jerusalem)
-- and every comparison is plain YYYY-MM-DD string maths, so a player opening the
-- app at 23:00 and again at 01:00 does not skip a day.
--
-- RE-STARTABLE ON PURPOSE. The player this is for is either brand new OR stuck,
-- and the stuck one gets the same four weeks pointed at again from today. The
-- coach just presses START again; the row is upserted, the clock resets, and the
-- weeks themselves are untouched.

create table if not exists public.plan_runs (
  -- The player IS the key: one live run of the plan each. Re-starting overwrites
  -- rather than accumulating — a history of past runs is not something either
  -- side of the app asks a question about.
  student_id  uuid primary key references public.profiles(id) on delete cascade,
  -- Day 1 of week 1, in the coach's calendar. Nothing here is UTC-relative.
  started_on  date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.plan_runs enable row level security;

-- The coach starts, re-starts and clears it.
drop policy if exists "admin all plan runs" on public.plan_runs;
create policy "admin all plan runs"
  on public.plan_runs for all to authenticated
  using ( public.is_admin() ) with check ( public.is_admin() );

-- The player reads their own start date. No update policy, for the same reason
-- plan_weeks has none: the plan is the coach's, and a player who could move their
-- own start date could delete the fact that they are behind — which is the one
-- number this whole table exists to show them.
drop policy if exists "owner read plan runs" on public.plan_runs;
create policy "owner read plan runs"
  on public.plan_runs for select to authenticated
  using ( auth.uid() = student_id );


-- ═══ 3. Backfill — the plans that existed before the clock did ═════════════════
--
-- Plans written against the 2026-09-18 cut have content but no start date, and
-- would render un-clocked until the coach pressed START. The answer for those is
-- "it starts today", so they are started here rather than by hand.
--
-- Scoped to players who ALREADY have weeks written: a start date on a player with
-- no plan would put a running clock on an empty screen. ON CONFLICT DO NOTHING so
-- this is safe to re-run and can never overwrite a date the coach has since set.
--
-- The date is taken in Asia/Jerusalem to match lib/israelDate.js — `current_date`
-- alone is the server's timezone and can be a day off from the app's own idea of
-- today.
insert into public.plan_runs (student_id, started_on)
select distinct w.student_id, (now() at time zone 'Asia/Jerusalem')::date
from public.plan_weeks w
on conflict (student_id) do nothing;
