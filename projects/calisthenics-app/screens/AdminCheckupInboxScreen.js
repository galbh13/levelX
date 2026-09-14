import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
} from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import { useCoach } from '../context/CoachContext';
import { useAdminNotify } from '../context/AdminNotifyContext';
import { fetchPendingCheckups, fetchCheckupSchedule } from '../lib/adminInbox';

// ─── Admin — CHECK-UP INBOX ─────────────────────────────────────────────────
// Three views of the same week, picked from the menu at the top:
//   SENT ME — they submitted, the coach hasn't replied yet (the original inbox)
//   TODAY   — their recurring check-up day IS today and nothing has landed
//   LATE    — their day has passed and the check-up still hasn't landed
// A player sits in exactly one of them: submitting moves them out of TODAY/LATE
// and into SENT ME; replying clears them entirely. Reached from the bell button
// on the AdminDashboard (whose dot follows the SENT ME queue). Tapping any row
// opens AdminCheckupScreen for that player.
const TABS = [
  { key: 'sent',  label: 'SENT ME' },
  { key: 'today', label: 'TODAY' },
  { key: 'late',  label: 'LATE' },
];

export default function AdminCheckupInboxScreen({ navigation }) {
  const { setSelectedStudent } = useCoach();
  const { refresh } = useAdminNotify();
  const [tab, setTab] = useState('sent');
  const [pending, setPending] = useState([]);
  const [due, setDue] = useState([]);
  const [late, setLate] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [rows, sched] = await Promise.all([
        fetchPendingCheckups(),
        fetchCheckupSchedule(),
      ]);
      setPending(rows);
      setDue(sched.due);
      setLate(sched.late);
    } catch (e) {
      console.error('[AdminCheckupInbox] load:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  // Coming back from a reply should drop the answered player off the list, and
  // the dashboard dot should follow.
  useFocusEffect(useCallback(() => { load(); refresh(); }, [load, refresh]));

  const counts = { sent: pending.length, today: due.length, late: late.length };
  const rows = tab === 'sent' ? pending : tab === 'today' ? due : late;

  const subtitle = useMemo(() => {
    if (loading) return ' ';
    if (tab === 'sent')  return `${counts.sent} WAITING ON YOU`;
    if (tab === 'today') return `${counts.today} DUE TODAY`;
    return `${counts.late} BEHIND SCHEDULE`;
  }, [loading, tab, counts.sent, counts.today, counts.late]);

  const empty = {
    sent:  ['ALL CLEAR',   'Every submitted check-up has your reply.'],
    today: ['NOTHING DUE', 'Nobody has a check-up day today.'],
    late:  ['NOBODY LATE', 'Everyone is current with their check-up.'],
  }[tab];

  function open(player) {
    setSelectedStudent(player);
    navigation.navigate('PlayerCheckup', { player });
  }

  return (
    <ScreenFrame fill ready={!loading}>
      <View style={styles.card}>
        <ScreenHeader
          title="CHECK-UP INBOX"
          subtitle={subtitle}
          onBack={() => navigation.goBack()}
        />

        <View style={styles.body}>
          {/* The menu: one pill per queue, each carrying its own count so the
              coach sees what's waiting in the other two without switching. */}
          <View style={styles.tabs}>
            {TABS.map(t => {
              const active = tab === t.key;
              const n = counts[t.key];
              const tone = t.key === 'late' ? ALERT : t.key === 'today' ? WARN : ACCENT;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => setTab(t.key)}
                  style={[
                    styles.tab,
                    active && {
                      borderColor: tone, backgroundColor: tint(tone),
                      shadowColor: tone, shadowOpacity: 0.35,
                    },
                  ]}
                >
                  <Text style={[styles.tabText, active && { color: tone }]} numberOfLines={1}>
                    {t.label}
                  </Text>
                  {n > 0 ? (
                    <View style={[styles.tabCount, { borderColor: tone, backgroundColor: tint(tone) }]}>
                      <Text style={[styles.tabCountText, { color: tone }]}>{n}</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={C.deepBlue} />
            </View>
          ) : rows.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>{empty[0]}</Text>
              <Text style={styles.muted}>{empty[1]}</Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {rows.map((row, i) => {
                const tone = tab === 'today' ? WARN : ALERT;
                // Line two says WHY this player is on this list: when they sent
                // (SENT ME), or which day of theirs is owed (TODAY / LATE).
                const meta =
                  tab === 'sent'  ? `Submitted ${ago(row.submittedAt)}`
                  : tab === 'today' ? `${row.dayName} · nothing sent yet`
                  : `${row.dayName} · ${lastSeen(row.lastSubmittedAt)}`;
                const badge =
                  tab === 'sent'  ? 'NEEDS REPLY'
                  : tab === 'today' ? 'DUE TODAY'
                  : `${row.daysLate}D LATE`;
                return (
                  <Pressable
                    key={row.checkupId ?? row.player.id}
                    style={styles.row}
                    onPress={() => open(row.player)}
                  >
                    <View style={styles.rankChip}>
                      <Text style={styles.rankText}>{String(i + 1).padStart(2, '0')}</Text>
                    </View>
                    {/* Two stacked lines so the badge can never eat into the
                        player's name: name across the full row width on top,
                        the reason + badge on the line below it. */}
                    <View style={styles.rowMain}>
                      <View style={styles.nameRow}>
                        <Text style={styles.name} numberOfLines={1}>
                          {row.player.full_name || '(no name)'}
                        </Text>
                        <View style={[styles.dot, { backgroundColor: tone, shadowColor: tone }]} />
                      </View>
                      <View style={styles.metaRow}>
                        <Text style={styles.meta} numberOfLines={1}>{meta}</Text>
                        <View style={[styles.badge, { borderColor: tone, backgroundColor: tint(tone) }]}>
                          <Text style={[styles.badgeText, { color: tone }]}>{badge}</Text>
                        </View>
                      </View>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </ScreenFrame>
  );
}

// "3h ago" / "2d ago" / a date once it's older than a week.
function ago(iso) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days <= 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// How long since this player last checked in AT ALL — "never sent one" is the
// line the coach most needs to see on the LATE list.
function lastSeen(iso) {
  return iso ? `last sent ${ago(iso)}` : 'never sent one';
}

const ACCENT = '#4A9EBF';
const WARN   = '#E8A33D';
const ALERT  = '#E11D48';

// The faint fill every badge / active pill wears in its own colour.
function tint(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0.10)`;
}

const styles = StyleSheet.create({
  card: { flex: 1 },
  body: { flex: 1, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyTitle: {
    fontFamily: F.heading, fontSize: 20, color: ACCENT, letterSpacing: 3,
  },
  muted: { fontFamily: F.bodyMed, fontSize: 13, color: '#4a6a8a', letterSpacing: 1 },

  // The queue menu. Equal-flex pills so three of them always fill the row, and
  // the count chip never pushes a label off its own pill (the label shrinks).
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderColor: '#1a3a5c', borderRadius: 999,
    backgroundColor: '#070d1a',
    paddingHorizontal: 8, paddingVertical: 8,
    shadowOffset: { width: 0, height: 0 }, shadowRadius: 12, shadowOpacity: 0,
  },
  tabText: {
    flexShrink: 1,
    fontFamily: F.heading, fontSize: 11, color: '#4a6a8a', letterSpacing: 1.2,
  },
  tabCount: {
    minWidth: 20, paddingHorizontal: 5, paddingVertical: 1,
    borderWidth: 1, borderRadius: 999, alignItems: 'center', flexShrink: 0,
  },
  tabCountText: { fontFamily: F.heading, fontSize: 10, letterSpacing: 0.5 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#070d1a',
    borderWidth: 1.5,
    borderColor: '#1a3a5c',
    borderRadius: 10,
    padding: 13,
    marginBottom: 9,
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.18, shadowRadius: 12,
  },
  rankChip: {
    width: 34, height: 34, borderRadius: 8,
    borderWidth: 1.5, borderColor: ACCENT,
    backgroundColor: 'rgba(74,158,191,0.08)',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
    flexShrink: 0,
  },
  rankText: { fontFamily: F.heading, fontSize: 14, color: ACCENT, letterSpacing: 1 },
  rowMain: { flex: 1, minWidth: 0, gap: 6 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: {
    flexShrink: 1,
    fontFamily: F.heading, fontSize: 18, color: '#E8F4FF',
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  // Line two: the reason on the left, badge pinned to the right. The reason
  // shrinks, the badge never does.
  metaRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', gap: 8,
  },
  // The same "you owe this" marker used on the dashboard bell, wearing the
  // colour of the queue the row belongs to.
  dot: {
    width: 7, height: 7, borderRadius: 3.5, flexShrink: 0,
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 6,
  },
  meta: { flexShrink: 1, fontFamily: F.bodyMed, fontSize: 12, color: '#4a6a8a', letterSpacing: 1 },
  badge: {
    flexShrink: 0,
    borderWidth: 1.2, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 3,
  },
  badgeText: { fontFamily: F.heading, fontSize: 10, letterSpacing: 1 },
  chevron: { fontFamily: F.heading, fontSize: 21, color: ACCENT, marginLeft: 9, marginTop: -2 },
});
