import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

// ─── Admin inbox: two "you owe someone something" queues ─────────────────────
//
//   1. CHECK-UP INBOX — every player who SUBMITTED a check-up the coach has not
//      replied to yet (`submitted_at` set, `feedback_at` still null). This is a
//      pure server-side fact, so no local bookkeeping is involved.
//   2. CHAT NOTES — every 1-on-1 coach chat, newest activity first, with an
//      UNREAD count. `coach_messages` has no read-state column (and the live DB
//      diverges from migrations), so "read" is tracked LOCALLY on the admin's
//      device: a map of player_id → last-read ISO instant in AsyncStorage. A
//      message counts as unread when it came FROM the player (sender_id ===
//      player_id) and is newer than that mark. Opening a thread marks it read —
//      WhatsApp-style, no reply required.

const READ_KEY = 'admin_chat_read_v1';
const MESSAGE_SCAN_LIMIT = 500; // chat is 7-day ephemeral, so this covers everything

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

// ── Chat read-marks (local) ──────────────────────────────────────────────────

export async function getChatReadMap() {
  try {
    const raw = await AsyncStorage.getItem(READ_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Mark a player's thread read up to `at` (defaults to now).
export async function markChatRead(playerId, at = new Date().toISOString()) {
  if (!playerId) return;
  try {
    const map = await getChatReadMap();
    map[playerId] = at;
    await AsyncStorage.setItem(READ_KEY, JSON.stringify(map));
  } catch (e) {
    console.error('[adminInbox] markChatRead:', e);
  }
}

// ── Chat notes ───────────────────────────────────────────────────────────────

// One row per player who has ever chatted (plus, when `includeEmpty`, every
// player so the coach can start a fresh chat). Sorted unread-first, then by most
// recent message. Shape: { player, lastMessage, lastAt, unread, fromPlayer }.
export async function fetchChatThreads({ includeEmpty = true } = {}) {
  const [{ data: msgs }, { data: players }, readMap] = await Promise.all([
    supabase
      .from('coach_messages')
      .select('id, player_id, sender_id, body, created_at')
      .order('created_at', { ascending: false })
      .limit(MESSAGE_SCAN_LIMIT),
    supabase
      .from('profiles')
      .select('id, full_name, class_id, created_at')
      .eq('role', 'player')
      .order('created_at', { ascending: true }),
    getChatReadMap(),
  ]);

  const byPlayer = new Map();
  for (const m of msgs ?? []) {
    let t = byPlayer.get(m.player_id);
    if (!t) { t = { last: m, unread: 0 }; byPlayer.set(m.player_id, t); }
    // Rows arrive newest-first, so the first one seen is the thread's last message.
    const readAt = readMap[m.player_id];
    const fromPlayer = m.sender_id === m.player_id;
    if (fromPlayer && (!readAt || m.created_at > readAt)) t.unread += 1;
  }

  const rows = (players ?? []).map(p => {
    const t = byPlayer.get(p.id);
    return {
      player:      p,
      lastMessage: t?.last?.body ?? null,
      lastAt:      t?.last?.created_at ?? null,
      fromPlayer:  t ? t.last.sender_id === p.id : false,
      unread:      t?.unread ?? 0,
    };
  }).filter(r => includeEmpty || r.lastAt);

  rows.sort((a, b) => {
    if ((b.unread > 0) !== (a.unread > 0)) return b.unread - a.unread; // unread first
    if (a.lastAt && b.lastAt) return a.lastAt < b.lastAt ? 1 : -1;     // newest activity
    if (a.lastAt) return -1;
    if (b.lastAt) return 1;
    return (a.player.full_name ?? '').localeCompare(b.player.full_name ?? '');
  });
  return rows;
}

// Total unread player messages across every thread — the CHAT NOTES badge.
export async function fetchUnreadChatCount() {
  const [{ data: msgs }, readMap] = await Promise.all([
    supabase
      .from('coach_messages')
      .select('player_id, sender_id, created_at')
      .order('created_at', { ascending: false })
      .limit(MESSAGE_SCAN_LIMIT),
    getChatReadMap(),
  ]);
  let n = 0;
  for (const m of msgs ?? []) {
    if (m.sender_id !== m.player_id) continue;       // coach's own message
    const readAt = readMap[m.player_id];
    if (!readAt || m.created_at > readAt) n += 1;
  }
  return n;
}
