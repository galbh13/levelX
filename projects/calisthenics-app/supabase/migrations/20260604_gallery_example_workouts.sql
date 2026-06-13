-- Admin-authored example workout templates shown in the gallery
-- exercises column: JSONB array of {name, sets, reps, notes}

CREATE TABLE IF NOT EXISTS gallery_example_workouts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text        NOT NULL,
  description text,
  class_order integer     NOT NULL, -- 0=Class I, 1=Class II, 2=Class III
  exercises   jsonb       NOT NULL DEFAULT '[]',
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE gallery_example_workouts ENABLE ROW LEVEL SECURITY;

-- Everyone logged in can read
CREATE POLICY "Read example workouts"
  ON gallery_example_workouts FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only admin can write / delete
CREATE POLICY "Admin insert example workouts"
  ON gallery_example_workouts FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admin delete example workouts"
  ON gallery_example_workouts FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
