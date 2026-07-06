import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable,
  ActivityIndicator, TextInput, Alert, Animated, KeyboardAvoidingView, Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { israelToday } from '../lib/israelDate';
import { F } from '../constants/fonts';
import { ShimmerText, ShimmerFrame, ShimmerFill, BLUE, GOLD } from '../components/Shimmer';

const SL = {
  bg:     '#050912',
  panel:  '#0a1322',
  panel2: '#08101e',
  border: '#1a3a5c',
  accent: '#4A9EBF',
  text:   '#E8F4FF',
  muted:  '#4a6a8a',
  danger: '#FF4444',
  green:  '#4CAF50',
  gold:   '#FFD700',
};

const TITLE_MAX = 100;

// Compact glyph button used inside quest rows — a simple, neutral monochrome
// tile. No colour; meaning is carried by the glyph alone.
function IconBtn({ glyph, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={styles.iconBtn}
    >
      <Text style={styles.iconGlyph}>{glyph}</Text>
    </TouchableOpacity>
  );
}

export default function CoachDailyQuestScreen({ route, navigation }) {
  const { student } = route.params;

  const [quests,        setQuests]        = useState([]);
  const [todayDoneIds,  setTodayDoneIds]  = useState(new Set());
  const [loading,       setLoading]       = useState(true);

  // Add form
  const [adding,        setAdding]        = useState(false);
  const [newTitle,      setNewTitle]      = useState('');
  const [saving,        setSaving]        = useState(false);

  // Edit state
  const [editingId,     setEditingId]     = useState(null);
  const [editingTitle,  setEditingTitle]  = useState('');

  // Pop-in entrance
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, {
      toValue: 1, useNativeDriver: true, friction: 7, tension: 80,
    }).start();
  }, [anim]);

  function dismiss() { navigation.goBack(); }

  const fetchData = useCallback(async () => {
    try {
      const today = israelToday();
      const [questRes, doneRes] = await Promise.all([
        supabase
          .from('daily_quests')
          .select('id, title, created_at')
          .eq('student_id', student.id)
          .eq('active', true)
          .order('created_at', { ascending: true }),
        supabase
          .from('daily_quest_completions')
          .select('daily_quest_id')
          .eq('student_id', student.id)
          .eq('completion_date', today),
      ]);

      if (questRes.error) console.error('[CoachDailyQuest] quests:', questRes.error);
      if (doneRes.error)  console.error('[CoachDailyQuest] done:', doneRes.error);

      setQuests(questRes.data ?? []);
      setTodayDoneIds(new Set((doneRes.data ?? []).map(r => r.daily_quest_id)));
    } catch (e) {
      console.error('[CoachDailyQuest] fetchData:', e);
    }
    setLoading(false);
  }, [student.id]);

  useFocusEffect(useCallback(() => { setLoading(true); fetchData(); }, [fetchData]));

  async function handleAdd() {
    const title = newTitle.trim();
    if (!title) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('daily_quests')
        .insert({ student_id: student.id, coach_id: user.id, title });
      if (error) { alert('Add failed: ' + error.message); setSaving(false); return; }
      setNewTitle('');
      setAdding(false);
      await fetchData();
    } catch (e) {
      alert('Add failed: ' + (e.message ?? 'Something went wrong.'));
    }
    setSaving(false);
  }

  function startEdit(quest) {
    setEditingId(quest.id);
    setEditingTitle(quest.title);
  }

  async function saveEdit() {
    const title = editingTitle.trim();
    if (!title || !editingId) { setEditingId(null); return; }
    const { error } = await supabase
      .from('daily_quests')
      .update({ title })
      .eq('id', editingId);
    if (error) { alert('Edit failed: ' + error.message); return; }
    setEditingId(null);
    setEditingTitle('');
    await fetchData();
  }

  async function removeQuest(quest) {
    const { error } = await supabase
      .from('daily_quests')
      .update({ active: false })
      .eq('id', quest.id);
    if (error) { alert('Remove failed: ' + error.message); return; }
    await fetchData();
  }

  function confirmDelete(quest) {
    const message = `"${quest.title}" will be removed from your list. Past completions are kept.`;
    // Alert.alert is native-only; on web (RN Web) it's a no-op, so the button
    // appeared dead. Fall back to window.confirm there.
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(message)) removeQuest(quest);
      return;
    }
    Alert.alert(
      'REMOVE DAILY QUEST?',
      message,
      [
        { text: 'CANCEL', style: 'cancel' },
        { text: 'REMOVE', style: 'destructive', onPress: () => removeQuest(quest) },
      ]
    );
  }

  const total     = quests.length;
  const doneCount = quests.reduce((n, q) => n + (todayDoneIds.has(q.id) ? 1 : 0), 0);
  const allDone   = total > 0 && doneCount === total;
  const pct       = total ? doneCount / total : 0;
  const barColors = allDone ? GOLD : BLUE;

  return (
    <KeyboardAvoidingView
      style={styles.overlay}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Dim, tap-to-dismiss backdrop */}
      <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />

      <Animated.View
        style={[
          styles.frameOuter,
          allDone && styles.frameOuterDone,
          {
            opacity: anim,
            transform: [
              { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
              { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) },
            ],
          },
        ]}
      >
        <View style={styles.contentClip}>
          {/* drag handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>DAILY QUESTS</Text>
          </View>

          {/* Body */}
          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={SL.accent} size="large" />
            </View>
          ) : (
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {total === 0 && (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyGlyph}>⚡</Text>
                  <Text style={styles.emptyText}>NO DAILY QUESTS</Text>
                  <Text style={styles.emptySub}>Forge your first one below.</Text>
                </View>
              )}

              {quests.map(q => {
                const done = todayDoneIds.has(q.id);
                const isEditing = editingId === q.id;
                return (
                  <View key={q.id} style={[styles.questRow, done && styles.questRowDone]}>
                    {/* cleared = a "charged cell": ice-energy washes through the
                        card interior; pending = a static ice stripe */}
                    {done ? (
                      <ShimmerFill style={styles.questWash} colors={BLUE} duration={3400} active />
                    ) : (
                      <View style={styles.accentBar} />
                    )}

                    {/* check badge */}
                    <View style={[styles.dot, done && styles.dotDone]}>
                      {done && <Text style={styles.dotCheck}>✓</Text>}
                    </View>

                    <View style={{ flex: 1 }}>
                      {isEditing ? (
                        <TextInput
                          style={styles.editInput}
                          value={editingTitle}
                          onChangeText={t => setEditingTitle(t.slice(0, TITLE_MAX))}
                          maxLength={TITLE_MAX}
                          autoFocus
                        />
                      ) : (
                        <Text style={[styles.questTitle, done && styles.questTitleDone]} numberOfLines={2}>
                          {q.title}
                        </Text>
                      )}
                    </View>

                    {isEditing ? (
                      <>
                        <IconBtn glyph="✓" tone="green" onPress={saveEdit} />
                        <IconBtn glyph="✕" tone="muted" onPress={() => { setEditingId(null); setEditingTitle(''); }} />
                      </>
                    ) : (
                      <>
                        <IconBtn glyph="✎" tone="accent" onPress={() => startEdit(q)} />
                        <IconBtn glyph="✕" tone="danger" onPress={() => confirmDelete(q)} />
                      </>
                    )}
                  </View>
                );
              })}

              {/* Add form */}
              {adding ? (
                <View style={styles.addBox}>
                  <TextInput
                    style={styles.addInput}
                    placeholder="New quest title…"
                    placeholderTextColor={SL.muted}
                    value={newTitle}
                    onChangeText={t => setNewTitle(t.slice(0, TITLE_MAX))}
                    maxLength={TITLE_MAX}
                    autoFocus
                  />
                  <View style={styles.addBtnsRow}>
                    <Text style={styles.charCount}>{newTitle.length}/{TITLE_MAX}</Text>
                    <View style={{ flex: 1 }} />
                    <TouchableOpacity
                      onPress={() => { setAdding(false); setNewTitle(''); }}
                      disabled={saving}
                      activeOpacity={0.7}
                      style={[styles.miniBtn, styles.miniBtnMuted]}
                    >
                      <Text style={[styles.miniBtnText, { color: SL.muted }]}>CANCEL</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleAdd}
                      disabled={saving || !newTitle.trim()}
                      activeOpacity={0.85}
                      style={[styles.miniBtn, styles.miniBtnSolid, (saving || !newTitle.trim()) && { opacity: 0.4 }]}
                    >
                      {saving
                        ? <ActivityIndicator color={SL.bg} size="small" />
                        : <Text style={[styles.miniBtnText, { color: SL.bg }]}>ADD</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => setAdding(true)}
                  activeOpacity={0.85}
                  style={styles.addCta}
                >
                  <Text style={styles.addCtaText}>+ ADD DAILY QUEST</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          )}
        </View>

        {/* Live ice-glow border */}
        <ShimmerFrame
          style={styles.border}
          colors={barColors}
          radius={24}
          thickness={2.5}
          duration={4200}
          active
        />
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(2,5,12,0.84)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },

  // Outer box holds the rounded content-clip + the non-clipped shimmer border.
  frameOuter: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '92%',
    borderRadius: 24,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 30,
    elevation: 26,
  },
  frameOuterDone: { shadowColor: SL.gold },
  contentClip: {
    width: '100%',
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: SL.panel,
    paddingHorizontal: 26,
    paddingTop: 16,
    paddingBottom: 24,
  },
  border: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
  },

  handle: {
    alignSelf: 'center',
    width: 48, height: 4, borderRadius: 2,
    backgroundColor: SL.border,
    marginBottom: 14,
  },

  header: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 16,
  },
  emblem: {
    width: 58, height: 58, borderRadius: 18,
    borderWidth: 1.5, borderColor: SL.accent,
    backgroundColor: 'rgba(74,158,191,0.12)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6, shadowRadius: 14,
  },
  emblemDone: { borderColor: SL.gold, backgroundColor: 'rgba(255,215,0,0.14)', shadowColor: SL.gold },
  // faint inner ring that frames the glyph
  emblemRing: {
    position: 'absolute',
    width: 40, height: 40, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(74,158,191,0.4)',
    transform: [{ rotate: '45deg' }],
  },
  emblemRingDone: { borderColor: 'rgba(255,215,0,0.45)' },
  emblemGlyph: { fontSize: 26, color: SL.accent },
  title: {
    fontFamily: F.heading,
    fontSize: 30,
    color: '#FFFFFF',
    letterSpacing: 4.5,
    textAlign: 'center',
  },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17,
    borderWidth: 1, borderColor: SL.border,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: SL.panel2,
  },
  closeGlyph: { color: SL.muted, fontSize: 15, fontFamily: F.body, marginTop: -1 },

  meterBlock: {
    borderWidth: 1,
    borderColor: 'rgba(26,58,92,0.7)',
    backgroundColor: 'rgba(8,16,30,0.6)',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 16,
    marginBottom: 14,
    gap: 13,
  },
  meterBlockDone: {
    borderColor: 'rgba(255,215,0,0.4)',
    backgroundColor: 'rgba(255,215,0,0.05)',
  },
  meterTop: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  dateLabel: {
    fontFamily: F.bodyMed,
    fontSize: 17,
    color: SL.muted,
    letterSpacing: 2.5,
  },
  progressText: {
    fontFamily: F.heading,
    letterSpacing: 1.5,
  },
  progressNum: { fontSize: 36 },
  progressSep: { fontSize: 24, color: SL.muted },
  meterTrack: {
    height: 16,
    borderRadius: 999,
    backgroundColor: '#0c1726',
    borderWidth: 1,
    borderColor: 'rgba(26,58,92,0.7)',
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    borderRadius: 999,
  },
  meterCaption: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
  },

  loadingBox: { paddingVertical: 64, alignItems: 'center' },

  list: { flexGrow: 0 },
  listContent: { paddingVertical: 4, gap: 10 },

  emptyCard: { alignItems: 'center', paddingVertical: 34, gap: 6 },
  emptyGlyph: { fontSize: 34, color: SL.muted, marginBottom: 2 },
  emptyText: { fontFamily: F.heading, fontSize: 18, color: SL.muted, letterSpacing: 3 },
  emptySub: { fontFamily: F.bodyMed, fontSize: 13, color: SL.muted, opacity: 0.7 },

  questRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: SL.panel2,
    borderWidth: 1,
    borderColor: SL.border,
    borderRadius: 16,
    paddingVertical: 20,
    paddingLeft: 24,
    paddingRight: 16,
    overflow: 'hidden',
  },
  questRowDone: {
    borderColor: SL.accent,              // steady bright ice edge
    backgroundColor: 'rgba(74,158,191,0.06)',
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 16,
    elevation: 10,
  },
  // pending-only left vertical accent stripe
  accentBar: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: 5,
    backgroundColor: SL.accent,
  },
  // cleared-cell energy wash: ice gradient flows across the card interior
  questWash: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
    opacity: 0.16,
  },
  dot: {
    width: 26, height: 26, borderRadius: 13,
    borderWidth: 2, borderColor: SL.muted, backgroundColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  dotDone: {
    backgroundColor: SL.accent, borderColor: '#9fdcf2',
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1, shadowRadius: 9,
  },
  dotCheck: { color: SL.bg, fontSize: 14, fontFamily: F.heading, marginTop: -1 },
  questTitle: {
    fontFamily: F.body,
    fontSize: 21,
    color: SL.text,
    letterSpacing: 0.3,
  },
  questTitleDone: {
    color: '#eaf8ff',
    textShadowColor: 'rgba(90,200,250,0.65)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },

  iconBtn: {
    width: 40, height: 40, borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(232,244,255,0.16)',
    backgroundColor: 'rgba(232,244,255,0.04)',
    alignItems: 'center', justifyContent: 'center',
  },
  iconGlyph: {
    fontSize: 17,
    fontFamily: F.body,
    color: 'rgba(232,244,255,0.72)',
    marginTop: -1,
    lineHeight: 20,
  },

  editInput: {
    fontFamily: F.body,
    fontSize: 15,
    color: SL.text,
    backgroundColor: SL.bg,
    borderWidth: 1,
    borderColor: SL.accent,
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },

  addBox: {
    backgroundColor: SL.panel2,
    borderWidth: 1,
    borderColor: SL.accent,
    borderRadius: 15,
    padding: 13,
    gap: 11,
    marginTop: 2,
  },
  addInput: {
    height: 44,
    backgroundColor: SL.bg,
    borderWidth: 1,
    borderColor: SL.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontFamily: F.body,
    fontSize: 15,
    color: SL.text,
  },
  addBtnsRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  charCount: { fontFamily: F.bodyMed, fontSize: 10.5, color: SL.muted, letterSpacing: 1 },
  miniBtn: {
    paddingHorizontal: 18, height: 36, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
    minWidth: 70,
  },
  miniBtnMuted: { borderWidth: 1, borderColor: SL.border, backgroundColor: 'transparent' },
  miniBtnSolid: {
    backgroundColor: SL.accent,
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6, shadowRadius: 10,
  },
  miniBtnText: { fontFamily: F.heading, fontSize: 13, letterSpacing: 2 },

  addCta: {
    marginTop: 6,
    alignSelf: 'center',
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: SL.accent,
    backgroundColor: 'rgba(74,158,191,0.16)',
    paddingVertical: 14,
    paddingHorizontal: 34,
    alignItems: 'center',
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  addCtaText: {
    fontFamily: F.heading,
    fontSize: 14,
    color: SL.text,
    letterSpacing: 2.5,
  },
});
