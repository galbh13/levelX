-- Jobs — parallel class ladders.
--
-- A "job" is a self-contained progression: its own set of `classes` (and, via
-- those, its own `class_quests`). The original ladder is the 'static' job; every
-- existing class and player defaults to it, so nothing changes for current data.
-- A player can be moved to another job by the admin (profiles.job), which points
-- them at that job's class ladder on the Skills page.
--
-- The 'handstand' job is optimized for leveling the handstand as fast as
-- possible. For now it is intentionally EMPTY: one class (the first) with no
-- class_quests, so its Skills page shows a single class and no main/side quests.

ALTER TABLE public.classes  ADD COLUMN IF NOT EXISTS job text NOT NULL DEFAULT 'static';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS job text NOT NULL DEFAULT 'static';

-- The handstand job's first (and, for now, only) class. Idempotent — re-running
-- the migration will not create a duplicate. No class_quests are inserted, so the
-- class exists but has an empty quest tree.
INSERT INTO public.classes (id, name, order_index, description, prestige_at, job)
SELECT gen_random_uuid(),
       'Handstand I',
       0,
       'The handstand path — level the handstand as fast as possible.',
       80,
       'handstand'
WHERE NOT EXISTS (
  SELECT 1 FROM public.classes WHERE job = 'handstand' AND order_index = 0
);
