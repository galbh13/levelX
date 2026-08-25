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
import { daysBetween, todayISO, addDays } from './billing';

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

/**
 * 0–100 risk of losing this customer. Higher = more likely to quit.
 *
 * Three signals, weighted by how strongly each one predicts a cancellation:
 *   silence (0–50) — days since ANY activity. The single loudest signal.
 *   volume  (0–30) — workouts completed in the window vs. ~3/week expected.
 *   check-in(0–20) — days since the last check-up submission.
 *
 * A brand-new player (< 10 days) is exempt: there is no history to judge yet and
 * flagging them red on day two is noise.
 */
export function riskScore(engagement, billing, today = todayISO()) {
  const started = billing?.started_at;
  const brandNew = started && daysBetween(started, today) < 10;
  if (brandNew) return { score: 0, band: 'new', silentDays: 0, reason: 'Just started' };

  const silentDays = engagement?.lastActive
    ? daysBetween(engagement.lastActive, today)
    : (started ? Math.min(daysBetween(started, today), 60) : 60);

  // Silence — 0 at 3 days or less, full 50 by 21 days quiet.
  const silence = Math.max(0, Math.min(50, ((silentDays - 3) / 18) * 50));

  // Volume — 12 workouts in 28 days (~3/wk) is a full house; zero is full penalty.
  const volume = Math.max(0, Math.min(30, ((12 - (engagement?.workouts ?? 0)) / 12) * 30));

  // Check-up — the weekly report-in. 14+ days silent on it is the full penalty.
  const cuDays = engagement?.lastCheckup ? daysBetween(engagement.lastCheckup, today) : 21;
  const checkup = Math.max(0, Math.min(20, ((cuDays - 7) / 14) * 20));

  const score = Math.round(silence + volume + checkup);
  const band = score >= 60 ? 'risk' : score >= 30 ? 'watch' : 'good';

  const reason =
    silentDays >= 14 ? `Silent ${silentDays}d`
    : (engagement?.workouts ?? 0) === 0 ? 'No workouts in 28d'
    : cuDays >= 21 ? 'No check-up in 3 weeks'
    : band === 'good' ? 'Training consistently'
    : 'Slowing down';

  return { score, band, silentDays, workouts: engagement?.workouts ?? 0, reason };
}

export const RISK_COLORS = {
  new:   '#4a6a8a',
  good:  '#1FD79A',
  watch: '#FFD700',
  risk:  '#E11D48',
};

export const RISK_LABELS = {
  new: 'NEW', good: 'HEALTHY', watch: 'WATCH', risk: 'AT RISK',
};
