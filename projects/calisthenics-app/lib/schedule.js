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
  const dayOverrides = (overrideRows ?? []).filter(o => o.specific_date === dateStr);
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
 * No-op-safe: ignores duplicates. Returns the inserted rows (or []).
 */
export async function materializeDay({ studentId, coachId, dateStr, templateWorkoutIds }) {
  const ids = [...new Set(templateWorkoutIds ?? [])];
  if (ids.length === 0) return [];
  const rows = ids.map(workout_id => ({
    student_id:    studentId,
    coach_id:      coachId,
    specific_date: dateStr,
    workout_id,
  }));
  const { data, error } = await supabase
    .from('workout_override_workouts')
    .insert(rows)
    .select('id, specific_date, workout_id, completed');
  if (error) { console.error('[schedule] materializeDay:', error); return []; }
  return data ?? [];
}
