-- Add class-level tagging to exercises_gallery
-- min_class_order: which class level this exercise targets
--   NULL  = suitable for all classes
--   0     = Class I (beginner)
--   1     = Class II (intermediate)
--   2     = Class III (advanced)

ALTER TABLE exercises_gallery
  ADD COLUMN IF NOT EXISTS min_class_order integer;

COMMENT ON COLUMN exercises_gallery.min_class_order IS
  'Class level this exercise primarily targets (0=Class I, 1=Class II, 2=Class III, NULL=all).';
