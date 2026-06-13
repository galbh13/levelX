import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, TextInput, Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { israelToday } from '../lib/israelDate';
import { F } from '../constants/fonts';

const SL = {
  bg:     '#050912',
  panel:  '#070d1a',
  border: '#1a3a5c',
  accent: '#4A9EBF',
  text:   '#E8F4FF',
  muted:  '#4a6a8a',
  danger: '#FF4444',
  green:  '#4CAF50',
  gold:   '#FFD700',
};

const TITLE_MAX = 100;

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

  function confirmDelete(quest) {
    Alert.alert(
      'REMOVE DAILY QUEST?',
      `"${quest.title}" will be removed from your list. Past completions are kept.`,
      [
        { text: 'CANCEL', style: 'cancel' },
        {
          text: 'REMOVE',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('daily_quests')
              .update({ active: false })
              .eq('id', quest.id);
            if (error) { alert('Remove failed: ' + error.message); return; }
            await fetchData();
          },
        },
      ]
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{student.full_name?.toUpperCase()}</Text>
        <Text style={styles.subtitle}>DAILY QUESTS</Text>
        <View style={styles.headerDivider} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {loading ? (
          <ActivityIndicator color={SL.accent} style={{ marginTop: 40 }} />
        ) : (
          <>
            <Text style={styles.sectionLabel}>
              TODAY'S STATUS · {israelToday()}
            </Text>

            {quests.length === 0 && (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>NO DAILY QUESTS</Text>
                <Text style={styles.emptySub}>Add one below to start.</Text>
              </View>
            )}

            {quests.map(q => {
              const done = todayDoneIds.has(q.id);
              const isEditing = editingId === q.id;
              return (
                <View
                  key={q.id}
                  style={[styles.questCard, done && styles.questCardDone]}
                >
                  <View style={[styles.statusDot, done && styles.statusDotDone]} />
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
                      <Text style={styles.questTitle}>{q.title}</Text>
                    )}
                    <Text style={[styles.questStatus, done && { color: SL.green }]}>
                      {done ? '✓ DONE TODAY' : '— PENDING'}
                    </Text>
                  </View>

                  {isEditing ? (
                    <>
                      <TouchableOpacity
                        style={styles.iconBtn}
                        onPress={saveEdit}
                      >
                        <Text style={[styles.iconBtnText, { color: SL.green }]}>✓</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.iconBtn}
                        onPress={() => { setEditingId(null); setEditingTitle(''); }}
                      >
                        <Text style={[styles.iconBtnText, { color: SL.muted }]}>✕</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={styles.iconBtn}
                        onPress={() => startEdit(q)}
                      >
                        <Text style={[styles.iconBtnText, { color: SL.accent }]}>✎</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.iconBtn}
                        onPress={() => confirmDelete(q)}
                      >
                        <Text style={[styles.iconBtnText, { color: SL.danger }]}>🗑</Text>
                      </TouchableOpacity>
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
                  placeholder="Quest title (max 100 chars)"
                  placeholderTextColor={SL.muted}
                  value={newTitle}
                  onChangeText={t => setNewTitle(t.slice(0, TITLE_MAX))}
                  maxLength={TITLE_MAX}
                  autoFocus
                />
                <Text style={styles.charCount}>{newTitle.length} / {TITLE_MAX}</Text>
                <View style={styles.addBtnsRow}>
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={() => { setAdding(false); setNewTitle(''); }}
                    disabled={saving}
                  >
                    <Text style={styles.cancelBtnText}>CANCEL</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.saveBtn, (saving || !newTitle.trim()) && { opacity: 0.4 }]}
                    onPress={handleAdd}
                    disabled={saving || !newTitle.trim()}
                  >
                    {saving
                      ? <ActivityIndicator color={SL.bg} size="small" />
                      : <Text style={styles.saveBtnText}>ADD</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.addQuestBtn}
                onPress={() => setAdding(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.addQuestBtnText}>+ ADD DAILY QUEST</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg },

  header: {
    width: '100%',
    maxWidth: 1440,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: SL.border,
  },
  back:     { alignSelf: 'flex-start', marginBottom: 12 },
  backText: { fontFamily: F.bodyMed, color: SL.accent, fontSize: 20, letterSpacing: 2 },
  headerDivider: {
    height: 1,
    backgroundColor: SL.accent,
    opacity: 0.3,
    alignSelf: 'stretch',
    marginTop: 16,
  },
  title: {
    fontFamily: F.heading,
    fontSize: 32,
    color: SL.accent,
    letterSpacing: 4,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.gold,
    letterSpacing: 4,
    marginTop: 6,
  },

  // Cool ice-glow frame wrapping the body, matching the Skills / Workouts pages.
  body: {
    padding: 20,
    gap: 12,
    paddingBottom: 60,
    width: '100%',
    maxWidth: 1440,
    alignSelf: 'center',
    marginTop: 16,
    marginBottom: 28,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 18,
    backgroundColor: SL.bg,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
  },

  sectionLabel: {
    fontFamily: F.bodyMed,
    fontSize: 13,
    color: SL.muted,
    letterSpacing: 2.5,
    marginBottom: 4,
  },

  emptyCard: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 6,
  },
  emptyText: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.muted,
    letterSpacing: 4,
  },
  emptySub: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.muted,
    opacity: 0.7,
  },

  questCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    // Soft ice-glow frame, matching the Home / Skills cards.
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
  },
  questCardDone: { borderColor: SL.green },
  statusDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: SL.muted,
  },
  statusDotDone: {
    backgroundColor: SL.green,
    borderColor: SL.green,
  },
  questTitle: {
    fontFamily: F.bodyMed,
    fontSize: 17,
    color: SL.text,
    letterSpacing: 0.5,
  },
  questStatus: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: SL.muted,
    letterSpacing: 1.5,
    marginTop: 2,
  },

  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: SL.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBtnText: {
    fontFamily: F.heading,
    fontSize: 16,
  },

  editInput: {
    fontFamily: F.bodyMed,
    fontSize: 17,
    color: SL.text,
    backgroundColor: SL.bg,
    borderWidth: 1,
    borderColor: SL.accent,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },

  addBox: {
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 4,
    padding: 14,
    gap: 8,
    marginTop: 4,
  },
  addInput: {
    height: 44,
    backgroundColor: SL.bg,
    borderWidth: 1,
    borderColor: SL.border,
    borderRadius: 4,
    paddingHorizontal: 12,
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.text,
  },
  charCount: {
    fontFamily: F.bodyMed,
    fontSize: 11,
    color: SL.muted,
    letterSpacing: 1,
    textAlign: 'right',
  },
  addBtnsRow: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    flex: 1,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 6,
  },
  cancelBtnText: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.muted,
    letterSpacing: 2,
  },
  saveBtn: {
    flex: 2,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: SL.accent,
    borderRadius: 6,
  },
  saveBtnText: {
    fontFamily: F.heading,
    fontSize: 16,
    color: SL.bg,
    letterSpacing: 3,
  },

  addQuestBtn: {
    marginTop: 4,
    height: 44,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(74,158,191,0.06)',
  },
  addQuestBtnText: {
    fontFamily: F.heading,
    fontSize: 16,
    color: SL.accent,
    letterSpacing: 3,
  },
});
