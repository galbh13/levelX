import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Modal,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useCoach } from '../context/CoachContext';
import { F } from '../constants/fonts';
import { DAY_LABELS } from '../lib/schedule';

const SL = {
  bg:     '#050912',
  panel:  '#070d1a',
  border: '#1a3a5c',
  accent: '#4A9EBF',
  blue:   '#3A6E9E',
  text:   '#E8F4FF',
  muted:  '#4a6a8a',
  danger: '#FF4444',
  gold:   '#FFD700',
};

const DOW_FULL = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];

// ─── Screen ───────────────────────────────────────────────────────────────────
// "Manage My Training" — the recurring WEEKLY SKELETON editor. Assign default
// workout(s) to each weekday (Sun–Sat). No dates, no completion here: those live
// on the dated Workouts screen, which fills each real date from this skeleton and
// lets specific days be overridden. Writes `weekly_workout_template`.

export default function StudentDetailScreen({ navigation }) {
  const { selectedStudent: student, setSelectedDay: setContextDay } = useCoach();

  // Data
  const [templateRows,    setTemplateRows]    = useState([]);  // weekly_workout_template rows
  const [studentWorkouts, setStudentWorkouts] = useState([]);  // all workouts for this player
  const [loading,         setLoading]         = useState(true);

  // Selected weekday (0=Sun … 6=Sat) — default today's weekday.
  const [selectedDow, setSelectedDow] = useState(() => new Date().getDay());

  // Day editor modal
  const [editorVisible,  setEditorVisible]  = useState(false);
  const [editingDow,     setEditingDow]     = useState(null);
  const [pendingWorkout, setPendingWorkout] = useState(undefined);
  const [saving,         setSaving]         = useState(false);

  const workoutsById = useMemo(
    () => Object.fromEntries(studentWorkouts.map(w => [w.id, w])),
    [studentWorkouts]
  );

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!student?.id) return;
    try {
      const [templateRes, workoutsRes] = await Promise.all([
        supabase
          .from('weekly_workout_template')
          .select('id, day_of_week, workout_id')
          .eq('student_id', student.id),

        supabase
          .from('workouts')
          .select('id, title, purpose')
          .eq('assigned_to', student.id)
          .order('title', { ascending: true }),
      ]);

      if (templateRes.error) console.error('[StudentDetail] template:', templateRes.error);
      if (workoutsRes.error) console.error('[StudentDetail] workouts:', workoutsRes.error);

      setTemplateRows(templateRes.data ?? []);
      setStudentWorkouts(workoutsRes.data ?? []);
    } catch (e) {
      console.error('[StudentDetail] fetchData:', e);
    }
  }, [student?.id]);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  // ── Per-weekday template lookup ───────────────────────────────────────────

  function getDowWorkouts(dow) {
    return templateRows
      .filter(t => t.day_of_week === dow)
      .map(t => ({ ...workoutsById[t.workout_id], templateId: t.id }))
      .filter(w => w.id);
  }

  const selectedWorkouts = useMemo(
    () => getDowWorkouts(selectedDow),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedDow, templateRows, workoutsById]
  );

  // ── Add / remove a workout on a weekday ───────────────────────────────────

  async function handleRemoveFromDay(templateId) {
    const { error } = await supabase
      .from('weekly_workout_template')
      .delete()
      .eq('id', templateId);
    if (error) { alert('Error: ' + error.message); return; }
    await fetchData();
  }

  function openEditor(dow) {
    setEditingDow(dow);
    setPendingWorkout(undefined);
    setEditorVisible(true);
  }

  async function saveDay() {
    if (editingDow == null || !pendingWorkout) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('weekly_workout_template')
        .insert({
          student_id:  student.id,
          coach_id:    user.id,
          day_of_week: editingDow,
          workout_id:  pendingWorkout.id,
        });
      if (error) { alert('Save failed: ' + error.message); setSaving(false); return; }
      setEditorVisible(false);
      await fetchData();
    } catch (e) {
      alert('Save failed: ' + (e.message ?? 'Something went wrong.'));
    }
    setSaving(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!student) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', gap: 16 }]}>
        <Text style={{ fontFamily: F.body, color: SL.text, fontSize: 14, letterSpacing: 1 }}>
          No student selected.
        </Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ fontFamily: F.bodyMed, color: SL.accent, fontSize: 13, letterSpacing: 2 }}>← GO BACK</Text>
        </TouchableOpacity>
      </View>
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
        <Text style={styles.level}>WEEKLY PLAN</Text>
        <View style={styles.headerDivider} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* Daily quests */}
        <View style={styles.questRow}>
          <TouchableOpacity
            style={styles.dailyQuestBtn}
            onPress={() => navigation.navigate('DailyQuest', { student })}
            activeOpacity={0.8}
          >
            <Text style={styles.dailyQuestBtnText}>📋 MANAGE DAILY QUESTS</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color={SL.accent} style={{ marginTop: 40 }} />
        ) : (
          <>
            <Text style={styles.skeletonHint}>
              YOUR RECURRING WEEK · repeats every week. Edit specific dates on the Workouts tab.
            </Text>

            {/* Weekday skeleton — SUN…SAT */}
            <View style={styles.weekGrid}>
              {DAY_LABELS.map((label, dow) => {
                const dayWorkouts = getDowWorkouts(dow);
                const isSelected  = dow === selectedDow;
                return (
                  <TouchableOpacity
                    key={label}
                    style={[styles.dayNode, isSelected && styles.dayNodeSelected]}
                    onPress={() => setSelectedDow(dow)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.dayLabel, isSelected && styles.dayLabelSel]}>{label}</Text>
                    {dayWorkouts.length > 0 ? (
                      <>
                        <Text
                          style={[styles.dayWorkoutName, isSelected && styles.dayWorkoutNameSel]}
                          numberOfLines={2}
                        >
                          {dayWorkouts[0].title?.toUpperCase()}
                          {dayWorkouts.length > 1 ? ` +${dayWorkouts.length - 1}` : ''}
                        </Text>
                        <View style={styles.dotsRow}>
                          {dayWorkouts.map((_, di) => (
                            <View key={di} style={styles.dot} />
                          ))}
                        </View>
                      </>
                    ) : (
                      <Text style={styles.dayRest}>REST</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Selected weekday detail */}
            <View style={styles.dayCard}>
              <View style={styles.dayCardHeader}>
                <Text style={styles.dayCardDayName}>{DOW_FULL[selectedDow]}</Text>
                <Text style={styles.dayCardDate}>Every week</Text>
              </View>

              {selectedWorkouts.length > 0 ? (
                selectedWorkouts.map(workout => (
                  <View key={workout.templateId} style={styles.assignedWorkoutCard}>
                    <View style={styles.assignedWorkoutCardHead}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.workoutTitle}>{workout.title?.toUpperCase()}</Text>
                        {workout.purpose ? (
                          <Text style={styles.workoutPurpose}>{workout.purpose}</Text>
                        ) : null}
                      </View>
                      <TouchableOpacity
                        style={styles.workoutRemoveBtn}
                        onPress={() => handleRemoveFromDay(workout.templateId)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={styles.workoutRemoveBtnText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity
                      style={styles.viewBtn}
                      onPress={() => navigation.navigate('WorkoutDetail', { workout })}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.viewBtnText}>VIEW DETAILS</Text>
                    </TouchableOpacity>
                  </View>
                ))
              ) : (
                <View style={styles.restCard}>
                  <Text style={styles.restLabel}>REST DAY</Text>
                  <Text style={styles.restSub}>No workout in the weekly plan yet.</Text>
                </View>
              )}
            </View>

            {/* Bottom actions */}
            <View style={styles.bottomActionsRow}>
              <TouchableOpacity
                style={styles.assignBtn}
                onPress={() => openEditor(selectedDow)}
                activeOpacity={0.8}
              >
                <Text style={styles.assignBtnText}>
                  {selectedWorkouts.length > 0 ? '+ ADD ANOTHER' : '+ ASSIGN WORKOUT'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.newWorkoutBtn}
                onPress={() => {
                  setContextDay({ label: DAY_LABELS[selectedDow], dayOfWeek: selectedDow });
                  navigation.navigate('CreateWorkout');
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.newWorkoutBtnText}>+ CREATE NEW WORKOUT</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.viewAllBtn}
                onPress={() => navigation.navigate('AllWorkouts')}
                activeOpacity={0.8}
              >
                <Text style={styles.viewAllBtnText}>VIEW ALL WORKOUTS</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>

      {/* ── Day Editor Modal ── */}
      <Modal
        visible={editorVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEditorVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.editorBox}>
            <Text style={styles.editorTitle}>
              {editingDow != null ? DOW_FULL[editingDow] : ''} · EVERY WEEK
            </Text>

            {editingDow != null && getDowWorkouts(editingDow).length > 0 && (
              <>
                <Text style={styles.editorSectionLabel}>ALREADY IN PLAN</Text>
                <View style={styles.assignedChips}>
                  {getDowWorkouts(editingDow).map(w => (
                    <View key={w.templateId} style={styles.assignedChip}>
                      <Text style={styles.assignedChipText}>✓ {w.title?.toUpperCase()}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.editorSectionLabel}>ADD WORKOUT</Text>
            <ScrollView style={styles.workoutList} showsVerticalScrollIndicator={false}>
              {studentWorkouts
                .filter(w => editingDow != null
                  ? !getDowWorkouts(editingDow).some(dw => dw.id === w.id)
                  : true
                )
                .map(w => (
                  <TouchableOpacity
                    key={w.id}
                    style={[
                      styles.workoutOption,
                      pendingWorkout?.id === w.id && styles.workoutOptionSelected,
                    ]}
                    onPress={() => setPendingWorkout(w)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[
                        styles.workoutOptionText,
                        pendingWorkout?.id === w.id && styles.workoutOptionTextSelected,
                      ]}>
                        {w.title}
                      </Text>
                      {w.purpose ? (
                        <Text style={styles.workoutOptionSub}>{w.purpose}</Text>
                      ) : null}
                    </View>
                    {pendingWorkout?.id === w.id && <Text style={styles.checkMark}>✓</Text>}
                  </TouchableOpacity>
                ))
              }
              {studentWorkouts.length === 0 && (
                <Text style={styles.noWorkoutsText}>
                  No workouts yet.{'\n'}Use "Create New Workout" first.
                </Text>
              )}
            </ScrollView>

            <View style={styles.editorButtons}>
              <TouchableOpacity
                style={styles.editorCancelBtn}
                onPress={() => setEditorVisible(false)}
                disabled={saving}
              >
                <Text style={styles.editorCancelText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.editorSaveBtn, (saving || !pendingWorkout) && { opacity: 0.4 }]}
                onPress={saveDay}
                disabled={saving || !pendingWorkout}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.editorSaveText}>ADD</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  backText: { fontFamily: F.heading, color: SL.accent, fontSize: 24, letterSpacing: 3, textTransform: 'uppercase' },
  headerDivider: {
    height: 1,
    backgroundColor: SL.accent,
    opacity: 0.3,
    alignSelf: 'stretch',
    marginTop: 16,
  },
  title: {
    fontFamily: F.heading,
    fontSize: 56,
    color: SL.accent,
    letterSpacing: 6,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  level: {
    fontFamily: F.heading,
    fontSize: 28,
    color: SL.text,
    letterSpacing: 4,
    marginTop: 8,
    textAlign: 'center',
  },

  // Centered, capped width — matches the Home page so the two read consistently.
  body: { paddingBottom: 48, width: '100%', maxWidth: 1440, alignSelf: 'center' },

  questRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 14,
    gap: 12,
  },
  dailyQuestBtn: {
    flex: 1,
    height: 60,
    borderWidth: 2,
    borderColor: SL.accent,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(74,158,191,0.08)',
  },
  dailyQuestBtnText: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.accent,
    letterSpacing: 4,
  },

  skeletonHint: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 1,
    textAlign: 'center',
    paddingHorizontal: 16,
    marginTop: 18,
    marginBottom: 12,
    textTransform: 'uppercase',
  },

  // ── Weekday grid ─────────────────────────────────────────────────────────
  weekGrid: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    gap: 4,
  },
  dayNode: {
    flex: 1,
    minHeight: 110,
    backgroundColor: SL.panel,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: SL.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 2,
    gap: 4,
  },
  dayNodeSelected: {
    backgroundColor: '#0a1a2e',
    borderColor: SL.accent,
    borderWidth: 2,
  },
  dayLabel: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  dayLabelSel: { color: SL.accent },
  dayWorkoutName: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.accent,
    letterSpacing: 0.5,
    textAlign: 'center',
    paddingHorizontal: 2,
    textTransform: 'uppercase',
  },
  dayWorkoutNameSel: { color: SL.accent },
  dotsRow: { flexDirection: 'row', gap: 3, marginTop: 1 },
  dot: { width: 5, height: 5, backgroundColor: SL.accent },
  dayRest: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: '#2a4a6a',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  // ── Selected day panel ────────────────────────────────────────────────────
  dayCard: {
    marginHorizontal: 8,
    marginTop: 14,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    padding: 20,
    gap: 12,
  },
  dayCardHeader: { gap: 4 },
  dayCardDayName: {
    fontFamily: F.heading,
    fontSize: 26,
    color: SL.accent,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  dayCardDate: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.muted,
    letterSpacing: 1,
  },
  assignedWorkoutCard: {
    backgroundColor: SL.bg,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    padding: 14,
    gap: 12,
  },
  assignedWorkoutCardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  workoutTitle: {
    fontFamily: F.heading,
    fontSize: 26,
    color: SL.accent,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  workoutPurpose: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.text,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  workoutRemoveBtn: {
    width: 28,
    height: 28,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: SL.danger,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  workoutRemoveBtnText: { fontFamily: F.body, fontSize: 12, color: SL.danger },
  viewBtn: {
    backgroundColor: SL.accent,
    borderRadius: 6,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewBtnText: {
    fontFamily: F.heading,
    fontSize: 20,
    color: SL.bg,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  restCard: { alignItems: 'center', gap: 8, paddingVertical: 16 },
  restLabel: { fontFamily: F.heading, fontSize: 26, color: SL.muted, letterSpacing: 5 },
  restSub:   { fontFamily: F.bodyMed, fontSize: 20, color: SL.muted, letterSpacing: 0.5 },

  bottomActionsRow: {
    flexDirection: 'row',
    marginHorizontal: 8,
    marginTop: 14,
    gap: 10,
  },
  assignBtn: {
    flex: 1,
    height: 64,
    borderWidth: 2,
    borderColor: SL.accent,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(74,158,191,0.1)',
  },
  assignBtnText: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.accent,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  newWorkoutBtn: {
    flex: 1,
    height: 64,
    borderWidth: 2,
    borderColor: SL.accent,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(74,158,191,0.1)',
  },
  newWorkoutBtnText: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.accent,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  viewAllBtn: {
    flex: 1,
    height: 64,
    borderWidth: 2,
    borderColor: SL.accent,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(74,158,191,0.1)',
  },
  viewAllBtnText: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.accent,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    textAlign: 'center',
  },

  // ── Day Editor Modal ──────────────────────────────────────────────────────
  // Centered system-style dialog (not a bottom sheet).
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  // The dialog itself — rounded, with the cool ice-glow frame.
  editorBox: {
    width: '100%',
    maxWidth: 560,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 18,
    padding: 24,
    paddingBottom: 28,
    maxHeight: '85%',
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
  },
  editorTitle: {
    fontFamily: F.heading,
    fontSize: 26,
    color: SL.accent,
    letterSpacing: 4,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 20,
  },
  assignedChips: { gap: 6, marginBottom: 16 },
  assignedChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: SL.accent,
    borderRadius: 4,
    backgroundColor: 'rgba(74,158,191,0.08)',
  },
  assignedChipText: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.accent,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  editorSectionLabel: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  workoutList: { maxHeight: 240, marginBottom: 20 },
  workoutOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: SL.border,
  },
  workoutOptionSelected: {
    backgroundColor: 'rgba(74,158,191,0.08)',
    borderBottomWidth: 0,
    marginBottom: 2,
    borderWidth: 1,
    borderColor: SL.accent,
    borderRadius: 4,
  },
  workoutOptionText: {
    fontFamily: F.bodyMed,
    fontSize: 22,
    color: SL.text,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  workoutOptionTextSelected: { color: SL.accent },
  workoutOptionSub: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  checkMark: { fontFamily: F.bodyMed, fontSize: 22, color: SL.accent, marginLeft: 8 },
  noWorkoutsText: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.muted,
    letterSpacing: 0.5,
    textAlign: 'center',
    marginVertical: 24,
    lineHeight: 28,
  },
  editorButtons: { flexDirection: 'row', gap: 10 },
  editorCancelBtn: {
    flex: 1,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 6,
  },
  editorCancelText: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.muted,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  editorSaveBtn: {
    flex: 2,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: SL.accent,
    borderRadius: 6,
  },
  editorSaveText: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.bg,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },

  // ── Phrase Modal ──────────────────────────────────────────────────────────
  modalBox: {
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    padding: 24,
    gap: 16,
    margin: 24,
  },
  modalTitle: {
    fontFamily: F.heading,
    fontSize: 24,
    color: SL.accent,
    letterSpacing: 3,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  modalButtons: { flexDirection: 'row', gap: 10 },
  modalCancel: {
    flex: 1,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 6,
  },
  modalCancelText: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.muted,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  modalSave: {
    flex: 1,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: SL.accent,
    borderRadius: 6,
  },
  modalSaveText: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.bg,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
});
