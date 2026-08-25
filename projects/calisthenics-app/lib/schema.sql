-- ─── profiles ───────────────────────────────────────────────────────────────
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text,
  -- Captured at invite time so the coach can add them to the WhatsApp community.
  phone      text,
  role       text not null default 'player' check (role in ('admin', 'player')),
  coach_id   uuid references profiles(id) on delete set null,  -- legacy/unused since self-coach refactor
  -- Invited players start on a SHARED starter password, so they must replace it
  -- before the app opens (App.js → SetPasswordScreen). See migrations/20260825_invite_player.sql.
  must_change_password boolean not null default false,
  created_at timestamptz default now()
);

-- Auto-insert a profile row when a new auth user is created (defaults to player).
-- `full_name` / `phone` / `must_change_password` ride in on the auth user's
-- metadata, so an invite is one atomic createUser call with no follow-up write
-- racing this trigger.
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email, role, full_name, phone, must_change_password)
  values (
    new.id,
    new.email,
    'player',
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', '')), ''),
    coalesce((new.raw_user_meta_data ->> 'must_change_password')::boolean, false)
  );
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

-- Profiles: users can read their own row
create policy "Users can view own profile"
  on profiles for select
  using (auth.uid() = id);

-- Workouts: players own their workouts (assigned_to = created_by = self)
create policy "Players see workouts assigned to them"
  on workouts for select
  using (auth.uid() = assigned_to);

create policy "Players see workouts they created"
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
