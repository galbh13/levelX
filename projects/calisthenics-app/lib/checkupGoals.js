import { supabase } from './supabase';

// Weekly GOALS — the coach's milestones for the week, and the face of the check-up.
// See supabase/migrations/20260918_checkup_goals.sql for the cycle in full. The
// short version:
//   • The coach writes goals on the check-up they are REPLYING to (source).
//   • They stay ACTIVE (result_checkup_id IS NULL) until the player's next
//     submission stamps them closed — that submission is where the coach reads
//     the score back.
//   • The player's only write is the TICK (done / done_at) and that close stamp.

export const GOAL_MAX      = 140;   // one line the player can read at a glance
export const MAX_GOALS     = 6;     // a week, not a backlog
export const GOAL_TARGET   = 3;     // what the coach is nudged toward

// ─── THE GOALS LANGUAGE ─────────────────────────────────────────────────────────
// The coach writes the week in ONE box, the way they'd write it on paper:
//
//   1. Hold a 30s freestanding handstand
//   2. Three L-sit sessions
//   3. Sleep 7h+ every night
//
// A number, a dot, a space, the goal. That's the whole language — deliberately
// smaller than the `goal -` / `note -` markup on exercise descriptions, because
// this one gets typed every single week.
//
// It is FORGIVING on purpose (nobody should lose a week's goals to a typo):
//   • the separator can be `.` `)` `-` `:` or nothing at all — `1 push harder` works
//   • `-` or `•` bullets count as a goal too, for the coach who doesn't number
//   • the numbers don't have to be right, or in order — position decides, so
//     deleting goal 2 out of 1/2/3 doesn't leave a hole
//   • a line with NO marker continues the goal above it, so a long goal that
//     wrapped onto a second line stays one goal
//   • blank lines are spacing, not goals
//
// Output is a plain array of strings, which is exactly what saveActiveGoals takes.
const GOAL_LINE_RE = /^\s*(?:(\d+)\s*[.)\-:–—]?|[-–—•*])\s+(.*)$/;
// `12.` on its own line (no text after the marker) still opens a new goal.
const GOAL_BARE_RE = /^\s*(\d+)\s*[.)\-:–—]\s*$/;

export function parseGoalsText(raw) {
  const out = [];
  for (const line of String(raw ?? '').split('\n')) {
    if (!line.trim()) continue;                       // blank line = spacing

    const bare = line.match(GOAL_BARE_RE);
    if (bare) { out.push(''); continue; }

    const m = line.match(GOAL_LINE_RE);
    if (m) { out.push((m[2] ?? '').trim()); continue; }

    // No marker: a wrapped continuation of the goal above. With nothing above it
    // yet, it opens the first goal — so a single unnumbered line still counts.
    // (Several unnumbered lines therefore read as ONE goal. That is the price of
    // free wrapping, and the live preview beside the box shows it immediately.)
    if (out.length) out[out.length - 1] = `${out[out.length - 1]} ${line.trim()}`.trim();
    else out.push(line.trim());
  }
  return out
    .map(t => t.replace(/\s+/g, ' ').trim().slice(0, GOAL_MAX))
    .filter(Boolean)
    .slice(0, MAX_GOALS);
}

// The other direction — goals back into the language, so the editor always opens
// on text the parser will read back identically. Numbers are rewritten from the
// order, which is what makes the round-trip stable.
export function formatGoalsText(goals = []) {
  return goals.map((g, i) => `${i + 1}. ${typeof g === 'string' ? g : g.text}`).join('\n');
}

// ─── Reads ──────────────────────────────────────────────────────────────────────

// This week's milestones: the goals nothing has closed yet.
export async function fetchActiveGoals(studentId) {
  if (!studentId) return [];
  const { data, error } = await supabase
    .from('checkup_goals')
    .select('*')
    .eq('student_id', studentId)
    .is('result_checkup_id', null)
    .order('order_index', { ascending: true });
  if (error) {
    console.error('[checkupGoals] fetchActiveGoals:', error);
    return [];
  }
  return data ?? [];
}

// The goals a given submission closed — what the coach's review opens on.
export async function fetchGoalsForCheckup(checkupId) {
  if (!checkupId) return [];
  const { data, error } = await supabase
    .from('checkup_goals')
    .select('*')
    .eq('result_checkup_id', checkupId)
    .order('order_index', { ascending: true });
  if (error) {
    console.error('[checkupGoals] fetchGoalsForCheckup:', error);
    return [];
  }
  return data ?? [];
}

// ─── Player writes ──────────────────────────────────────────────────────────────

// Tick / untick one goal. Optimistic on screen — this only persists it.
export async function setGoalDone(goalId, done) {
  if (!goalId) return;
  const { error } = await supabase
    .from('checkup_goals')
    .update({ done, done_at: done ? new Date().toISOString() : null })
    .eq('id', goalId);
  if (error) console.error('[checkupGoals] setGoalDone:', error);
}

// Called right after a check-up is submitted: file every still-open goal under
// that submission. Two things at once — the week's milestones are over, and the coach
// now has the ticked/untouched split attached to the check-up they're about to
// read. Best-effort: a failure leaves the goals active (the player keeps seeing
// them), it never blocks a submission that already landed.
export async function closeActiveGoals(studentId, checkupId) {
  if (!studentId || !checkupId) return;
  const { error } = await supabase
    .from('checkup_goals')
    .update({ result_checkup_id: checkupId })
    .eq('student_id', studentId)
    .is('result_checkup_id', null)
    // A goal WRITTEN on this check-up can never be closed BY it. The coach replies
    // to a submission and sets the next week's goals on that same row, so without
    // this a re-submit of an edited check-up would file the fresh milestones away as
    // last week's and take it off the player's screen.
    .or(`source_checkup_id.is.null,source_checkup_id.neq.${checkupId}`);
  if (error) console.error('[checkupGoals] closeActiveGoals:', error);
}

// ─── Coach writes ───────────────────────────────────────────────────────────────

// Replace this player's ACTIVE goals with `texts`, in order. Editing the week's
// list is a rewrite, not a diff — but a goal whose text is unchanged KEEPS its
// row, so the player's ticks survive the coach fixing a typo or adding a fourth
// goal mid-week. Rows that are gone from the new list are deleted; new ones are
// inserted at their position. Returns the resulting active set.
export async function saveActiveGoals(studentId, sourceCheckupId, texts = []) {
  if (!studentId) return [];
  const wanted = texts.map(t => (t ?? '').trim()).filter(Boolean).slice(0, MAX_GOALS);

  const current = await fetchActiveGoals(studentId);
  const spare = [...current];                  // rows still up for reuse
  const keep = [];                             // { row, order_index }
  const insert = [];

  wanted.forEach((text, i) => {
    const hit = spare.findIndex(g => g.text === text);
    if (hit >= 0) {
      keep.push({ row: spare.splice(hit, 1)[0], order_index: i });
    } else {
      insert.push({
        student_id: studentId,
        source_checkup_id: sourceCheckupId ?? null,
        text, order_index: i,
      });
    }
  });

  // Whatever the coach dropped from the list.
  const dropIds = spare.map(g => g.id);
  if (dropIds.length) {
    const { error } = await supabase.from('checkup_goals').delete().in('id', dropIds);
    if (error) throw error;
  }
  // Reordered survivors.
  await Promise.all(keep
    .filter(k => k.row.order_index !== k.order_index)
    .map(k => supabase.from('checkup_goals')
      .update({ order_index: k.order_index })
      .eq('id', k.row.id)));

  if (insert.length) {
    const { error } = await supabase.from('checkup_goals').insert(insert);
    if (error) throw error;
  }
  return fetchActiveGoals(studentId);
}

// ─── Shared shaping ─────────────────────────────────────────────────────────────

// { done, total, pct, complete } — the header line on both sides of the app.
export function goalProgress(goals = []) {
  const total = goals.length;
  const done  = goals.filter(g => g.done).length;
  return {
    done, total,
    pct: total ? done / total : 0,
    complete: total > 0 && done === total,
  };
}

// (There was a rally line here — "NOTHING TICKED YET. START WITH ONE." — between
// the heading and the list. Removed 2026-09-19: the milestones say it themselves,
// and a line of encouragement above them was one thing too many on a screen whose
// whole point is the list.)
