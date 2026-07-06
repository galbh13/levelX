-- Categorize example workouts: Main Quest / Side Quest / Accessories.
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds a `category` bucket to gallery_example_workouts so the gallery (and elite
-- import) can filter within a class. Existing rows default to 'main' (per the
-- request — most current workouts are main-quest; the rest are re-tagged by hand).
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table gallery_example_workouts
  add column if not exists category text not null default 'main';

alter table gallery_example_workouts
  drop constraint if exists gallery_example_workouts_category_check;
alter table gallery_example_workouts
  add constraint gallery_example_workouts_category_check
  check (category in ('main', 'side', 'accessory'));
