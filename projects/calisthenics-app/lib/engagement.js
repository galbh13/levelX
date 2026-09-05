// Engagement & churn risk — "who is about to quit", from training data alone.
// ─────────────────────────────────────────────────────────────────────────────
// The money ledger tells you a customer left AFTER they stopped paying. This
// tells you a month earlier, while you can still do something about it: people
// quit training long before they cancel.
//
// Nothing new is stored. The signal is already in three existing tables:
//   workout_override_workouts (completed, specific_date) — did they train
//   daily_quest_completions   (completion_date)          — daily habit
//   checkups                  (submitted_at)             — did they report in
//
// NOTE the 9-week retention window on the two per-date tables (see DATABASE.md):
// rows older than ~4 weeks are pruned, so the lookback here is 28 days by design
// — asking for more would silently read empty history as inactivity.

import { supabase } from './supabase';
import { todayISO, addDays } from './billing';

export const WINDOW_DAYS = 28;

/**
 * Engagement facts for a set of players.
 * → { [playerId]: { workouts, dailies, lastWorkout, lastDaily, lastCheckup, lastActive } }
 */
export async function fetchEngagement(playerIds, { today = todayISO(), days = WINDOW_DAYS } = {}) {
  const ids = (playerIds ?? []).filter(Boolean);
  const out = {};
  ids.forEach((id) => {
    out[id] = { workouts: 0, dailies: 0, lastWorkout: null, lastDaily: null, lastCheckup: null, lastActive: null };
  });
  if (!ids.length) return out;

  const since = addDays(today, -days);

  const [wo, dq, cu] = await Promise.all([
    supabase
      .from('workout_override_workouts')
      .select('student_id, specific_date, completed')
      .in('student_id', ids)
      .eq('completed', true)
      .gte('specific_date', since),
    supabase
      .from('daily_quest_completions')
      .select('student_id, completion_date')
      .in('student_id', ids)
      .gte('completion_date', since),
    // Check-ups are replace-on-submit (one row per player), so no date filter —
    // the whole point is how LONG ago the last one was, even if that's months.
    supabase
      .from('checkups')
      .select('student_id, submitted_at')
      .in('student_id', ids)
      .not('submitted_at', 'is', null),
  ]);

  const bump = (id, field, date) => {
    const e = out[id];
    if (!e || !date) return;
    if (!e[field] || date > e[field]) e[field] = date;
  };

  (wo.data ?? []).forEach((r) => {
    if (!out[r.student_id]) return;
    out[r.student_id].workouts += 1;
    bump(r.student_id, 'lastWorkout', r.specific_date);
  });
  (dq.data ?? []).forEach((r) => {
    if (!out[r.student_id]) return;
    out[r.student_id].dailies += 1;
    bump(r.student_id, 'lastDaily', r.completion_date);
  });
  (cu.data ?? []).forEach((r) => {
    bump(r.student_id, 'lastCheckup', String(r.submitted_at).slice(0, 10));
  });

  Object.values(out).forEach((e) => {
    e.lastActive = [e.lastWorkout, e.lastDaily, e.lastCheckup].filter(Boolean).sort().pop() ?? null;
  });

  return out;
}

// NOTE (2026-09-04): the scoring half of this file — riskScore() + RISK_COLORS +
// RISK_LABELS — was deleted with the AT RISK / HEALTHY chip it fed. What remains
// is fetchEngagement(), which still powers the LAST ACTIVE chip on a player money
// card. The three signals it collects are unchanged, so a future score can be
// rebuilt on top of them without touching the queries.
