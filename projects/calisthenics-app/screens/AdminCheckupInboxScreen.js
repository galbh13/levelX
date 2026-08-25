import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
} from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { CARD_H, CARD_W } from '../constants/layout';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import { useCoach } from '../context/CoachContext';
import { useAdminNotify } from '../context/AdminNotifyContext';
import { fetchPendingCheckups } from '../lib/adminInbox';

// ─── Admin — CHECK-UP INBOX ─────────────────────────────────────────────────
// Everyone who submitted a check-up the coach hasn't answered yet (submitted,
// no feedback). Reached from the bell button on the AdminDashboard, which wears
// a dot while this list isn't empty. Tapping a row opens AdminCheckupScreen for
// that player — replying there removes them from this queue.
export default function AdminCheckupInboxScreen({ navigation }) {
  const { setSelectedStudent } = useCoach();
  const { refresh } = useAdminNotify();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setRows(await fetchPendingCheckups());
    } catch (e) {
      console.error('[AdminCheckupInbox] load:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  // Coming back from a reply should drop the answered player off the list, and
  // the dashboard dot should follow.
  useFocusEffect(useCallback(() => { load(); refresh(); }, [load, refresh]));

  return (
    <ScreenFrame maxWidth={CARD_W} ready={!loading}>
      <View style={styles.card}>
        <ScreenHeader
          title="CHECK-UP INBOX"
          subtitle={loading ? ' ' : `${rows.length} WAITING ON YOU`}
          onBack={() => navigation.goBack()}
        />

        <View style={styles.body}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={C.deepBlue} />
            </View>
          ) : rows.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>ALL CLEAR</Text>
              <Text style={styles.muted}>Every submitted check-up has your reply.</Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {rows.map((row, i) => (
                <Pressable
                  key={row.checkupId}
                  style={styles.row}
                  onPress={() => {
                    setSelectedStudent(row.player);
                    navigation.navigate('PlayerCheckup', { player: row.player });
                  }}
                >
                  <View style={styles.rankChip}>
                    <Text style={styles.rankText}>{String(i + 1).padStart(2, '0')}</Text>
                  </View>
                  <View style={styles.rowMain}>
                    <View style={styles.nameRow}>
                      <Text style={styles.name} numberOfLines={1}>
                        {row.player.full_name || '(no name)'}
                      </Text>
                      <View style={styles.dot} />
                    </View>
                    <Text style={styles.meta}>Submitted {ago(row.submittedAt)}</Text>
                  </View>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>NEEDS REPLY</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              ))}
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

const ACCENT = '#4A9EBF';
const ALERT  = '#E11D48';

const styles = StyleSheet.create({
  card: { height: CARD_H },
  body: { flex: 1, paddingHorizontal: 26, paddingTop: 18, paddingBottom: 26 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyTitle: {
    fontFamily: F.heading, fontSize: 26, color: ACCENT, letterSpacing: 4,
  },
  muted: { fontFamily: F.bodyMed, fontSize: 17, color: '#4a6a8a', letterSpacing: 1.5 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#070d1a',
    borderWidth: 1.5,
    borderColor: '#1a3a5c',
    borderRadius: 12,
    padding: 20,
    marginBottom: 14,
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.18, shadowRadius: 12,
  },
  rankChip: {
    width: 42, height: 42, borderRadius: 10,
    borderWidth: 1.5, borderColor: ACCENT,
    backgroundColor: 'rgba(74,158,191,0.08)',
    alignItems: 'center', justifyContent: 'center', marginRight: 16,
  },
  rankText: { fontFamily: F.heading, fontSize: 17, color: ACCENT, letterSpacing: 1 },
  rowMain: { flex: 1, gap: 6 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: {
    flexShrink: 1,
    fontFamily: F.heading, fontSize: 24, color: '#E8F4FF',
    letterSpacing: 2, textTransform: 'uppercase',
  },
  // The same red "you owe this" marker used on the dashboard bell.
  dot: {
    width: 9, height: 9, borderRadius: 5, backgroundColor: ALERT,
    shadowColor: ALERT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 6,
  },
  meta: { fontFamily: F.bodyMed, fontSize: 15, color: '#4a6a8a', letterSpacing: 1.5 },
  badge: {
    borderWidth: 1.5, borderColor: ALERT, borderRadius: 999,
    backgroundColor: 'rgba(225,29,72,0.10)',
    paddingHorizontal: 14, paddingVertical: 6,
  },
  badgeText: { fontFamily: F.heading, fontSize: 13, color: ALERT, letterSpacing: 1.5 },
  chevron: { fontFamily: F.heading, fontSize: 28, color: ACCENT, marginLeft: 12, marginTop: -2 },
});
