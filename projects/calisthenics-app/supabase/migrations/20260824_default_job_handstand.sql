-- Default new players to the 'handstand' job ─────────────────────────────────
--
-- The app is specialised for people learning the handstand, so a freshly signed
-- up player should land on the handstand ladder instead of the original
-- all-skills 'static' ladder. This flips the DB default and makes the signup
-- trigger explicit about it.
--
-- Mirrors DEFAULT_JOB in lib/jobs.js — keep the two in sync.
--
-- NOTE: this deliberately does NOT backfill existing profiles. Players already
-- on 'static' keep their ladder (and their class_id, which points at a 'static'
-- class); the admin moves them with the JOB switch on PlayerAdminScreen, which
-- also re-points class_id at the target job's first class.
--
-- `classes.job` keeps its 'static' default: that column describes which ladder a
-- class row belongs to, and every seeded class already sets it explicitly.

alter table public.profiles alter column job set default 'handstand';

-- Signup trigger: insert the job explicitly so the intent is visible in the
-- function body, not just in the column default.
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email, role, job)
  values (new.id, new.email, 'player', 'handstand');
  return new;
end;
$$ language plpgsql security definer;
