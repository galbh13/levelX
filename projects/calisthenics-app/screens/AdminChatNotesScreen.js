import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator,
} from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { CARD_H, CARD_W } from '../constants/layout';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import { useCoach } from '../context/CoachContext';
import { useAdminNotify } from '../context/AdminNotifyContext';
import { fetchChatThreads, markChatRead } from '../lib/adminInbox';

// ─── Admin — CHAT NOTES ─────────────────────────────────────────────────────
// One WhatsApp-style list of every 1-on-1 coach chat: search by player name,
// unread threads pinned to the top with a count, tap to drop straight into the
// conversation. Unlike the check-up inbox there is nothing to answer — SEEING a
// thread clears it, so opening one marks it read (read-marks live locally on
// this device; see lib/adminInbox).
export default function AdminChatNotesScreen({ navigation }) {
  const { setSelectedStudent } = useCoach();
  const { refresh } = useAdminNotify();
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      setThreads(await fetchChatThreads());
    } catch (e) {
      console.error('[AdminChatNotes] load:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  // Returning from a chat re-sorts the list with that thread now read.
  useFocusEffect(useCallback(() => { load(); refresh(); }, [load, refresh]));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter(t => (t.player.full_name ?? '').toLowerCase().includes(q));
  }, [threads, query]);

  const unreadTotal = threads.reduce((n, t) => n + t.unread, 0);

  async function openThread(thread) {
    // Mark read up to this thread's newest message, then hand off to the chat.
    if (thread.unread > 0) {
      await markChatRead(thread.player.id, thread.lastAt ?? undefined);
      setThreads(prev => prev.map(t => (t.player.id === thread.player.id ? { ...t, unread: 0 } : t)));
      refresh();
    }
    setSelectedStudent(thread.player);
    navigation.navigate('CoachChat', { player: thread.player, isAdmin: true });
  }

  return (
    <ScreenFrame maxWidth={CARD_W} ready={!loading}>
      <View style={styles.card}>
        <ScreenHeader
          title="CHAT NOTES"
          subtitle={loading ? ' ' : unreadTotal > 0 ? `${unreadTotal} UNREAD` : 'ALL READ'}
          onBack={() => navigation.goBack()}
        />

        <View style={styles.body}>
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="Search player..."
            placeholderTextColor="#3a5a7a"
            autoCorrect={false}
          />

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={C.deepBlue} />
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.muted}>
                {query.trim() ? 'No player matches that name.' : 'No players yet.'}
              </Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {filtered.map(t => {
                const unread = t.unread > 0;
                return (
                  <Pressable
                    key={t.player.id}
                    style={[styles.row, unread && styles.rowUnread]}
                    onPress={() => openThread(t)}
                  >
                    <View style={[styles.avatar, unread && styles.avatarUnread]}>
                      <Text style={[styles.avatarText, unread && styles.avatarTextUnread]}>
                        {initials(t.player.full_name)}
                      </Text>
                    </View>

                    <View style={styles.rowMain}>
                      <View style={styles.nameRow}>
                        <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>
                          {t.player.full_name || '(no name)'}
                        </Text>
                        <Text style={styles.time}>{t.lastAt ? ago(t.lastAt) : ''}</Text>
                      </View>
                      <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
                        {t.lastMessage
                          ? `${t.fromPlayer ? '' : 'You: '}${t.lastMessage}`
                          : 'No messages yet'}
                      </Text>
                    </View>

                    {unread ? (
                      <View style={styles.unreadPill}>
                        <Text style={styles.unreadPillText}>{t.unread}</Text>
                      </View>
                    ) : null}
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

function initials(name) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function ago(iso) {
  const then = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days <= 7) return `${days}d`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const ACCENT = '#4A9EBF';
const JADE   = '#1FD79A';

const styles = StyleSheet.create({
  card: { height: CARD_H },
  body: { flex: 1, paddingHorizontal: 26, paddingTop: 18, paddingBottom: 26 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { fontFamily: F.bodyMed, fontSize: 17, color: '#4a6a8a', letterSpacing: 1.5 },

  search: {
    borderWidth: 1.5,
    borderColor: '#1a3a5c',
    borderRadius: 999,
    backgroundColor: '#070d1a',
    paddingHorizontal: 22,
    paddingVertical: 12,
    marginBottom: 18,
    fontFamily: F.bodyMed,
    fontSize: 17,
    color: '#E8F4FF',
    letterSpacing: 1,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#070d1a',
    borderWidth: 1.5,
    borderColor: '#1a3a5c',
    borderRadius: 12,
    padding: 18,
    marginBottom: 12,
  },
  // Unread threads read as "live": jade border + glow, the same tone the chat
  // itself uses for the player's side.
  rowUnread: {
    borderColor: JADE,
    backgroundColor: 'rgba(31,215,154,0.06)',
    shadowColor: JADE, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.35, shadowRadius: 12,
  },
  avatar: {
    width: 46, height: 46, borderRadius: 23,
    borderWidth: 1.5, borderColor: ACCENT,
    backgroundColor: 'rgba(74,158,191,0.08)',
    alignItems: 'center', justifyContent: 'center', marginRight: 16,
  },
  avatarUnread: { borderColor: JADE, backgroundColor: 'rgba(31,215,154,0.10)' },
  avatarText: { fontFamily: F.heading, fontSize: 17, color: ACCENT, letterSpacing: 1 },
  avatarTextUnread: { color: JADE },

  rowMain: { flex: 1, gap: 6 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: {
    flex: 1,
    fontFamily: F.heading, fontSize: 22, color: '#E8F4FF',
    letterSpacing: 2, textTransform: 'uppercase',
  },
  nameUnread: { color: JADE },
  time: { fontFamily: F.bodyMed, fontSize: 14, color: '#4a6a8a', letterSpacing: 1 },
  preview: { fontFamily: F.bodyMed, fontSize: 16, color: '#4a6a8a', letterSpacing: 0.5 },
  previewUnread: { color: '#B8E8D8' },

  unreadPill: {
    minWidth: 30,
    borderRadius: 999,
    backgroundColor: JADE,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignItems: 'center',
    marginLeft: 10,
    shadowColor: JADE, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 8,
  },
  unreadPillText: { fontFamily: F.heading, fontSize: 15, color: '#050912', letterSpacing: 1 },

  chevron: { fontFamily: F.heading, fontSize: 28, color: ACCENT, marginLeft: 10, marginTop: -2 },
});
