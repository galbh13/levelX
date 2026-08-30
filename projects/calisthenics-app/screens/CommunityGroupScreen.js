import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, PanResponder,
} from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { supabase } from '../lib/supabase';
import ScreenFrame from '../components/ScreenFrame';
import PillButton from '../components/PillButton';
import {
  fetchGroupMembers, fetchGroupChallenges,
  fetchCompletionsByChallenge, setChallengeCompletion,
  fetchGroupLeaderboard, fetchGroupStreak, fetchGroupRaids, addRaidContribution,
  fetchGroupMessages, purgeExpiredMessages,
} from '../lib/community';

// The chat itself lives on its own full-screen CommunityChat screen (WhatsApp-
// style, so history scrolls there instead of growing endlessly in this dashboard).
// Here we only keep a light poll to feed the CHAT bar's last-message PREVIEW; the
// bar (tap) and a left-swipe both open the full chat. Poll runs for the mounted
// life of this screen — NOT focus-gated (this sits in the material-top-tab pager
// where focus tracking is unreliable; a gate would silently never fire).
const CHAT_POLL_MS = 3000;

const timeOf = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};

// ─── One group (player view) ────────────────────────────────────────────────
// The group's members and its challenges. Each challenge shows every member with
// a check — you can tick your OWN off to mark you did it, and see who else has.
export default function CommunityGroupScreen({ navigation, route }) {
  const group = route.params?.group ?? null;
  const [meId, setMeId] = useState(null);
  const [members, setMembers] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [completions, setCompletions] = useState({}); // challenge_id → [player_id]
  const [leaderboard, setLeaderboard] = useState([]);
  const [streak, setStreak] = useState({ streak: 0, pending: 0 });
  const [raids, setRaids] = useState([]);
  const [raidInputs, setRaidInputs] = useState({}); // raid_id → typed amount
  const [loggingRaid, setLoggingRaid] = useState(null); // raid_id being logged
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!group?.id) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setMeId(user?.id ?? null);

      const [m, c, lb, st, rd, msgs] = await Promise.all([
        fetchGroupMembers(group.id),
        fetchGroupChallenges(group.id, { todayOnly: true }),
        fetchGroupLeaderboard(group.id),
        fetchGroupStreak(group.id),
        fetchGroupRaids(group.id),
        fetchGroupMessages(group.id),
      ]);
      setMembers(m);
      setChallenges(c);
      setLeaderboard(lb);
      setStreak(st);
      setRaids(rd);
      setMessages(msgs);
      setCompletions(await fetchCompletionsByChallenge(c.map(ch => ch.id)));
      purgeExpiredMessages(group.id); // sweep old chat on entry (fire-and-forget)
    } catch (e) {
      console.error('[CommunityGroupScreen] load:', e);
    }
    setLoading(false);
  }, [group?.id]);

  useEffect(() => { load(); }, [load]);

  // Lightweight message-only refetch — what the fast poll and post-send use.
  const refreshMessages = useCallback(async () => {
    if (!group?.id) return;
    try { setMessages(await fetchGroupMessages(group.id)); }
    catch (e) { console.error('[CommunityGroupScreen] refreshMessages:', e); }
  }, [group?.id]);

  // Fast poll for the whole mounted life of this screen — makes chat feel live
  // without a websocket. Clears automatically when the screen unmounts (back to
  // the group list). See the CHAT_POLL_MS note on why this isn't focus-gated.
  useEffect(() => {
    if (!group?.id) return;
    const id = setInterval(refreshMessages, CHAT_POLL_MS);
    return () => clearInterval(id);
  }, [group?.id, refreshMessages]);

  // Open the full-screen chat. Held in a ref so the (once-created) PanResponder
  // always calls the latest version without being recreated each render.
  const openChat = useCallback(() => {
    if (group?.id) navigation.navigate('CommunityChat', { group });
  }, [navigation, group?.id]);
  const openChatRef = useRef(openChat);
  openChatRef.current = openChat;

  // Left-swipe anywhere on the card opens the chat (a native bonus on top of the
  // tappable CHAT bar). Only claims clearly-horizontal left drags, so vertical
  // scrolling of the dashboard passes straight through.
  const swipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        g.dx < -18 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
      onPanResponderRelease: (_, g) => {
        if (g.dx < -55 && Math.abs(g.dx) > Math.abs(g.dy)) openChatRef.current();
      },
    })
  ).current;

  // Toggle MY completion of a challenge (only my own chip is tappable).
  async function toggleMine(challengeId, done) {
    if (!meId) return;
    setCompletions(prev => {
      const cur = new Set(prev[challengeId] ?? []);
      if (done) cur.add(meId); else cur.delete(meId);
      return { ...prev, [challengeId]: [...cur] };
    });
    try {
      await setChallengeCompletion(challengeId, meId, done);
      // The streak counts live — refresh it once my tick lands so the flame
      // reacts the moment the whole group clears a challenge.
      fetchGroupStreak(group.id).then(setStreak).catch(() => {});
    } catch (e) {
      console.error('[CommunityGroupScreen] toggleMine:', e);
      load(); // re-sync on failure
    }
  }

  // Log my contribution toward a raid, then refresh that raid's pooled total.
  async function logRaid(raidId) {
    if (!meId || loggingRaid) return;
    const amount = parseInt(raidInputs[raidId], 10);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setLoggingRaid(raidId);
    try {
      await addRaidContribution(raidId, meId, amount);
      setRaidInputs(prev => ({ ...prev, [raidId]: '' }));
      setRaids(await fetchGroupRaids(group.id));
    } catch (e) {
      console.error('[CommunityGroupScreen] logRaid:', e);
    }
    setLoggingRaid(null);
  }

  const nameOf = (id) => (members.find(m => m.id === id)?.full_name || '?').split(' ')[0];
  // Chat senders who aren't group members can only be the admin posting in (the
  // "member send" RLS blocks non-members, but the admin-all policy lets the coach
  // post) — label them COACH rather than an unresolvable '?'.
  const chatSenderName = (id) => {
    const m = members.find(x => x.id === id);
    return m ? (m.full_name || '?').split(' ')[0] : 'COACH';
  };

  // Latest message for the CHAT bar preview (messages are stored oldest→newest).
  const lastMsg = messages.length ? messages[messages.length - 1] : null;
  const lastSender = lastMsg
    ? (lastMsg.player_id === meId ? 'You' : chatSenderName(lastMsg.player_id))
    : '';

  return (
    <ScreenFrame fill ready={!loading}>
      <View style={styles.card} {...swipe.panHandlers}>
        {/* Header — BACK on its own row so the group name gets the full width and
            never gets truncated by the pill. Title + description sit below it. */}
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <PillButton label="← BACK" size="sm" onPress={() => navigation.goBack()} />
          </View>
          <Text style={styles.headerTitle} numberOfLines={2}>{group?.name ?? 'GROUP'}</Text>
          {group?.description ? (
            <Text style={styles.headerSubtitle}>{group.description}</Text>
          ) : null}
          <View style={styles.headerDivider} />
        </View>

        <View style={styles.body}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={C.deepBlue} />
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Chat — raised to the TOP (above the streak) as the group's primary
                  entry point; opens the full-screen chat on tap OR a left-swipe on
                  the card. The bar shows the latest message as a live preview. */}
              <Text style={styles.sectionTitle}>CHAT</Text>
              <Pressable style={styles.chatBar} onPress={openChat}>
                <View style={styles.chatBarHandle} />
                <View style={styles.chatBarText}>
                  {lastMsg ? (
                    <>
                      <Text style={styles.chatBarPreview} numberOfLines={1}>
                        <Text style={styles.chatBarSender}>{lastSender}: </Text>
                        {lastMsg.body}
                      </Text>
                      <Text style={styles.chatBarMeta}>{timeOf(lastMsg.created_at)} · tap or swipe to open</Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.chatBarPreview}>Open group chat</Text>
                      <Text style={styles.chatBarMeta}>No messages yet · tap or swipe to open</Text>
                    </>
                  )}
                </View>
                <Text style={styles.chatBarChevron}>›</Text>
              </Pressable>

              {/* Group streak — the shared count the whole squad keeps alive. */}
              <View style={[styles.streakBanner, styles.sectionGap]}>
                <View style={styles.streakBar} />
                <View style={styles.streakText}>
                  <Text style={styles.streakNum}>{streak.streak}</Text>
                  <Text style={styles.streakLabel}>GROUP STREAK</Text>
                </View>
              </View>

              {/* Challenges */}
              <Text style={[styles.sectionTitle, styles.sectionGap]}>CHALLENGES</Text>
              {challenges.length === 0 ? (
                <Text style={styles.muted}>No challenges yet — check back soon.</Text>
              ) : (
                challenges.map(ch => {
                  const done = completions[ch.id] ?? [];
                  return (
                    <View key={ch.id} style={styles.challengeCard}>
                      <View style={styles.challengeHead}>
                        <View style={styles.challengeHandle} />
                        <View style={styles.challengeText}>
                          <Text style={styles.challengeTitle}>{ch.title}</Text>
                          {ch.description ? (
                            <Text style={styles.challengeDesc}>{ch.description}</Text>
                          ) : null}
                        </View>
                        <Text style={styles.tally}>{done.length}/{members.length}</Text>
                      </View>

                      {/* Per-member completion — my chip is tappable, others read-only. */}
                      <View style={styles.doneRow}>
                        {members.map(m => {
                          const isDone = done.includes(m.id);
                          const isMe = m.id === meId;
                          return (
                            <Pressable
                              key={m.id}
                              disabled={!isMe}
                              onPress={() => toggleMine(ch.id, !isDone)}
                              style={[
                                styles.doneChip,
                                isDone && styles.doneChipOn,
                                isMe && styles.doneChipMe,
                              ]}
                            >
                              <View style={[styles.doneCheck, isDone && styles.doneCheckOn]}>
                                {isDone ? <Text style={styles.doneCheckMark}>✓</Text> : null}
                              </View>
                              <Text style={[styles.doneName, isDone && styles.doneNameOn]} numberOfLines={1}>
                                {(m.full_name || '?').split(' ')[0]}{isMe ? ' (you)' : ''}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  );
                })
              )}

              {/* Raids — the group-wide pooled goal everyone chips at together. */}
              <Text style={[styles.sectionTitle, styles.sectionGap]}>RAIDS</Text>
              {raids.length === 0 ? (
                <Text style={styles.muted}>No active raid. Your coach will summon one.</Text>
              ) : (
                raids.map(r => {
                  const pct  = Math.min(1, r.target > 0 ? r.total / r.target : 0);
                  const done = r.total >= r.target;
                  const mine = r.byPlayer[meId] ?? 0;
                  const contributors = Object.entries(r.byPlayer)
                    .sort((a, b) => b[1] - a[1]);
                  return (
                    <View key={r.id} style={[styles.raidCard, done && styles.raidCardDone]}>
                      <View style={styles.raidHead}>
                        <Text style={styles.raidTitle}>{r.title}</Text>
                        <Text style={[styles.raidTally, done && styles.raidTallyDone]}>
                          {r.total}/{r.target}{r.unit ? ` ${r.unit}` : ''}
                        </Text>
                      </View>
                      {r.description ? <Text style={styles.raidDesc}>{r.description}</Text> : null}

                      <View style={styles.raidBarTrack}>
                        <View style={[styles.raidBarFill, { width: `${pct * 100}%` }, done && styles.raidBarFillDone]} />
                      </View>

                      {contributors.length > 0 && (
                        <View style={styles.raidContribRow}>
                          {contributors.map(([pid, amt]) => (
                            <View key={pid} style={styles.raidContribChip}>
                              <Text style={styles.raidContribName}>
                                {nameOf(pid)}{pid === meId ? ' (you)' : ''}
                              </Text>
                              <Text style={styles.raidContribAmt}>+{amt}</Text>
                            </View>
                          ))}
                        </View>
                      )}

                      {done ? (
                        <Text style={styles.raidDoneText}>✦ RAID CLEARED ✦</Text>
                      ) : (
                        <View style={styles.raidLogRow}>
                          <TextInput
                            style={styles.raidInput}
                            value={raidInputs[r.id] ?? ''}
                            onChangeText={(t) => setRaidInputs(prev => ({ ...prev, [r.id]: t.replace(/[^0-9]/g, '') }))}
                            placeholder={`+ ${r.unit || 'reps'}`}
                            placeholderTextColor="#3a5a7a"
                            keyboardType="number-pad"
                          />
                          <PillButton
                            label="LOG"
                            tone="gold"
                            size="sm"
                            onPress={() => logRaid(r.id)}
                            loading={loggingRaid === r.id}
                            disabled={!(parseInt(raidInputs[r.id], 10) > 0)}
                          />
                          {mine > 0 ? <Text style={styles.raidMine}>you: {mine}</Text> : null}
                        </View>
                      )}
                    </View>
                  );
                })
              )}

              {/* Leaderboard — ranked by class tier, then LVL. */}
              <Text style={[styles.sectionTitle, styles.sectionGap]}>LEADERBOARD</Text>
              {leaderboard.length === 0 ? (
                <Text style={styles.muted}>No ranked members yet.</Text>
              ) : (
                leaderboard.map((p, i) => {
                  const isMe = p.id === meId;
                  const rank = RANK[i] ?? null; // gold / silver / bronze for the top 3
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => navigation.navigate('HunterStatus', { userId: p.id })}
                      style={[
                        styles.lbRow,
                        isMe && styles.lbRowMe,
                        rank && { borderColor: rank.border, backgroundColor: rank.bg,
                                  shadowColor: rank.glow, shadowOpacity: 0.28, shadowRadius: 14 },
                      ]}
                    >
                      <View style={[styles.rankBadge, rank && { borderColor: rank.border, backgroundColor: rank.badgeBg }]}>
                        <Text style={[styles.rankNum, rank && { color: rank.color, textShadowColor: rank.glow }]}>
                          {i + 1}
                        </Text>
                      </View>
                      <View style={styles.lbText}>
                        <Text style={[styles.lbName, isMe && styles.lbNameMe]} numberOfLines={1}>
                          {p.name}{isMe ? ' (you)' : ''}
                        </Text>
                        <Text style={styles.lbClass}>{p.className}</Text>
                      </View>
                      <Text style={[styles.lbLvl, rank && { color: rank.color }]}>LVL {p.lvl}</Text>
                    </Pressable>
                  );
                })
              )}

              {/* Members */}
              <Text style={[styles.sectionTitle, styles.sectionGap]}>MEMBERS</Text>
              <View style={styles.memberRow}>
                {members.length === 0 ? (
                  <Text style={styles.muted}>No members yet.</Text>
                ) : (
                  members.map(m => (
                    <Pressable
                      key={m.id}
                      onPress={() => navigation.navigate('HunterStatus', { userId: m.id })}
                      style={styles.memberChip}
                    >
                      <Text style={styles.memberChipText}>{m.full_name || '(no name)'}</Text>
                    </Pressable>
                  ))
                )}
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </ScreenFrame>
  );
}

const ACCENT = '#4A9EBF';

// Podium palette for the leaderboard's top three — gold, silver, bronze. Each
// tints the rank square, the row border/glow, and the LVL number.
const RANK = [
  { color: '#FFD700', glow: '#FFD700', border: 'rgba(255,215,0,0.55)',  bg: 'rgba(255,215,0,0.06)',  badgeBg: 'rgba(255,215,0,0.12)' },  // gold
  { color: '#D6DEE8', glow: '#C7D0DB', border: 'rgba(200,210,225,0.5)', bg: 'rgba(200,210,225,0.05)', badgeBg: 'rgba(200,210,225,0.12)' }, // silver
  { color: '#E0985A', glow: '#CD7F32', border: 'rgba(205,127,50,0.55)', bg: 'rgba(205,127,50,0.06)',  badgeBg: 'rgba(205,127,50,0.14)' },  // bronze
];

const styles = StyleSheet.create({
  card: { flex: 1 },

  // ── Header ──
  header: { paddingHorizontal: 22, paddingTop: 22 },
  headerTopRow: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: {
    fontFamily: F.heading,
    fontSize: 30,
    color: ACCENT,
    letterSpacing: 4,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginTop: 18,
    textShadowColor: 'rgba(74,158,191,0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  headerSubtitle: {
    fontFamily: F.bodyMed,
    fontSize: 15,
    color: '#5a7a9a',
    letterSpacing: 2,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginTop: 8,
  },
  headerDivider: { height: 1, backgroundColor: ACCENT, opacity: 0.3, marginTop: 16 },

  body: { flex: 1, paddingHorizontal: 24, paddingTop: 18, paddingBottom: 26 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  sectionTitle: {
    fontFamily: F.heading, fontSize: 18, color: C.deepBlue,
    letterSpacing: 3, marginBottom: 14,
  },
  sectionGap: { marginTop: 28 },
  muted: { fontFamily: F.bodyMed, fontSize: 15, color: '#5a7a9a', letterSpacing: 0.6 },

  memberRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  memberChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(74,158,191,0.4)',
    backgroundColor: 'rgba(74,158,191,0.08)',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  memberChipText: { fontFamily: F.heading, fontSize: 14, color: C.text, letterSpacing: 1 },

  challengeCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.30)',
    backgroundColor: 'rgba(255,215,0,0.04)',
    paddingVertical: 18,
    paddingHorizontal: 18,
    marginBottom: 14,
    shadowColor: '#FFD700', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.12, shadowRadius: 12,
  },
  challengeHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  challengeHandle: {
    width: 4, height: 40, borderRadius: 2, marginTop: 2,
    backgroundColor: '#FFD700',
    shadowColor: '#FFD700', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 8,
  },
  challengeText: { flex: 1, gap: 6 },
  challengeTitle: {
    fontFamily: F.heading, fontSize: 20, color: C.text,
    letterSpacing: 1, textTransform: 'uppercase',
  },
  challengeDesc: {
    fontFamily: F.bodyMed, fontSize: 15, color: '#7a94ac', letterSpacing: 0.4, lineHeight: 22,
  },
  tally: {
    fontFamily: F.heading, fontSize: 16, color: '#FFD700',
    letterSpacing: 1, marginTop: 2,
  },

  // Per-member completion chips under a challenge.
  doneRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,215,0,0.15)',
  },
  doneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(74,158,191,0.25)',
    backgroundColor: C.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  // My own chip reads as the interactive one (brighter accent border).
  doneChipMe: { borderColor: 'rgba(74,158,191,0.7)' },
  doneChipOn: {
    borderColor: '#4CAF50',
    backgroundColor: 'rgba(76,175,80,0.12)',
    shadowColor: '#4CAF50', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
  doneCheck: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#3a5a7a',
    alignItems: 'center', justifyContent: 'center',
  },
  doneCheckOn: { borderColor: '#4CAF50', backgroundColor: 'rgba(76,175,80,0.25)' },
  doneCheckMark: { fontFamily: F.heading, fontSize: 12, color: '#4CAF50' },
  doneName: { fontFamily: F.heading, fontSize: 13, color: '#7a94ac', letterSpacing: 0.6 },
  doneNameOn: { color: C.text },

  // ── Streak banner ──
  streakBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,140,40,0.35)',
    backgroundColor: 'rgba(255,140,40,0.06)',
    paddingVertical: 16,
    paddingHorizontal: 18,
    shadowColor: '#FF8C28', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.2, shadowRadius: 14,
  },
  streakBar: {
    width: 6, height: 48, borderRadius: 3,
    backgroundColor: '#FF8C28',
    shadowColor: '#FF8C28', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 10,
  },
  streakText: { alignItems: 'flex-start' },
  streakNum: { fontFamily: F.heading, fontSize: 34, color: '#FFB067', letterSpacing: 1, lineHeight: 36 },
  streakLabel: { fontFamily: F.heading, fontSize: 12, color: '#c98a4a', letterSpacing: 2 },

  // ── Raids ──
  raidCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(74,158,191,0.30)',
    backgroundColor: 'rgba(74,158,191,0.05)',
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  raidCardDone: {
    borderColor: 'rgba(255,215,0,0.5)',
    backgroundColor: 'rgba(255,215,0,0.06)',
    shadowColor: '#FFD700', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.25, shadowRadius: 12,
  },
  raidHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  raidTitle: { flex: 1, fontFamily: F.heading, fontSize: 19, color: C.text, letterSpacing: 1, textTransform: 'uppercase' },
  raidTally: { fontFamily: F.heading, fontSize: 15, color: ACCENT, letterSpacing: 0.5 },
  raidTallyDone: { color: '#FFD700' },
  raidDesc: { fontFamily: F.bodyMed, fontSize: 14, color: '#7a94ac', letterSpacing: 0.4, lineHeight: 21, marginTop: 6 },
  raidBarTrack: {
    height: 10, borderRadius: 999, marginTop: 14,
    backgroundColor: 'rgba(74,158,191,0.12)', overflow: 'hidden',
  },
  raidBarFill: {
    height: '100%', borderRadius: 999, backgroundColor: ACCENT,
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6,
  },
  raidBarFillDone: { backgroundColor: '#FFD700', shadowColor: '#FFD700' },
  raidContribRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  raidContribChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 999, borderWidth: 1, borderColor: 'rgba(74,158,191,0.25)',
    backgroundColor: C.surface, paddingHorizontal: 11, paddingVertical: 6,
  },
  raidContribName: { fontFamily: F.heading, fontSize: 12, color: '#7a94ac', letterSpacing: 0.6 },
  raidContribAmt: { fontFamily: F.heading, fontSize: 12, color: ACCENT, letterSpacing: 0.6 },
  raidLogRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  raidInput: {
    width: 96, fontFamily: F.heading, fontSize: 16, color: C.text,
    backgroundColor: C.surface, borderWidth: 1, borderColor: 'rgba(74,158,191,0.35)',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, textAlign: 'center',
  },
  raidMine: { fontFamily: F.bodyMed, fontSize: 12, color: '#5a7a9a', letterSpacing: 0.6 },
  raidDoneText: {
    fontFamily: F.heading, fontSize: 14, color: '#FFD700', letterSpacing: 2,
    textAlign: 'center', marginTop: 16,
    textShadowColor: 'rgba(255,215,0,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
  },

  // ── Leaderboard ──
  lbRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(74,158,191,0.2)',
    backgroundColor: C.surface, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 10,
  },
  lbRowMe: { borderColor: C.deepBlue, backgroundColor: 'rgba(74,158,191,0.10)' },
  rankBadge: {
    width: 42, height: 42, borderRadius: 11,
    borderWidth: 1.5, borderColor: 'rgba(74,158,191,0.3)',
    backgroundColor: 'rgba(74,158,191,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  rankNum: {
    fontFamily: F.heading, fontSize: 22, color: '#7a94ac', letterSpacing: 0.5,
    textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
  },
  lbText: { flex: 1 },
  lbName: { fontFamily: F.heading, fontSize: 16, color: '#7a94ac', letterSpacing: 1, textTransform: 'uppercase' },
  lbNameMe: { color: C.text },
  lbClass: {
    fontFamily: F.heading, fontSize: 15, color: ACCENT, letterSpacing: 1.2,
    textTransform: 'uppercase', marginTop: 4,
  },
  lbLvl: { fontFamily: F.heading, fontSize: 15, color: ACCENT, letterSpacing: 0.5 },

  // ── Chat bar (opens the full-screen chat) ──
  chatBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(74,158,191,0.35)',
    backgroundColor: 'rgba(74,158,191,0.06)',
    paddingVertical: 16,
    paddingHorizontal: 16,
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.15, shadowRadius: 10,
  },
  chatBarHandle: {
    width: 4, height: 40, borderRadius: 2,
    backgroundColor: ACCENT,
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 8,
  },
  chatBarText: { flex: 1, gap: 4 },
  chatBarPreview: { fontFamily: F.bodyMed, fontSize: 15, color: C.text, letterSpacing: 0.2 },
  chatBarSender: { fontFamily: F.heading, fontSize: 14, color: ACCENT, letterSpacing: 0.5 },
  chatBarMeta: { fontFamily: F.bodyMed, fontSize: 12, color: '#5a7a9a', letterSpacing: 0.4 },
  chatBarChevron: { fontFamily: F.heading, fontSize: 28, color: ACCENT, marginTop: -4 },
});
