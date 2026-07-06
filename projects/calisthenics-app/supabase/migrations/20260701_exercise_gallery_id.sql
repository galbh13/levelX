-- Link a workout exercise to its SOURCE catalog exercise (exercises_gallery), so
-- Workout Mode can open the correct how-to card (video + coaching cues) by a stable
-- id instead of fragile name matching. Both workout builders (Create/Edit Workout)
-- pick exercises from the gallery, so the id is available at authoring time — it was
-- previously discarded, leaving only the free-text `name` to match on.
--
-- Nullable: legacy rows and any free-text/imported exercises stay NULL and Workout
-- Mode falls back to normalized-name matching. ON DELETE SET NULL so removing a
-- catalog exercise just drops the link (the workout row keeps its copied name).

ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS gallery_id uuid
  REFERENCES exercises_gallery(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS exercises_gallery_id_idx ON exercises(gallery_id);

COMMENT ON COLUMN exercises.gallery_id IS
  'FK -> exercises_gallery(id): the catalog exercise this row was picked from in the '
  'workout builder. Drives Workout Mode''s how-to card. NULL for legacy/free-text '
  'rows (Workout Mode falls back to name matching).';
