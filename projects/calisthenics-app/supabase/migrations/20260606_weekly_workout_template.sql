-- Weekly training skeleton (recurring template).
--
-- Per-date scheduling lives in `workout_override_workouts` (specific_date). This
-- table adds a RECURRING weekly plan keyed by day-of-week: the default workout(s)
-- for each weekday. Resolution at read time (see lib/schedule.js): for a given
-- date, if `workout_override_workouts` rows exist for that exact date they win;
-- otherwise the date shows this template's rows for that weekday.
--
-- 0 = Sunday … 6 = Saturday (matches JS Date.getDay()).

create table if not exists public.weekly_workout_template (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.profiles(id) on delete cascade,
  coach_id    uuid references public.profiles(id) on delete set null, -- self
  day_of_week smallint not null check (day_of_week between 0 and 6),
  workout_id  uuid not null references public.workouts(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (student_id, day_of_week, workout_id)
);

create index if not exists weekly_workout_template_student_idx
  on public.weekly_workout_template (student_id);

-- RLS — owner can CRUD their own rows. Mirror the policy on
-- `workout_override_workouts`; verify against the live table after applying.
alter table public.weekly_workout_template enable row level security;

create policy "owner manages own weekly template"
  on public.weekly_workout_template
  for all
  using (auth.uid() = student_id)
  with check (auth.uid() = student_id);
