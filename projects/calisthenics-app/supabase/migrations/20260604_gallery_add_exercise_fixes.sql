-- Fixes to make AddExerciseScreen inserts work against exercises_gallery.
-- The live DB had drifted from the app: missing coaching_cues column, a stale
-- movement_type CHECK constraint (only legacy values), and no admin INSERT policy.
-- This migration brings the schema back in line with the app.

-- 1. Missing column the insert payload references.
ALTER TABLE exercises_gallery
  ADD COLUMN IF NOT EXISTS coaching_cues text;

COMMENT ON COLUMN exercises_gallery.coaching_cues IS
  'Newline-separated coaching cues entered in AddExerciseScreen.';

-- 2. movement_type CHECK constraint allowed only the legacy values
--    (Strength/Skill/Conditioning). The UI now uses the calisthenics set.
--    Legacy values are kept so pre-existing rows still validate.
ALTER TABLE exercises_gallery
  DROP CONSTRAINT IF EXISTS exercises_gallery_movement_type_check;

ALTER TABLE exercises_gallery
  ADD CONSTRAINT exercises_gallery_movement_type_check
  CHECK (movement_type IN (
    'Pull','Push','Balance','Legs','Mobility','Flexibility',
    'Strength','Skill','Conditioning'
  ));

-- 3. Admin-only INSERT policy. Uses a SECURITY DEFINER helper so the role
--    lookup is not itself subject to profiles' RLS.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

DROP POLICY IF EXISTS "Admin insert exercises" ON exercises_gallery;

CREATE POLICY "Admin insert exercises"
  ON exercises_gallery
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

-- Refresh PostgREST's schema cache so the new column/constraint are picked up.
NOTIFY pgrst, 'reload schema';
