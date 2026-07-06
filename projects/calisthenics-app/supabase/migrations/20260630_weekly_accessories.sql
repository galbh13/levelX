-- Weekly Accessories — extra "do-whenever" accessory / legs work
-- ─────────────────────────────────────────────────────────────────────────────
-- A self-managed list of accessory or legs movements the player wants to hit a
-- target number of times per week, performed AD HOC (not tied to a scheduled
-- workout day, so they don't compete with the fatigue-managed program). Mirrors
-- the daily_quests / daily_quest_completions design: a soft-deletable list table
-- plus a per-completion table, counted within the current Sun–Sat week.
--
-- Owner-only RLS (auth.uid() = student_id) + additive admin-override policies
-- (public.is_admin()) so an admin acting as coach can manage a player's list,
-- matching 20260621_admin_manage_players.sql.
-- Safe to re-run: tables are IF NOT EXISTS, policies are dropped-if-exists first.
-- ─────────────────────────────────────────────────────────────────────────────

-- The list — one row per accessory per player.
create table if not exists weekly_accessories (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references profiles(id) on delete cascade,
  name            text not null check (char_length(name) <= 80),
  target_per_week smallint not null default 1 check (target_per_week between 1 and 21),
  active          boolean not null default true,   -- soft-delete; preserves history
  created_at      timestamptz not null default now()
);
create index if not exists weekly_accessories_student_active_idx
  on weekly_accessories (student_id, active);

alter table weekly_accessories enable row level security;

drop policy if exists "own accessories" on weekly_accessories;
create policy "own accessories"
  on weekly_accessories for all to authenticated
  using ( auth.uid() = student_id )
  with check ( auth.uid() = student_id );

drop policy if exists "admin all accessories" on weekly_accessories;
create policy "admin all accessories"
  on weekly_accessories for all to authenticated
  using ( public.is_admin() )
  with check ( public.is_admin() );

-- The completions — one row per "I did it once". Count the rows whose
-- completion_date falls in the current Sun–Sat week to get this week's progress.
-- No UNIQUE on (accessory, date): the same accessory can be done multiple times
-- in one day, each is its own row.
create table if not exists accessory_completions (
  id              uuid primary key default gen_random_uuid(),
  accessory_id    uuid not null references weekly_accessories(id) on delete cascade,
  student_id      uuid not null references profiles(id) on delete cascade,
  completion_date date not null,
  completed_at    timestamptz not null default now()
);
create index if not exists accessory_completions_student_date_idx
  on accessory_completions (student_id, completion_date);
create index if not exists accessory_completions_accessory_idx
  on accessory_completions (accessory_id);

alter table accessory_completions enable row level security;

drop policy if exists "own accessory completions" on accessory_completions;
create policy "own accessory completions"
  on accessory_completions for all to authenticated
  using ( auth.uid() = student_id )
  with check ( auth.uid() = student_id );

drop policy if exists "admin all accessory completions" on accessory_completions;
create policy "admin all accessory completions"
  on accessory_completions for all to authenticated
  using ( public.is_admin() )
  with check ( public.is_admin() );
