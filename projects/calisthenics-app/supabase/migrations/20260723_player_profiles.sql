-- Player profiles — Hunter Status (2026-07-23)
--
-- Re-introduces a small player profile surface (the "Hunter Status" screen):
-- a PORTRAIT (profile picture) and a single SIGNATURE MOVE video ("their best
-- clip"). The rest of the status screen (name · LVL · class · prestige stars) is
-- DERIVED live — nothing new stored for it.
--
-- NOTE: the earlier vanity columns (nickname/bio/avatar_url) were dropped in the
-- 2026-07-14 checkup refactor. This adds back ONLY what the new screen needs.
--   avatar_url            — public URL of the profile picture
--   avatar_path           — its storage path (to delete the old file on replace)
--   signature_video_url   — public URL of the one signature clip
--   signature_video_path  — its storage path (to delete the old file on replace)
--
-- The NAME (profiles.full_name) is intentionally NOT editable here — a player's
-- name is set once and unchangeable; the status screen shows it read-only.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url           text,
  ADD COLUMN IF NOT EXISTS avatar_path          text,
  ADD COLUMN IF NOT EXISTS signature_video_url  text,
  ADD COLUMN IF NOT EXISTS signature_video_path text;

-- ── Owner self-update (defensive) ────────────────────────────────────────────
-- The player writes their own avatar/signature onto their profile row. An owner
-- self-update policy should already exist (players self-manage class_id), but the
-- live DB has drifted from these migrations, so (re)create it idempotently. RLS
-- is row-level (not column-level), so this covers the new columns too. Permissive
-- policies are OR'd, so the admin-override policy from 20260621 is untouched.
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update to authenticated
  using ( auth.uid() = id )
  with check ( auth.uid() = id );

-- Reads: the owner reads their own row (schema.sql), the admin reads all
-- (20260621), and group co-members read each other's row via the existing
-- `read co-member profiles` / shares_group_with policy (20260717) — that already
-- returns the WHOLE row, so viewing a co-member's Hunter Status needs no new read
-- policy. (Portraits/clips are ALSO public via the storage bucket below.)

-- ── Storage: the `profile-media` bucket (portraits + signature clips) ─────────
-- ONE public bucket holds both the avatar image and the signature video, keyed by
-- user folder: `<user_id>/avatar-<ts>.<ext>` and `<user_id>/signature-<ts>.<ext>`.
-- Public so any viewer can load a co-member's portrait/clip. 50 MB file limit
-- (the app also checks blob size before upload). Unlike checkup clips, these are
-- PERMANENT — so uploads REPLACE (delete the previous file) instead of piling up.
insert into storage.buckets (id, name, public, file_size_limit)
values ('profile-media', 'profile-media', true, 52428800)
on conflict (id) do update set public = true, file_size_limit = 52428800;

-- A "public" bucket only makes READS public; writes still need policies on
-- storage.objects. A signed-in player may upload/replace/delete files inside
-- their OWN `<user_id>/…` folder; anyone may read.
drop policy if exists "profile media public read" on storage.objects;
create policy "profile media public read"
  on storage.objects for select
  using ( bucket_id = 'profile-media' );

drop policy if exists "profile media insert own" on storage.objects;
create policy "profile media insert own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "profile media update own" on storage.objects;
create policy "profile media update own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'profile-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "profile media delete own" on storage.objects;
create policy "profile media delete own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'profile-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
