// Jobs — parallel class ladders (see migration 20260714_jobs.sql).
//
// A "job" selects which set of `classes` (and their `class_quests`) a player
// progresses through on the Skills page. `profiles.job` holds the player's job;
// the admin switches it on PlayerAdminScreen. Each job's `classes.order_index`
// restarts at 0, so prestige/level/stars are all scoped per job.
//
// This is the canonical job list for the UI. Keep it in sync with the jobs that
// have `classes` rows and any PRESTIGE_REQUIREMENTS block in lib/prestige.js.

// The app is specialised for people learning the handstand, so every new player
// starts on the 'handstand' job. This mirrors the `profiles.job` DB default (see
// migrations/20260824_default_job_handstand.sql) — keep the two in sync. 'static'
// stays available as an opt-in ladder the admin switches to on PlayerAdminScreen.
export const DEFAULT_JOB = 'handstand';

export const JOBS = [
  { key: 'handstand', label: 'HANDSTAND', description: 'Handstand — level it as fast as possible' },
  { key: 'static',    label: 'STATIC',    description: 'All-skills progression' },
];

export const jobLabel = (key) =>
  JOBS.find(j => j.key === key)?.label ?? String(key ?? DEFAULT_JOB).toUpperCase();
