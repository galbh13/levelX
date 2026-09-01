// Training-schedule resolution — single source of truth so Home, Workouts, and
// Manage agree on what a given day's workouts are.
//
// Two layers:
//   • weekly_workout_template — the recurring SKELETON, keyed by day_of_week
//     (0=Sun … 6=Sat). The default plan that repeats every week.
//   • workout_override_workouts — per-SPECIFIC-DATE rows. An override for a date
//     WINS over the skeleton for that date (this is how a single day is edited),
//     and carries the `completed` flag.
//
// Resolution for a date: if any override rows exist for that exact date, use them;
// otherwise fall back to the template rows for that weekday (as virtual entries).

import { supabase } from './supabase';

export const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

export function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const TODAY_STR = toDateStr(new Date());

// The seven days of the week containing `offset*7` days from today, starting Sunday.
export function getWeekDays(offset = 0) {
  const today  = new Date();
  const dow    = today.getDay(); // 0=Sun … 6=Sat
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - dow + offset * 7);
  sunday.setHours(0, 0, 0, 0);

  return DAY_LABELS.map((label, i) => {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    return {
      label,
      date:      d,
      dateStr:   toDateStr(d),
      dayIndex:  i,
      dayOfWeek: d.getDay(),
      month:     MONTH_ABBR[d.getMonth()],
    };
  });
}

/**
 * Resolve a single day's workouts.
 *   dateStr        — 'YYYY-MM-DD'
 *   dayOfWeek      — 0..6
 *   overrideRows   — workout_override_workouts rows (any dates)
 *   templateRows   — weekly_workout_template rows (any weekdays)
 *   workoutsById   — { [workout_id]: workout }
 * Returns an array of { ...workout, overrideId, completed, fromTemplate }.
 * Per-date overrides win; otherwise the weekday's template rows are virtual.
 */
export function resolveDayWorkouts({ dateStr, dayOfWeek, overrideRows, templateRows, workoutsById }) {
  const dayOverrides = dedupeOverrideRows((overrideRows ?? []).filter(o => o.specific_date === dateStr));
  if (dayOverrides.length > 0) {
    return dayOverrides
      .map(o => ({
        ...workoutsById[o.workout_id],
        overrideId:   o.id,
        completed:    o.completed ?? false,
        fromTemplate: false,
      }))
      .filter(w => w.id);
  }
  return (templateRows ?? [])
    .filter(t => t.day_of_week === dayOfWeek)
    .map(t => ({
      ...workoutsById[t.workout_id],
      overrideId:   null,
      completed:    false,
      fromTemplate: true,
    }))
    .filter(w => w.id);
}

/** True once a date has its own override rows (diverged from the skeleton). */
export function isDateOverridden(dateStr, overrideRows) {
  return (overrideRows ?? []).some(o => o.specific_date === dateStr);
}

/**
 * Copy a weekday's template workouts into per-date override rows for `dateStr`
 * (completed=false), so the date can carry completion / be edited independently.
 * Idempotent: only the workout_ids the date is MISSING get inserted. Returns
 * every override row the date has afterwards (existing + inserted), or [].
 *
 * It used to be a blind `.insert(rows)` whose comment claimed it ignored
 * duplicates — wishful thinking, since nothing in the DB rejects a second
 * identical row. Anything that materialized the same date twice (two taps on
 * Home's mission checkbox, the second landing before the first refetch; or a
 * stale screen still treating the day as template-derived after the coach had
 * already overridden it) silently doubled the day, and the player watched their
 * one mission become two. Callers had to guard it themselves — the coach screen
 * still carries its own `materializedRef` latch — but Home did not, so the
 * guard now lives here, where every caller gets it.
 */
export async function materializeDay({ studentId, coachId, dateStr, templateWorkoutIds }) {
  const ids = [...new Set(templateWorkoutIds ?? [])];
  if (ids.length === 0) return [];

  // Read first: whatever the date already carries wins, and is never re-inserted.
  const { data: existing, error: readErr } = await supabase
    .from('workout_override_workouts')
    .select('id, specific_date, workout_id, completed')
    .eq('student_id', studentId)
    .eq('specific_date', dateStr);
  if (readErr) {
    // Can't prove the date is empty → do NOT insert. A day left on its template
    // skeleton is recoverable; a doubled day is the thing being fixed here.
    console.error('[schedule] materializeDay read:', readErr);
    return [];
  }

  const have    = new Set((existing ?? []).map(r => r.workout_id));
  const missing = ids.filter(id => !have.has(id));
  if (missing.length === 0) return existing ?? [];

  const rows = missing.map(workout_id => ({
    student_id:    studentId,
    coach_id:      coachId,
    specific_date: dateStr,
    workout_id,
  }));
  const { data, error } = await supabase
    .from('workout_override_workouts')
    .insert(rows)
    .select('id, specific_date, workout_id, completed');
  if (error) { console.error('[schedule] materializeDay:', error); return existing ?? []; }
  return [...(existing ?? []), ...(data ?? [])];
}

/**
 * Collapse duplicate override rows — same (date, workout) more than once.
 *
 * Nothing in the DB used to stop a date from carrying the same workout twice, so
 * every path that inserted without looking first (a second materialize landing
 * before the first refetch; ADD WORKOUT on a day whose skeleton was materialized
 * in the same breath) left the player staring at their one mission listed twice.
 * The inserting paths are all guarded now and a unique index backs it up, but
 * rows created BEFORE that fix are already sitting in players' days — so every
 * read collapses them, and the board reads right even on a dirty date.
 *
 * A completed twin wins over an unfinished one: if the player ticked either copy,
 * the day is done. Otherwise the lowest id wins, so the survivor is stable across
 * refetches (the same row keeps the overrideId the UI writes to).
 */
export function dedupeOverrideRows(rows) {
  const best = new Map();
  for (const r of rows ?? []) {
    const k = `${r.specific_date ?? ''}|${r.workout_id}`;
    const prev = best.get(k);
    if (!prev) { best.set(k, r); continue; }
    const win = (r.completed && !prev.completed) ||
                (!!r.completed === !!prev.completed && String(r.id) < String(prev.id));
    if (win) best.set(k, r);
  }
  return [...best.values()];
}
