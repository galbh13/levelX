-- Challenges (2026-06-07)
--
-- Admin-authored challenges shown to every player on the Challenges tab
-- (screens/ChallengesScreen.js, which replaced the placeholder Chat screen).
-- Admins create/delete them; all players read them.
--
--   title       — challenge name (required)
--   description — what the challenge is
--   reward      — optional flavor reward shown as a gold badge
--   active      — soft-visibility flag (queries filter active = true)
--   created_by  — the admin who authored it

create table if not exists public.challenges (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  reward      text,
  active      boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

alter table public.challenges enable row level security;

-- Any signed-in user can read challenges; only admins can write them. `is_admin()`
-- is the existing SECURITY DEFINER helper (checks profiles.role = 'admin' without
-- tripping profiles' own RLS) — same one the exercises_gallery insert policy uses.
create policy "challenges_select_all"
  on public.challenges for select to authenticated
  using ( true );

create policy "challenges_admin_insert"
  on public.challenges for insert to authenticated
  with check ( public.is_admin() );

create policy "challenges_admin_update"
  on public.challenges for update to authenticated
  using ( public.is_admin() );

create policy "challenges_admin_delete"
  on public.challenges for delete to authenticated
  using ( public.is_admin() );
