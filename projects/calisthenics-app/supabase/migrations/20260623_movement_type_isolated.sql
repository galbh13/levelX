-- Add "Isolated" as a valid exercise movement type (was briefly "Accessories").
-- ─────────────────────────────────────────────────────────────────────────────
-- exercises_gallery.movement_type is gated by a CHECK constraint
-- (`exercises_gallery_movement_type_check`, see 20260622_movement_type_core.sql).
-- This migration: (1) drops the constraint, (2) migrates any rows already saved
-- as the short-lived 'Accessories' value to 'Isolated', (3) recreates the
-- constraint with the current UI values + 'Isolated' + the legacy values still
-- present on old rows so existing data validates. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table exercises_gallery
  drop constraint if exists exercises_gallery_movement_type_check;

-- Rename the briefly-used 'Accessories' value to 'Isolated'.
update exercises_gallery
  set movement_type = 'Isolated'
  where movement_type = 'Accessories';

alter table exercises_gallery
  add constraint exercises_gallery_movement_type_check
  check (movement_type in (
    'Pull', 'Push', 'Balance', 'Legs', 'Core', 'Mobility', 'Flexibility', 'Isolated',
    'Strength', 'Skill', 'Conditioning'
  ));
