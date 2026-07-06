-- Backfill: convert leftover 'Accessories' movement_type rows to 'Isolated'.
-- ─────────────────────────────────────────────────────────────────────────────
-- The 'Accessories' value was briefly used in the UI before being renamed to
-- 'Isolated'. The rename migration (20260623_movement_type_isolated.sql) was
-- never applied to the live DB, so exercises saved with the old value are stuck
-- with a movement_type the current UI no longer offers — they show under no
-- filter and can't be re-categorised in-app.
--
-- This migration is standalone and case-insensitive (the value was hand-typed,
-- so casing/spelling may vary). It (1) drops the CHECK constraint so the update
-- can't be blocked, (2) migrates any 'accessor…' row to 'Isolated', (3) recreates
-- the constraint with the current UI values + the legacy values still on old rows.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table exercises_gallery
  drop constraint if exists exercises_gallery_movement_type_check;

-- Case-insensitive match catches 'Accessories', 'accessories', 'Accesories', etc.
update exercises_gallery
  set movement_type = 'Isolated'
  where movement_type ilike 'access%';

alter table exercises_gallery
  add constraint exercises_gallery_movement_type_check
  check (movement_type in (
    'Pull', 'Push', 'Balance', 'Legs', 'Core', 'Mobility', 'Flexibility', 'Isolated',
    'Strength', 'Skill', 'Conditioning'
  ));
