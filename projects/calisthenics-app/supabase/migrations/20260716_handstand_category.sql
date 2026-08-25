-- Add a new workout type bucket: 'handstand' (sits between 'side' and 'accessory'
-- in the UI). Widens the CHECK constraints on both category columns so gallery
-- example workouts and players' own workouts can be typed as handstand training.
-- See WORKOUT_CATEGORIES in lib/workouts.js for the app-side list + color.

-- Gallery example workouts.
alter table public.gallery_example_workouts
  drop constraint if exists gallery_example_workouts_category_check;
alter table public.gallery_example_workouts
  add constraint gallery_example_workouts_category_check
  check (category in ('main', 'side', 'handstand', 'accessory', 'legs'));

-- Players' own workouts (NULL still allowed for legacy/untyped rows).
alter table public.workouts
  drop constraint if exists workouts_category_check;
alter table public.workouts
  add constraint workouts_category_check
  check (category is null or category in ('main', 'side', 'handstand', 'accessory', 'legs'));
