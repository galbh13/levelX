import { supabase } from './supabase';

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
