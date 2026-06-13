-- Add storage-backed video URL to exercises_gallery
-- Separate from youtube_url so both can coexist on an exercise.
-- Storage bucket needed: create "exercise-videos" as PUBLIC in Supabase dashboard.

ALTER TABLE exercises_gallery
  ADD COLUMN IF NOT EXISTS video_url text;

COMMENT ON COLUMN exercises_gallery.video_url IS
  'Supabase Storage public URL for a locally uploaded exercise demo video. Takes priority over youtube_url in the detail view.';
