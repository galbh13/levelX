-- Weekly GOALS — the face of the check-up
-- ─────────────────────────────────────────────────────────────────────────────
-- A check-up used to open on a form. It now opens on the player's MISSION: the
-- short list of goals the coach set for THIS week, ticked off one by one, with
-- the form underneath it and SUBMIT CHECK-UP at the end. Nothing about the
-- submission itself changes — the goals sit in front of it.
--
-- THE CYCLE
--   1. The coach reviews a check-up and replies (feedback video / note). In the
--      same breath they write the goals for the week that follows — right next
--      to the note, because that is the moment they know what to ask for.
--      Those rows carry source_checkup_id = the check-up being replied to.
--   2. The player sees them at the top of their check-up screen all week and
--      ticks them as they land (done / done_at, written the moment they tap).
--   3. When the player SUBMITS the next check-up, every still-open goal is
--      stamped with result_checkup_id = that submission. That both CLOSES them
--      (they stop being "this week's") and files them under the submission, so
--      the coach's review opens on "4 / 5 achieved" and exactly which one slipped.
--   4. The coach replies to that submission → writes the next week's goals → 1.
--
-- So: ACTIVE goals are the rows with result_checkup_id IS NULL. There is at most
-- one active set per player, and it is authored by the coach alone.
--
-- PURGE. Check-ups are wiped on the 14-day TTL and replaced on every submit (see
-- lib/checkups.js), which is why BOTH checkup references are ON DELETE SET NULL:
-- a goal must outlive the check-up it was written on — otherwise the space policy
-- would quietly delete the week's mission out from under the player. Goals are a
-- few hundred bytes of text; they are kept.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.checkup_goals (
  id                 uuid primary key default gen_random_uuid(),
  student_id         uuid not null references public.profiles(id) on delete cascade,
  -- The reply this goal was written on. SET NULL: the check-up is purged long
  -- before the goal stops mattering.
  source_checkup_id  uuid references public.checkups(id) on delete set null,
  -- The submission that closed this goal. NULL = still this week's mission.
  result_checkup_id  uuid references public.checkups(id) on delete set null,
  text               text not null,
  order_index        int  not null default 0,
  done               boolean not null default false,
  done_at            timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists checkup_goals_student_idx on public.checkup_goals (student_id);
-- The read the player screen makes on every load: this student's OPEN goals.
create index if not exists checkup_goals_active_idx
  on public.checkup_goals (student_id, order_index) where result_checkup_id is null;
-- The read the coach's review makes: the goals filed under one submission.
create index if not exists checkup_goals_result_idx on public.checkup_goals (result_checkup_id);

alter table public.checkup_goals enable row level security;

-- The coach authors everything (same is_admin() helper as the rest of check-ups).
drop policy if exists "admin all checkup goals" on public.checkup_goals;
create policy "admin all checkup goals"
  on public.checkup_goals for all to authenticated
  using ( public.is_admin() ) with check ( public.is_admin() );

-- The player READS their own goals and UPDATES them — but see the trigger below:
-- the only columns that actually move are the tick and the close stamp.
drop policy if exists "owner read checkup goals" on public.checkup_goals;
create policy "owner read checkup goals"
  on public.checkup_goals for select to authenticated
  using ( auth.uid() = student_id );

drop policy if exists "owner tick checkup goals" on public.checkup_goals;
create policy "owner tick checkup goals"
  on public.checkup_goals for update to authenticated
  using ( auth.uid() = student_id ) with check ( auth.uid() = student_id );

-- The teeth behind the policy above. A player may tick a goal and (at submit) file
-- it under their submission; they may NOT rewrite the goal's text, its order or
-- its owner — the mission is the coach's. A column-level GRANT can't say this:
-- the coach authenticates as the same `authenticated` role and would lose the
-- ability to edit. So the write is pinned per-row instead, admin exempt.
create or replace function public.checkup_goal_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return new; end if;
  new.student_id        := old.student_id;
  new.source_checkup_id := old.source_checkup_id;
  new.text              := old.text;
  new.order_index       := old.order_index;
  new.created_at        := old.created_at;
  return new;
end $$;

drop trigger if exists checkup_goal_guard on public.checkup_goals;
create trigger checkup_goal_guard
  before update on public.checkup_goals
  for each row execute function public.checkup_goal_guard();
