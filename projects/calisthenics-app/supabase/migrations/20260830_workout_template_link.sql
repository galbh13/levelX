-- "Return to normal" — lets a coach undo a player-specific customization and
-- snap the workout back to the CURRENT library version.
--
-- Player workouts are independent copies of gallery_example_workouts (see
-- lib/workouts.js importGalleryWorkout), so a copy had no idea where it came
-- from. Two columns fix that:
--   source_template_id — the library program this copy was imported from.
--   customized_at      — stamped every time a coach saves an edit to the copy.
-- Both set => the copy has drifted from the library and can be reverted.
-- ON DELETE SET NULL: deleting a library program leaves the player's copy
-- intact, it just loses the ability to revert (there's nothing to revert to).

alter table workouts
  add column if not exists source_template_id uuid
    references gallery_example_workouts(id) on delete set null;

alter table workouts
  add column if not exists customized_at timestamptz;

comment on column workouts.source_template_id is
  'gallery_example_workouts row this workout was imported from; null = authored directly for the player.';
comment on column workouts.customized_at is
  'Last time a coach edited this copy away from its template. Null = still matches the library version.';

create index if not exists workouts_source_template_id_idx
  on workouts (source_template_id);

-- Backfill for copies imported before this migration: link a workout to a
-- library program only when the title matches EXACTLY ONE template, so an
-- ambiguous title is left unlinked rather than pointed at the wrong program.
-- Only the link is set — customized_at stays null, so nothing is treated as
-- customized until a coach actually edits it.
with unique_templates as (
  select min(id) as id, lower(trim(title)) as norm_title
  from gallery_example_workouts
  group by lower(trim(title))
  having count(*) = 1
)
update workouts w
set source_template_id = t.id
from unique_templates t
where w.source_template_id is null
  and lower(trim(w.title)) = t.norm_title;
