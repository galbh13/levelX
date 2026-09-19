import { supabase } from './supabase';

// THE 4-WEEK PLAN — the coach's onboarding runway.
// Schema, and the reasoning behind it, in
// supabase/migrations/20260919_four_week_plan.sql. The short version:
//   • Four rows per player in `plan_weeks`, unique on (student_id, week_index).
//   • The coach writes them; the player only reads them.
//   • An unwritten week is simply a MISSING ROW — there is no draft/published
//     state, so every read here pads what the DB returns back out to four weeks.

export const WEEK_COUNT = 4;

// The three fields of a week, in the order the screen stacks them. `key` is the
// column; `label` is what both the reader and the editor print above it;
// `hint` is the editor's placeholder — the question the coach is answering.
// One list, so the player's card and the coach's form can never drift apart.
export const WEEK_FIELDS = [
  {
    key: 'goal',
    label: 'GOAL',
    hint: 'What is this week FOR? One line.',
    // The headline of the week — it doubles as the card's subtitle in the
    // player's list, so it is kept to a line's worth.
    max: 120,
    lines: 2,
  },
  {
    key: 'guidance',
    label: 'GUIDANCE',
    hint: 'What should they actually DO this week?',
    max: 900,
    lines: 6,
  },
  {
    key: 'modules',
    label: 'MODULES TO WATCH',
    hint: 'Which pieces of the course land this week — one per line.',
    max: 500,
    lines: 4,
  },
];
// A fourth field, FOCUS ON ("what to watch for in yourself as the week passes"),
// was cut on 2026-09-19 — in practice it said what GOAL and GUIDANCE already
// said, one box further down. The `focus` column went with it; the migration
// drops it, so a database that saw the earlier cut converges with a fresh one.

// A blank week — the shape every consumer can rely on whether or not a row
// exists. `id: null` is the tell that this week has never been saved.
function blankWeek(weekIndex) {
  return {
    id: null,
    week_index: weekIndex,
    goal: '', guidance: '', modules: '',
  };
}

// Four blank weeks — what the screen renders while it loads, and what a player
// with no plan at all gets.
export function emptyPlan() {
  return Array.from({ length: WEEK_COUNT }, (_, i) => blankWeek(i + 1));
}

// Has the coach written ANYTHING into this week?
export function isWeekEmpty(week) {
  return WEEK_FIELDS.every(f => !(week?.[f.key] ?? '').trim());
}

// Does this player have a plan at all? Drives the empty state on both sides —
// "your coach hasn't written it yet" for the player, "start writing" for the
// coach.
export function planHasContent(weeks) {
  return (weeks ?? []).some(w => !isWeekEmpty(w));
}

// ─── Read ───────────────────────────────────────────────────────────────────────

// This player's four weeks, always four, always in order. Rows the coach has
// never written come back as blanks rather than as gaps, so neither screen has
// to reason about a missing week.
export async function fetchPlan(studentId) {
  const weeks = emptyPlan();
  if (!studentId) return weeks;
  const { data, error } = await supabase
    .from('plan_weeks')
    .select('id, week_index, goal, guidance, modules')
    .eq('student_id', studentId)
    .order('week_index', { ascending: true });
  if (error) {
    // A drifted live schema (the migration not run yet) must not blank the
    // PROFILE screen — the node degrades to "nothing written yet" instead.
    console.error('[fourWeekPlan] fetchPlan:', error);
    return weeks;
  }
  for (const row of data ?? []) {
    const i = row.week_index - 1;
    if (i < 0 || i >= WEEK_COUNT) continue;   // the CHECK constraint's belt-and-braces
    weeks[i] = {
      id: row.id,
      week_index: row.week_index,
      goal:     row.goal     ?? '',
      guidance: row.guidance ?? '',
      modules:  row.modules  ?? '',
    };
  }
  return weeks;
}

// ─── Coach writes ───────────────────────────────────────────────────────────────

// Save ONE week. Upsert on the (student_id, week_index) unique constraint, so
// the editor never has to know whether this week already has a row — which is
// the whole reason that constraint exists. Empty strings are written as NULL so
// "the coach cleared this field" and "the coach never wrote it" stay the same
// thing to every reader.
//
// Returns the saved row's id. Throws — the editor shows the failure rather than
// telling the coach their plan was saved when it wasn't.
export async function saveWeek(studentId, weekIndex, values) {
  if (!studentId) throw new Error('No player to save the plan for.');
  const patch = { student_id: studentId, week_index: weekIndex, updated_at: new Date().toISOString() };
  for (const f of WEEK_FIELDS) patch[f.key] = (values?.[f.key] ?? '').trim() || null;

  const { data, error } = await supabase
    .from('plan_weeks')
    .upsert(patch, { onConflict: 'student_id,week_index' })
    .select('id')
    .single();
  if (error) throw error;
  return data?.id ?? null;
}

// ─── The clock ──────────────────────────────────────────────────────────────────
// The four weeks say WHAT; the start date says WHEN. Schema, and why it is a
// separate table: supabase/migrations/20260919_four_week_plan.sql.
//
// Everything below is plain YYYY-MM-DD string maths against `israelToday()` —
// the app's day boundary. No Date object is ever compared against another, and
// every parse is pinned to UTC midnight, because a local-midnight parse shifts
// the whole plan by a day for anyone east of Greenwich (the same trap the
// birthday picker hit; see CLAUDE.md, "Player onboarding").

export const DAYS_PER_WEEK = 7;
export const PLAN_DAYS     = WEEK_COUNT * DAYS_PER_WEEK;   // 28

const DAY_MS = 86400000;

// A YYYY-MM-DD string → the UTC-midnight instant it names.
function parseDay(iso) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

// Whole days from `fromIso` to `toIso` (negative if `toIso` is the earlier one).
// Both ends are UTC midnights, so this is exact — no DST hour ever leaks in.
export function daysBetween(fromIso, toIso) {
  const a = parseDay(fromIso), b = parseDay(toIso);
  if (a === null || b === null) return null;
  return Math.round((b - a) / DAY_MS);
}

// `iso` shifted by n whole days, back as YYYY-MM-DD.
export function addDays(iso, n) {
  const t = parseDay(iso);
  if (t === null) return null;
  return new Date(t + n * DAY_MS).toISOString().slice(0, 10);
}

// WHERE IS THIS PLAYER IN THEIR PLAN — the one function both sides read, so the
// player's card and the coach's editor can never disagree about what day it is.
// Pure: it takes today rather than reading the clock itself.
//
//   state       'unset'   — the coach hasn't started the plan
//               'pending' — started, but day 1 hasn't arrived (starts tomorrow)
//               'active'  — somewhere inside the 28 days
//               'done'    — past the end of week 4
//   dayIndex    0-based day of the plan (day 1 of week 1 is 0)
//   day         1-based day of the plan, for display
//   currentWeek 1..4 while active; null otherwise
//   dayInWeek   1..7 within the current week
//   daysLeftInWeek  days remaining INCLUDING today — "3 days left" means today
//                   plus two more, which is how a person counts a deadline
//   startsIn    'pending' only: days until day 1
export function planProgress(startedOn, today) {
  if (!startedOn) return { state: 'unset', currentWeek: null };

  const dayIndex = daysBetween(startedOn, today);
  if (dayIndex === null) return { state: 'unset', currentWeek: null };

  if (dayIndex < 0) {
    return { state: 'pending', currentWeek: null, startedOn, dayIndex, startsIn: -dayIndex };
  }
  if (dayIndex >= PLAN_DAYS) {
    return {
      state: 'done', currentWeek: null, startedOn, dayIndex, day: PLAN_DAYS,
      // How long ago the runway ran out — the coach's cue to re-start a player
      // who is still stuck, or to let the check-up cycle carry on alone.
      endedDaysAgo: dayIndex - PLAN_DAYS + 1,
    };
  }

  const currentWeek = Math.floor(dayIndex / DAYS_PER_WEEK) + 1;
  const dayInWeek   = (dayIndex % DAYS_PER_WEEK) + 1;
  return {
    state: 'active', startedOn,
    dayIndex, day: dayIndex + 1,
    currentWeek, dayInWeek,
    daysLeftInWeek: DAYS_PER_WEEK - dayInWeek + 1,
  };
}

// The calendar dates one week covers, for the range printed on its card. Weeks
// are 1..4; anything else gets nulls rather than a confidently wrong range.
export function weekDates(startedOn, weekIndex) {
  if (!startedOn || weekIndex < 1 || weekIndex > WEEK_COUNT) return { from: null, to: null };
  const from = addDays(startedOn, (weekIndex - 1) * DAYS_PER_WEEK);
  return { from, to: from ? addDays(from, DAYS_PER_WEEK - 1) : null };
}

// Where one week stands relative to today — the CARD's state, not the plan's.
// 'none' is what an un-started plan returns, and it is what makes the screen
// fall back to the plain un-dated read-out it had before there was a clock.
export function weekState(progress, weekIndex) {
  if (!progress || progress.state === 'unset') return 'none';
  if (progress.state === 'pending') return 'upcoming';
  if (progress.state === 'done')    return 'past';
  if (weekIndex === progress.currentWeek) return 'current';
  return weekIndex < progress.currentWeek ? 'past' : 'upcoming';
}

// "19 SEP" — the short form the week cards print.
//
// Spelled out from the string rather than handed to `toLocaleDateString`: that
// returns "19 Sept" for September under Node's ICU and something else again
// under Hermes (whose ICU is trimmed on Android), so the one date on the screen
// would change shape between web and the APK. Three letters, always, everywhere.
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function formatDay(iso) {
  if (parseDay(iso) === null) return '';
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

// ─── The start date: the read, and the coach's writes ───────────────────────────

// This player's start date, or null if the coach hasn't started them. Errors
// resolve to null on purpose: an unmigrated live DB must leave the plan readable
// (just un-clocked) rather than blanking the screen.
export async function fetchPlanStart(studentId) {
  if (!studentId) return null;
  const { data, error } = await supabase
    .from('plan_runs')
    .select('started_on')
    .eq('student_id', studentId)
    .maybeSingle();
  if (error) {
    console.error('[fourWeekPlan] fetchPlanStart:', error);
    return null;
  }
  return data?.started_on ?? null;
}

// Start — or re-start — the plan on a given day. Upsert on the primary key, so
// pressing START again just moves the clock; see the migration's note on
// re-starting a player who got stuck. Throws; the caller surfaces it.
export async function setPlanStart(studentId, startedOn) {
  if (!studentId) throw new Error('No player to start the plan for.');
  if (!startedOn) throw new Error('No start date.');
  const { error } = await supabase
    .from('plan_runs')
    .upsert(
      { student_id: studentId, started_on: startedOn, updated_at: new Date().toISOString() },
      { onConflict: 'student_id' },
    );
  if (error) throw error;
  return startedOn;
}

// Take the clock back off — the plan stays, the dates stop. For a start set on
// the wrong day, or a plan the coach wants sitting there un-started until the
// player is ready for it.
export async function clearPlanStart(studentId) {
  if (!studentId) return;
  const { error } = await supabase.from('plan_runs').delete().eq('student_id', studentId);
  if (error) throw error;
}
