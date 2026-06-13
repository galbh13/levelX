-- Profile personalization fields (2026-06-07)
--
-- Adds the player-facing profile fields edited on the new Profile tab
-- (screens/ProfileScreen.js), and drops the now-unused `guiding_phrase` column.
-- The profile "sentence" lives in the new `bio` column instead.
--
--   nickname   — short display handle, separate from full_name
--   bio        — one-sentence tagline shown on the profile
--   avatar_url — public URL of the uploaded profile picture
--
-- Profile pictures are stored in a PUBLIC Supabase Storage bucket named `avatar`
-- (create it in the dashboard: Storage → New bucket → name `avatar`, public ON).
-- `avatar_url` holds the public URL from getPublicUrl(), the same pattern used by
-- exercises_gallery.video_url + the `exercise-videos` bucket. For uploads to work
-- with the anon/authenticated client, give the bucket an INSERT policy for the
-- `authenticated` role (mirror the existing exercise-videos bucket policy).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS nickname   text,
  ADD COLUMN IF NOT EXISTS bio        text,
  ADD COLUMN IF NOT EXISTS avatar_url text;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS guiding_phrase;

-- ── Storage RLS for the `avatar` bucket ──────────────────────────────────────
-- A "public" bucket only makes READS public; uploads still need a write policy
-- on storage.objects, or the client gets "new row violates row-level security
-- policy". These let a signed-in player upload/replace files inside their OWN
-- folder (path is `<user_id>/<timestamp>.<ext>`, written by ProfileScreen), and
-- let anyone read avatars. Run these once (the bucket must already exist).

create policy "avatar_read_all"
  on storage.objects for select
  using ( bucket_id = 'avatar' );

create policy "avatar_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatar'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatar_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatar'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
