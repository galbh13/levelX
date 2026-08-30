import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Modal, PanResponder,
} from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { supabase } from '../lib/supabase';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import PillButton from '../components/PillButton';
import {
  fetchGroupMemberIds, addMember, removeMember,
  fetchGroupChallenges, createChallenge, deleteChallenge,
  fetchCompletionsByChallenge, deleteGroup,
  fetchGroupRaids, createRaid, deleteRaid,
  fetchGroupLeaderboard, fetchGroupStreak,
  fetchGroupMessages,
} from '../lib/community';

// The chat is a separate full-screen CommunityChat screen (isAdmin mode — the
// coach posts as COACH and can delete any message). Here we keep a light poll only
// to feed the CHAT bar's last-message preview; the bar (tap) + a left-swipe open it.
const CHAT_POLL_MS = 3000;

const timeOf = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};

// ─── Admin — manage one group ───────────────────────────────────────────────
// Toggle which players belong to the group (a checklist of the whole roster),
// author challenges for it, and rename/delete the group. Every write needs the
// admin-override RLS in migration 20260717_community.sql.
export default function AdminGroupScreen({ navigation, route }) {
  const group = route.params?.group ?? null;

  const [players, setPlayers] = useState([]);       // whole roster
  const [memberIds, setMemberIds] = useState([]);   // player_ids currently in the group
  const [challenges, setChallenges] = useState([]);
  const [completions, setCompletions] = useState({}); // challenge_id → [player_id]
  const [loading, setLoading] = useState(true);
  const [busyPlayer, setBusyPlayer] = useState(null); // player_id being toggled

  // New-challenge form
  const [chTitle, setChTitle] = useState('');
  const [chDesc, setChDesc] = useState('');
  const [savingCh, setSavingCh] = useState(false);

  // Raids
  const [raids, setRaids] = useState([]);
  const [rTitle, setRTitle] = useState('');
  const [rTarget, setRTarget] = useState('');
  const [rUnit, setRUnit] = useState('');
  const [rDesc, setRDesc] = useState('');
  const [savingRaid, setSavingRaid] = useState(false);

  // Read-only oversight (mirrors the player dashboard)
  const [leaderboard, setLeaderboard] = useState([]);
  const [streak, setStreak] = useState({ streak: 0, pending: 0 });
  const [messages, setMessages] = useState([]); // chat — for the bar preview
  const [meId, setMeId] = useState(null);       // admin's own id (labels own preview COACH)

  // Which authoring widget is open: 'challenge' | 'raid' | 'members' | null.
  const [modal, setModal] = useState(null);
  const closeModal = () => setModal(null);

  const load = useCallback(async () => {
    if (!group?.id) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setMeId(user?.id ?? null);
      const [rosterRes, ids, chs, rds, lb, st, msgs] = await Promise.all([
        supabase.from('profiles').select('id, full_name').eq('role', 'player').order('full_name', { ascending: true }),
        fetchGroupMemberIds(group.id),
        fetchGroupChallenges(group.id),
        fetchGroupRaids(group.id),
        fetchGroupLeaderboard(group.id),
        fetchGroupStreak(group.id),
        fetchGroupMessages(group.id),
      ]);
      setPlayers(rosterRes.data ?? []);
      setMemberIds(ids);
      setChallenges(chs);
      setRaids(rds);
      setLeaderboard(lb);
      setStreak(st);
      setMessages(msgs);
      setCompletions(await fetchCompletionsByChallenge(chs.map(c => c.id)));
    } catch (e) {
      console.error('[AdminGroupScreen] load:', e);
    }
    setLoading(false);
  }, [group?.id]);

  useEffect(() => { load(); }, [load]);

  // Live chat — lightweight message-only refetch on a poll for the mounted life
  // of the screen (same approach as the player group screen).
  const refreshMessages = useCallback(async () => {
    if (!group?.id) return;
    try { setMessages(await fetchGroupMessages(group.id)); }
    catch (e) { console.error('[AdminGroupScreen] refreshMessages:', e); }
  }, [group?.id]);

  useEffect(() => {
    if (!group?.id) return;
    const id = setInterval(refreshMessages, CHAT_POLL_MS);
    return () => clearInterval(id);
  }, [group?.id, refreshMessages]);

  async function toggleMember(playerId) {
    if (busyPlayer) return;
    const isMember = memberIds.includes(playerId);
    setBusyPlayer(playerId);
    // Optimistic
    setMemberIds(prev => isMember ? prev.filter(id => id !== playerId) : [...prev, playerId]);
    try {
      if (isMember) await removeMember(group.id, playerId);
      else await addMember(group.id, playerId);
    } catch (e) {
      console.error('[AdminGroupScreen] toggleMember:', e);
      // Revert on failure
      setMemberIds(prev => isMember ? [...prev, playerId] : prev.filter(id => id !== playerId));
    }
    setBusyPlayer(null);
  }

  async function handleAddChallenge() {
    if (!chTitle.trim() || savingCh) return;
    setSavingCh(true);
    try {
      await createChallenge(group.id, chTitle, chDesc);
      setChTitle(''); setChDesc('');
      setChallenges(await fetchGroupChallenges(group.id));
      closeModal();
    } catch (e) {
      console.error('[AdminGroupScreen] addChallenge:', e);
    }
    setSavingCh(false);
  }

  async function handleDeleteChallenge(id) {
    try {
      await deleteChallenge(id);
      setChallenges(prev => prev.filter(c => c.id !== id));
    } catch (e) {
      console.error('[AdminGroupScreen] deleteChallenge:', e);
    }
  }

  async function handleAddRaid() {
    if (!rTitle.trim() || !(parseInt(rTarget, 10) > 0) || savingRaid) return;
    setSavingRaid(true);
    try {
      await createRaid(group.id, { title: rTitle, target: rTarget, unit: rUnit, description: rDesc });
      setRTitle(''); setRTarget(''); setRUnit(''); setRDesc('');
      setRaids(await fetchGroupRaids(group.id));
      closeModal();
    } catch (e) {
      console.error('[AdminGroupScreen] addRaid:', e);
    }
    setSavingRaid(false);
  }

  async function handleDeleteRaid(id) {
    try {
      await deleteRaid(id);
      setRaids(prev => prev.filter(r => r.id !== id));
    } catch (e) {
      console.error('[AdminGroupScreen] deleteRaid:', e);
    }
  }

  // Open the full-screen chat in admin mode (post as COACH + delete any).
  const openChat = useCallback(() => {
    if (group?.id) navigation.navigate('CommunityChat', { group, isAdmin: true });
  }, [navigation, group?.id]);
  const openChatRef = useRef(openChat);
  openChatRef.current = openChat;

  // Left-swipe on the card opens the chat (bonus alongside the tappable CHAT bar).
  const swipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        g.dx < -18 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
      onPanResponderRelease: (_, g) => {
        if (g.dx < -55 && Math.abs(g.dx) > Math.abs(g.dy)) openChatRef.current();
      },
    })
  ).current;

  // Roster is players only (role='player'); the admin's own id won't be there, so
  // label the coach's own messages COACH rather than '?'.
  const senderName = (pid) =>
    pid === meId ? 'COACH' : (players.find(p => p.id === pid)?.full_name?.split(' ')[0] || 'COACH');

  // Latest message for the CHAT bar preview (stored oldest→newest).
  const lastMsg = messages.length ? messages[messages.length - 1] : null;
  const lastSender = lastMsg ? senderName(lastMsg.player_id) : '';

  function confirmDeleteGroup() {
    const doDelete = async () => {
      try {
        await deleteGroup(group.id);
        navigation.goBack();
      } catch (e) {
        console.error('[AdminGroupScreen] deleteGroup:', e);
      }
    };
    // Alert isn't available on web — fall back to immediate delete there.
    if (Alert?.alert) {
      Alert.alert('Delete group?', `"${group.name}" and its challenges will be removed.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    } else {
      doDelete();
    }
  }

  return (
    <ScreenFrame fill ready={!loading}>
      <View style={styles.card} {...swipe.panHandlers}>
        <ScreenHeader
          title={group?.name ?? 'GROUP'}
          onBack={() => navigation.goBack()}
          right={<PillButton label="DELETE" tone="danger" size="sm" onPress={confirmDeleteGroup} />}
        />

        <View style={styles.body}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={C.deepBlue} />
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Chat — raised to the TOP (above the streak) to mirror the player
                  layout; opens the full-screen chat in COACH mode on tap OR a
                  left-swipe. The bar shows the latest message as a live preview. */}
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

              {/* Group streak — read-only oversight, same as the player sees. */}
              <View style={[styles.streakBanner, styles.sectionGap]}>
                <View style={styles.streakBar} />
                <View style={styles.streakText}>
                  <Text style={styles.streakNum}>{streak.streak}</Text>
                  <Text style={styles.streakLabel}>GROUP STREAK</Text>
                </View>
              </View>

              {/* Challenges — ＋ NEW opens the authoring widget. */}
              <View style={[styles.sectionRow, styles.sectionGap]}>
                <Text style={[styles.sectionTitle, styles.sectionTitleFlush]}>CHALLENGES</Text>
                <PillButton label="＋ NEW" tone="gold" size="sm" onPress={() => setModal('challenge')} />
              </View>

              {challenges.length === 0 ? (
                <Text style={styles.muted}>No challenges yet.</Text>
              ) : (
                challenges.map(ch => {
                  const groupMembers = players.filter(p => memberIds.includes(p.id));
                  const done = completions[ch.id] ?? [];
                  return (
                    <View key={ch.id} style={styles.challengeCard}>
                      <View style={styles.challengeHead}>
                        <View style={styles.challengeText}>
                          <Text style={styles.challengeTitle}>{ch.title}</Text>
                          {ch.description ? <Text style={styles.challengeDesc}>{ch.description}</Text> : null}
                        </View>
                        <Text style={styles.tally}>{done.length}/{groupMembers.length}</Text>
                        <Pressable onPress={() => handleDeleteChallenge(ch.id)} style={styles.delBtn}>
                          <Text style={styles.delBtnText}>✕</Text>
                        </Pressable>
                      </View>

                      {/* Read-only completion view — who in the group has done it. */}
                      {groupMembers.length > 0 && (
                        <View style={styles.doneRow}>
                          {groupMembers.map(m => {
                            const isDone = done.includes(m.id);
                            return (
                              <View key={m.id} style={[styles.doneChip, isDone && styles.doneChipOn]}>
                                <View style={[styles.doneCheck, isDone && styles.doneCheckOn]}>
                                  {isDone ? <Text style={styles.doneCheckMark}>✓</Text> : null}
                                </View>
                                <Text style={[styles.doneName, isDone && styles.doneNameOn]} numberOfLines={1}>
                                  {(m.full_name || '?').split(' ')[0]}
                                </Text>
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                })
              )}

              {/* Raids — ＋ NEW opens the summon widget. */}
              <View style={[styles.sectionRow, styles.sectionGap]}>
                <Text style={[styles.sectionTitle, styles.sectionTitleFlush]}>RAIDS</Text>
                <PillButton label="＋ NEW" tone="accent" size="sm" onPress={() => setModal('raid')} />
              </View>

              {raids.length === 0 ? (
                <Text style={styles.muted}>No raids yet.</Text>
              ) : (
                raids.map(r => {
                  const pct  = Math.min(1, r.target > 0 ? r.total / r.target : 0);
                  const done = r.total >= r.target;
                  return (
                    <View key={r.id} style={styles.raidCard}>
                      <View style={styles.challengeHead}>
                        <View style={styles.challengeText}>
                          <Text style={styles.challengeTitle}>{r.title}</Text>
                          {r.description ? <Text style={styles.challengeDesc}>{r.description}</Text> : null}
                        </View>
                        <Text style={[styles.tally, done && styles.raidTallyDone]}>
                          {r.total}/{r.target}{r.unit ? ` ${r.unit}` : ''}
                        </Text>
                        <Pressable onPress={() => handleDeleteRaid(r.id)} style={styles.delBtn}>
                          <Text style={styles.delBtnText}>✕</Text>
                        </Pressable>
                      </View>
                      <View style={styles.raidBarTrack}>
                        <View style={[styles.raidBarFill, { width: `${pct * 100}%` }, done && styles.raidBarFillDone]} />
                      </View>
                    </View>
                  );
                })
              )}

              {/* Leaderboard — read-only, ranked by class tier then LVL. */}
              <Text style={[styles.sectionTitle, styles.sectionGap]}>LEADERBOARD</Text>
              {leaderboard.length === 0 ? (
                <Text style={styles.muted}>No ranked members yet.</Text>
              ) : (
                leaderboard.map((p, i) => {
                  const rank = RANK[i] ?? null;
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => navigation.navigate('HunterStatus', { userId: p.id })}
                      style={[
                        styles.lbRow,
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
                        <Text style={styles.lbName} numberOfLines={1}>{p.name}</Text>
                        <Text style={styles.lbClass}>{p.className}</Text>
                      </View>
                      <Text style={[styles.lbLvl, rank && { color: rank.color }]}>LVL {p.lvl}</Text>
                    </Pressable>
                  );
                })
              )}

              {/* Members — read-only chips; EDIT opens the roster management widget. */}
              <View style={[styles.sectionRow, styles.sectionGap]}>
                <Text style={[styles.sectionTitle, styles.sectionTitleFlush]}>MEMBERS</Text>
                <PillButton label="EDIT" tone="accent" variant="outline" size="sm" onPress={() => setModal('members')} />
              </View>
              <View style={styles.memberRow}>
                {memberIds.length === 0 ? (
                  <Text style={styles.muted}>No members yet — tap EDIT to add players.</Text>
                ) : (
                  players.filter(p => memberIds.includes(p.id)).map(m => (
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

      {/* ── Authoring widgets ── */}
      <Modal visible={modal === 'challenge'} transparent animationType="fade" onRequestClose={closeModal}>
        <Pressable style={styles.backdrop} onPress={closeModal}>
          <Pressable style={styles.modal} onPress={() => {}}>
            <Text style={styles.modalTitle}>NEW CHALLENGE</Text>
            <TextInput
              style={styles.input}
              value={chTitle}
              onChangeText={setChTitle}
              placeholder="Challenge title"
              placeholderTextColor="#3a5a7a"
            />
            <TextInput
              style={[styles.input, styles.inputMultiline, styles.modalField]}
              value={chDesc}
              onChangeText={setChDesc}
              placeholder="Description (optional)"
              placeholderTextColor="#3a5a7a"
              multiline
            />
            <View style={styles.modalActions}>
              <PillButton label="CANCEL" tone="muted" variant="outline" size="lg" onPress={closeModal} />
              <PillButton label="＋ ADD" tone="gold" size="lg" onPress={handleAddChallenge} loading={savingCh} disabled={!chTitle.trim()} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={modal === 'raid'} transparent animationType="fade" onRequestClose={closeModal}>
        <Pressable style={styles.backdrop} onPress={closeModal}>
          <Pressable style={styles.modal} onPress={() => {}}>
            <Text style={styles.modalTitle}>SUMMON RAID</Text>
            <Text style={styles.modalHint}>A group-wide target every member chips at together (e.g. "1000 pushups"). Choose it well.</Text>
            <TextInput
              style={[styles.input, styles.modalField]}
              value={rTitle}
              onChangeText={setRTitle}
              placeholder="Raid title (e.g. Squad Pushup Siege)"
              placeholderTextColor="#3a5a7a"
            />
            <View style={[styles.raidFormRow, styles.modalField]}>
              <TextInput
                style={[styles.input, styles.raidTargetInput]}
                value={rTarget}
                onChangeText={(t) => setRTarget(t.replace(/[^0-9]/g, ''))}
                placeholder="Target"
                placeholderTextColor="#3a5a7a"
                keyboardType="number-pad"
              />
              <TextInput
                style={[styles.input, styles.raidUnitInput]}
                value={rUnit}
                onChangeText={setRUnit}
                placeholder="Unit (pushups, km…)"
                placeholderTextColor="#3a5a7a"
              />
            </View>
            <TextInput
              style={[styles.input, styles.inputMultiline, styles.modalField]}
              value={rDesc}
              onChangeText={setRDesc}
              placeholder="Description (optional)"
              placeholderTextColor="#3a5a7a"
              multiline
            />
            <View style={styles.modalActions}>
              <PillButton label="CANCEL" tone="muted" variant="outline" size="lg" onPress={closeModal} />
              <PillButton
                label="＋ SUMMON"
                tone="accent"
                size="lg"
                onPress={handleAddRaid}
                loading={savingRaid}
                disabled={!rTitle.trim() || !(parseInt(rTarget, 10) > 0)}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={modal === 'members'} transparent animationType="fade" onRequestClose={closeModal}>
        <Pressable style={styles.backdrop} onPress={closeModal}>
          <Pressable style={styles.modal} onPress={() => {}}>
            <Text style={styles.modalTitle}>MANAGE MEMBERS</Text>
            <Text style={styles.modalHint}>Tap a player to add or remove them from this group.</Text>
            {players.length === 0 ? (
              <Text style={styles.muted}>No players on the roster yet.</Text>
            ) : (
              <ScrollView style={styles.memberPicker} showsVerticalScrollIndicator={false}>
                {players.map(p => {
                  const on = memberIds.includes(p.id);
                  return (
                    <Pressable
                      key={p.id}
                      style={[styles.playerRow, on && styles.playerRowOn]}
                      onPress={() => toggleMember(p.id)}
                    >
                      <View style={[styles.check, on && styles.checkOn]}>
                        {on ? <Text style={styles.checkMark}>✓</Text> : null}
                      </View>
                      <Text style={[styles.playerName, on && styles.playerNameOn]} numberOfLines={1}>
                        {p.full_name || '(no name)'}
                      </Text>
                      {busyPlayer === p.id ? <ActivityIndicator size="small" color={C.deepBlue} /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
            <View style={styles.modalActions}>
              <PillButton label="DONE" tone="accent" size="lg" onPress={closeModal} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1 },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 18, paddingBottom: 26 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  muted: { fontFamily: F.bodyMed, fontSize: 15, color: '#5a7a9a', letterSpacing: 0.6 },

  sectionTitle: { fontFamily: F.heading, fontSize: 18, color: C.deepBlue, letterSpacing: 3, marginBottom: 8 },
  sectionGap: { marginTop: 30 },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(74,158,191,0.2)',
    backgroundColor: C.surface,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  playerRowOn: {
    borderColor: C.deepBlue,
    backgroundColor: 'rgba(74,158,191,0.10)',
    shadowColor: C.deepBlue, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 10,
  },
  check: {
    width: 24, height: 24, borderRadius: 6,
    borderWidth: 1.5, borderColor: '#3a5a7a',
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { borderColor: C.deepBlue, backgroundColor: 'rgba(74,158,191,0.2)' },
  checkMark: { fontFamily: F.heading, fontSize: 15, color: C.deepBlue },
  playerName: { flex: 1, fontFamily: F.heading, fontSize: 17, color: '#7a94ac', letterSpacing: 1, textTransform: 'uppercase' },
  playerNameOn: { color: C.text },

  input: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: C.text,
    backgroundColor: C.surface,
    borderWidth: 1.5,
    borderColor: 'rgba(74,158,191,0.4)',
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingVertical: 20,
  },
  inputMultiline: { minHeight: 140, textAlignVertical: 'top', paddingTop: 20 },

  challengeCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.30)',
    backgroundColor: 'rgba(255,215,0,0.04)',
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  challengeHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  challengeText: { flex: 1, gap: 6 },
  challengeTitle: { fontFamily: F.heading, fontSize: 19, color: C.text, letterSpacing: 1, textTransform: 'uppercase' },
  challengeDesc: { fontFamily: F.bodyMed, fontSize: 14, color: '#7a94ac', letterSpacing: 0.4, lineHeight: 21 },
  tally: { fontFamily: F.heading, fontSize: 15, color: '#FFD700', letterSpacing: 1, marginTop: 2 },
  delBtn: {
    width: 34, height: 34, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,68,68,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  delBtnText: { fontFamily: F.heading, fontSize: 16, color: '#FF4444' },

  // Read-only per-member completion chips under a challenge (admin oversight).
  doneRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
    paddingTop: 14,
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
  doneChipOn: {
    borderColor: '#4CAF50',
    backgroundColor: 'rgba(76,175,80,0.12)',
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

  // ── Raids ──
  raidFormRow: { flexDirection: 'row', gap: 12 },
  raidTargetInput: { flex: 1 },
  raidUnitInput: { flex: 2 },
  raidCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(74,158,191,0.30)',
    backgroundColor: 'rgba(74,158,191,0.05)',
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  raidTallyDone: { color: '#FFD700' },
  raidBarTrack: {
    height: 10, borderRadius: 999, marginTop: 14,
    backgroundColor: 'rgba(74,158,191,0.12)', overflow: 'hidden',
  },
  raidBarFill: {
    height: '100%', borderRadius: 999, backgroundColor: C.deepBlue,
  },
  raidBarFillDone: { backgroundColor: '#FFD700' },

  // ── Streak banner (read-only oversight) ──
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

  // ── Leaderboard (read-only) ──
  lbRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(74,158,191,0.2)',
    backgroundColor: C.surface, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 10,
  },
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
  lbName: { fontFamily: F.heading, fontSize: 16, color: C.text, letterSpacing: 1, textTransform: 'uppercase' },
  lbClass: {
    fontFamily: F.heading, fontSize: 15, color: '#4A9EBF', letterSpacing: 1.2,
    textTransform: 'uppercase', marginTop: 4,
  },
  lbLvl: { fontFamily: F.heading, fontSize: 15, color: '#4A9EBF', letterSpacing: 0.5 },

  // ── Section header row (title + a small ＋ action button) ──
  sectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionTitleFlush: { marginBottom: 0 },

  // ── Read-only member chips ──
  memberRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  memberChip: {
    borderRadius: 999, borderWidth: 1,
    borderColor: 'rgba(74,158,191,0.4)', backgroundColor: 'rgba(74,158,191,0.08)',
    paddingHorizontal: 16, paddingVertical: 8,
  },
  memberChipText: { fontFamily: F.heading, fontSize: 14, color: C.text, letterSpacing: 1 },

  // ── Chat bar (opens the full-screen chat) ──
  chatBar: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(74,158,191,0.35)',
    backgroundColor: 'rgba(74,158,191,0.06)', paddingVertical: 16, paddingHorizontal: 16,
    shadowColor: '#4A9EBF', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.15, shadowRadius: 10,
  },
  chatBarHandle: {
    width: 4, height: 40, borderRadius: 2, backgroundColor: '#4A9EBF',
    shadowColor: '#4A9EBF', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 8,
  },
  chatBarText: { flex: 1, gap: 4 },
  chatBarPreview: { fontFamily: F.bodyMed, fontSize: 15, color: C.text, letterSpacing: 0.2 },
  chatBarSender: { fontFamily: F.heading, fontSize: 14, color: '#4A9EBF', letterSpacing: 0.5 },
  chatBarMeta: { fontFamily: F.bodyMed, fontSize: 12, color: '#5a7a9a', letterSpacing: 0.4 },
  chatBarChevron: { fontFamily: F.heading, fontSize: 28, color: '#4A9EBF', marginTop: -4 },

  // ── Authoring modals ──
  backdrop: {
    flex: 1, backgroundColor: 'rgba(2,6,14,0.82)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  modal: {
    width: '100%', maxWidth: 780, borderRadius: 26, borderWidth: 1.5,
    borderColor: C.deepBlue, backgroundColor: C.bg, paddingVertical: 48, paddingHorizontal: 56,
    shadowColor: C.deepBlue, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 32,
  },
  modalTitle: {
    fontFamily: F.heading, fontSize: 34, color: C.deepBlue, letterSpacing: 5,
    textAlign: 'center', marginBottom: 32,
    textShadowColor: 'rgba(74,158,191,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 22,
  },
  modalHint: {
    fontFamily: F.bodyMed, fontSize: 17, color: '#6a89a8', letterSpacing: 0.4,
    marginBottom: 26, lineHeight: 26,
  },
  modalField: { marginTop: 22 },
  modalActions: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: 18, marginTop: 40,
  },
  memberPicker: { maxHeight: 500 },
});

// Podium palette for the leaderboard's top three — gold, silver, bronze.
const RANK = [
  { color: '#FFD700', glow: '#FFD700', border: 'rgba(255,215,0,0.55)',  bg: 'rgba(255,215,0,0.06)',  badgeBg: 'rgba(255,215,0,0.12)' },  // gold
  { color: '#D6DEE8', glow: '#C7D0DB', border: 'rgba(200,210,225,0.5)', bg: 'rgba(200,210,225,0.05)', badgeBg: 'rgba(200,210,225,0.12)' }, // silver
  { color: '#E0985A', glow: '#CD7F32', border: 'rgba(205,127,50,0.55)', bg: 'rgba(205,127,50,0.06)',  badgeBg: 'rgba(205,127,50,0.14)' },  // bronze
];
