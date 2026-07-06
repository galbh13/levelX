-- Weekly accessories are now CHOSEN from the player's own workouts (My Workouts)
-- instead of typed free-hand. Link each accessory to the workout it came from.
-- `name` still keeps a copy of the workout title at add time, so the accessory
-- (and its completion history) survives if the source workout is later deleted.
alter table public.weekly_accessories
  add column if not exists workout_id uuid
  references public.workouts(id) on delete set null;

comment on column public.weekly_accessories.workout_id is
  'The player''s workout this accessory was picked from (My Workouts picker). NULL = legacy free-text accessory or the source workout was deleted (name keeps the title copy).';
