-- Add "Core" as a valid exercise movement type.
-- ─────────────────────────────────────────────────────────────────────────────
-- exercises_gallery.movement_type is gated by a CHECK constraint
-- (`exercises_gallery_movement_type_check`, see 20260604_gallery_add_exercise_fixes.sql).
-- Without adding 'Core' to it, saving a Core exercise is rejected by the DB.
-- Recreate the constraint with the current UI values + 'Core' + the legacy values
-- still present on old rows (Strength/Skill/Conditioning) so existing data validates.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table exercises_gallery
  drop constraint if exists exercises_gallery_movement_type_check;

alter table exercises_gallery
  add constraint exercises_gallery_movement_type_check
  check (movement_type in (
    'Pull', 'Push', 'Balance', 'Legs', 'Core', 'Mobility', 'Flexibility',
    'Strength', 'Skill', 'Conditioning'
  ));
