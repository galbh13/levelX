-- ─── profiles ───────────────────────────────────────────────────────────────
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text,
  role       text not null check (role in ('admin', 'coach', 'student')),
  coach_id   uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- Auto-insert a profile row when a new auth user is created
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ─── workouts ────────────────────────────────────────────────────────────────
create table workouts (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  purpose        text,
  assigned_to    uuid references profiles(id) on delete cascade,
  created_by     uuid references profiles(id) on delete set null,
  scheduled_date date,
  created_at     timestamptz default now()
);

-- ─── exercises ───────────────────────────────────────────────────────────────
create table exercises (
  id         uuid primary key default gen_random_uuid(),
  workout_id uuid references workouts(id) on delete cascade,
  letter     text,
  name       text not null,
  sets       integer,
  reps       text,
  notes      text
);

-- ─── Row Level Security ──────────────────────────────────────────────────────
alter table profiles  enable row level security;
alter table workouts  enable row level security;
alter table exercises enable row level security;

-- Profiles: users can read their own row; admins/coaches can read all
create policy "Users can view own profile"
  on profiles for select
  using (auth.uid() = id);

-- Workouts: students see their own; coaches see workouts they created
create policy "Students see own workouts"
  on workouts for select
  using (auth.uid() = assigned_to);

create policy "Coaches see workouts they created"
  on workouts for select
  using (auth.uid() = created_by);

-- Exercises: visible if the parent workout is visible
create policy "Exercises visible with workout"
  on exercises for select
  using (
    exists (
      select 1 from workouts w
      where w.id = workout_id
        and (w.assigned_to = auth.uid() or w.created_by = auth.uid())
    )
  );
