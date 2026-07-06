-- Give a player's OWN workouts a type/category, mirroring the gallery's
-- `gallery_example_workouts.category` buckets (main | side | accessory | legs).
-- Until now only gallery example workouts carried a category; on elite import the
-- value was dropped because `workouts` had nowhere to store it. This adds the
-- column so "My Workouts" can label each card and imports can carry the type over.
alter table public.workouts
  add column if not exists category text;

alter table public.workouts
  drop constraint if exists workouts_category_check;

-- Allow the known buckets, plus NULL for legacy/untyped workouts.
alter table public.workouts
  add constraint workouts_category_check
  check (category is null or category in ('main', 'side', 'accessory', 'legs'));

comment on column public.workouts.category is
  'Workout type bucket: main | side | accessory | legs (mirrors gallery_example_workouts.category). NULL = untyped (legacy rows / unset). Copied from the gallery row on elite import; set in Create/Edit Workout.';
