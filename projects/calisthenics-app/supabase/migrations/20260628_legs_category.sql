-- Add a new "legs" gallery category.
-- The live `gallery_example_workouts.category` has a CHECK constraint
-- (gallery_example_workouts_category_check) restricting it to the known buckets,
-- so the new value must be allowed before any row can use it.
alter table gallery_example_workouts
  drop constraint if exists gallery_example_workouts_category_check;

alter table gallery_example_workouts
  add constraint gallery_example_workouts_category_check
  check (category in ('main', 'side', 'accessory', 'legs'));

-- Move the three leg-day example workouts into the new bucket.
update gallery_example_workouts
set category = 'legs'
where title in ('CHICKEN LEGS 1.0', 'CHICKEN LEGS 2.0', 'EXPLOSIVE LEGS');
