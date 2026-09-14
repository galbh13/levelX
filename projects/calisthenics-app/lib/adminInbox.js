import { supabase } from './supabase';
import { checkupCycleState } from './checkups';

// ─── Admin inbox: the "you owe someone something" queue ──────────────────────
//
// CHECK-UP INBOX — every player who SUBMITTED a check-up the coach has not
// replied to yet (`submitted_at` set, `feedback_at` still null). This is a pure
// server-side fact, so no local bookkeeping is involved.
//
// A second queue (CHAT NOTES, the 1-on-1 coach chat) lived here until
// 2026-08-26. The in-app chat was removed in favour of WhatsApp.

// ── Check-up inbox ───────────────────────────────────────────────────────────

// Submitted-but-unanswered check-ups, newest submission first, each carrying the
// player profile the coach needs to open AdminCheckupScreen.
export async function fetchPendingCheckups() {
  const { data: rows, error } = await supabase
    .from('checkups')
    .select('id, student_id, submitted_at, created_at')
    .not('submitted_at', 'is', null)
    .is('feedback_at', null)
    .order('submitted_at', { ascending: false });
  if (error) throw error;

  // Keep only the newest pending check-up per player — the coach answers a
  // player, not a row, and AdminCheckupScreen always opens their latest.
  const seen = new Set();
  const latest = [];
  for (const r of rows ?? []) {
    if (seen.has(r.student_id)) continue;
    seen.add(r.student_id);
    latest.push(r);
  }
  if (latest.length === 0) return [];

  // Profiles fetched separately rather than as an embedded join: the FK's
  // relationship name isn't guaranteed on the live DB (see DATABASE.md drift).
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, class_id, created_at')
    .in('id', latest.map(r => r.student_id));
  const byId = Object.fromEntries((profiles ?? []).map(p => [p.id, p]));

  return latest
    .map(r => ({
      checkupId:   r.id,
      submittedAt: r.submitted_at,
      player:      byId[r.student_id] ?? { id: r.student_id, full_name: null },
    }))
    .filter(r => !!r.player);
}

// Cheap count for the dashboard badge — same predicate, head-only.
export async function fetchPendingCheckupCount() {
  const { data } = await supabase
    .from('checkups')
    .select('student_id')
    .not('submitted_at', 'is', null)
    .is('feedback_at', null);
  return new Set((data ?? []).map(r => r.student_id)).size;
}

// ── Schedule queues: DUE TODAY / LATE ────────────────────────────────────────
//
// The inbox above is "they sent, you owe them". These two are the mirror image:
// players whose recurring check-up day has come round and who have sent NOTHING
// for this cycle. `due` = today IS their day; `late` = their day has passed and
// the check-up still hasn't landed (1..6 days). A player drops out of both the
// moment they submit — then they show up in the inbox instead.
//
// Everything is derived from two reads (the scheduled roster + their newest
// submission), so there is no bookkeeping to keep in sync.
export async function fetchCheckupSchedule(now = new Date()) {
  const { data: players, error } = await supabase
    .from('profiles')
    .select('id, full_name, class_id, checkup_day, created_at')
    .eq('role', 'player')
    .not('checkup_day', 'is', null);
  if (error) throw error;
  if (!players?.length) return { due: [], late: [] };

  // The space policy keeps ~one check-up row per player, so this stays small.
  const { data: subs } = await supabase
    .from('checkups')
    .select('student_id, submitted_at, feedback_at')
    .in('student_id', players.map(p => p.id))
    .not('submitted_at', 'is', null)
    .order('submitted_at', { ascending: false });

  const latest = new Map();
  for (const r of subs ?? []) if (!latest.has(r.student_id)) latest.set(r.student_id, r);

  const due = [], late = [];
  for (const p of players) {
    const last = latest.get(p.id) ?? null;
    const state = checkupCycleState(p.checkup_day, last?.submitted_at ?? null, now);
    const row = {
      player: p,
      checkupDay: p.checkup_day,
      dayName: state.dayName,
      daysLate: state.daysLate,
      lastSubmittedAt: last?.submitted_at ?? null,
    };
    if (state.status === 'due') due.push(row);
    else if (state.status === 'late') late.push(row);
  }

  // Due: alphabetical (they're all equally due). Late: worst offender first.
  const byName = (a, b) => (a.player.full_name || '').localeCompare(b.player.full_name || '');
  due.sort(byName);
  late.sort((a, b) => b.daysLate - a.daysLate || byName(a, b));
  return { due, late };
}
