-- Multi-target class for gallery exercises and example workouts.
-- An admin can now point an exercise (or example workout) at 2+ classes.
--
-- `class_orders` (integer[]) holds the full set of class order_index values the
-- item targets:
--   exercises_gallery       — NULL/empty = all classes (mirrors old min_class_order=NULL)
--   gallery_example_workouts — always >= 1 entry (a workout must pick a class)
--
-- The existing scalar columns are KEPT as the representative (minimum) class so
-- ordering (`.order('class_order')`) and any un-migrated reader still work.

ALTER TABLE exercises_gallery
  ADD COLUMN IF NOT EXISTS class_orders integer[];

ALTER TABLE gallery_example_workouts
  ADD COLUMN IF NOT EXISTS class_orders integer[];

-- Backfill the array from the existing scalar values.
UPDATE exercises_gallery
  SET class_orders = ARRAY[min_class_order]
  WHERE min_class_order IS NOT NULL AND class_orders IS NULL;

UPDATE gallery_example_workouts
  SET class_orders = ARRAY[class_order]
  WHERE class_orders IS NULL;

COMMENT ON COLUMN exercises_gallery.class_orders IS
  'Class order_index values this exercise targets. NULL/empty = all classes. Scalar min_class_order kept as the min for ordering/back-compat.';
COMMENT ON COLUMN gallery_example_workouts.class_orders IS
  'Class order_index values this workout targets (>= 1). Scalar class_order kept as the min for ordering/back-compat.';
