-- Weekly Check-ups
-- ─────────────────────────────────────────────────────────────────────────────
-- When a player finishes a week of training they submit a CHECK-UP: a written
-- reflection on the week + a few short videos of their work. The admin (coach)
-- reviews it on the player dashboard and replies with a feedback video URL (a
-- clip they recorded in another app) + an optional note.
--
-- SPACE POLICY — no history. A check-up (and its uploaded video FILES) is purged
-- 14 days after it was created, client-side, in `lib/checkups.js`
-- (`purgeExpiredCheckups`). CASCADE only removes the DB rows, so the purge takes
-- the storage files out first via `checkup_videos.storage_path`.
--
-- This replaces the old (also removed, then re-added) Profile screen. The profile
-- vanity fields it owned are dropped at the bottom of this file.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── checkups — one row per weekly submission ────────────────────────────────
create table if not exists public.checkups (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.profiles(id) on delete cascade,
  note          text,                    -- the player's written reflection
  submitted_at  timestamptz,             -- NULL = still a draft the player is building
  feedback_url  text,                    -- admin's feedback video URL (external clip)
  feedback_note text,                    -- optional admin text feedback
  feedback_at   timestamptz,             -- when the admin replied (NULL = awaiting)
  created_at    timestamptz not null default now()
);
create index if not exists checkups_student_idx     on public.checkups (student_id);
create index if not exists checkups_created_idx      on public.checkups (created_at);

-- ── checkup_videos — the player's uploaded clips for a check-up ──────────────
create table if not exists public.checkup_videos (
  id           uuid primary key default gen_random_uuid(),
  checkup_id   uuid not null references public.checkups(id) on delete cascade,
  student_id   uuid not null references public.profiles(id) on delete cascade,  -- denormalized for RLS + cheap purge
  storage_path text not null,            -- path inside the checkup-videos bucket (needed to delete the file on purge)
  video_url    text not null,            -- public URL for playback
  created_at   timestamptz not null default now()
);
create index if not exists checkup_videos_checkup_idx on public.checkup_videos (checkup_id);
create index if not exists checkup_videos_student_idx on public.checkup_videos (student_id);

-- ── RLS — owner CRUD + additive admin override (same is_admin() helper) ──────
alter table public.checkups       enable row level security;
alter table public.checkup_videos enable row level security;

drop policy if exists "owner all checkups" on public.checkups;
create policy "owner all checkups"
  on public.checkups for all to authenticated
  using ( auth.uid() = student_id ) with check ( auth.uid() = student_id );

drop policy if exists "admin all checkups" on public.checkups;
create policy "admin all checkups"
  on public.checkups for all to authenticated
  using ( public.is_admin() ) with check ( public.is_admin() );

drop policy if exists "owner all checkup videos" on public.checkup_videos;
create policy "owner all checkup videos"
  on public.checkup_videos for all to authenticated
  using ( auth.uid() = student_id ) with check ( auth.uid() = student_id );

drop policy if exists "admin all checkup videos" on public.checkup_videos;
create policy "admin all checkup videos"
  on public.checkup_videos for all to authenticated
  using ( public.is_admin() ) with check ( public.is_admin() );

-- ── Storage bucket — checkup-videos (public, 50 MB / file server-side limit) ──
-- Public so both player and admin can stream clips. The 50 MB file_size_limit is
-- enforced by Storage itself; the app also checks the blob size before upload.
insert into storage.buckets (id, name, public, file_size_limit)
values ('checkup-videos', 'checkup-videos', true, 52428800)
on conflict (id) do update set public = true, file_size_limit = 52428800;

drop policy if exists "checkup videos public read" on storage.objects;
create policy "checkup videos public read"
  on storage.objects for select
  using ( bucket_id = 'checkup-videos' );

drop policy if exists "checkup videos authed insert" on storage.objects;
create policy "checkup videos authed insert"
  on storage.objects for insert to authenticated
  with check ( bucket_id = 'checkup-videos' );

drop policy if exists "checkup videos authed delete" on storage.objects;
create policy "checkup videos authed delete"
  on storage.objects for delete to authenticated
  using ( bucket_id = 'checkup-videos' );

-- ── Reset the removed Profile screen ────────────────────────────────────────
-- The Profile tab (and everything it owned) is gone, replaced by the check-up.
-- Drop its vanity columns. avatar_url is no longer shown anywhere (admin roster
-- and the manage hero fall back to initials).
alter table public.profiles drop column if exists nickname;
alter table public.profiles drop column if exists bio;
alter table public.profiles drop column if exists avatar_url;
-- (The `avatar` storage bucket is now orphaned — delete it manually in the
--  dashboard if you want the old profile pictures gone.)
