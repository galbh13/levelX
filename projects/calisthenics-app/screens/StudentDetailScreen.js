import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Modal, Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useCoach } from '../context/CoachContext';
import { F } from '../constants/fonts';

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

// ─── Date helpers ─────────────────────────────────────────────────────────────

const MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const DAY_LABELS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const TODAY_STR  = (() => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
})();

function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekDays(offset = 0) {
  const today  = new Date();
  const dow    = today.getDay(); // 0=Sun … 6=Sat
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - dow + offset * 7);
  sunday.setHours(0, 0, 0, 0);

  return DAY_LABELS.map((label, i) => {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    const jsDay = d.getDay();
    return {
      label,
      date:      d,
      dateStr:   toDateStr(d),
      dayIndex:  i,
      dayOfWeek: jsDay,
      month:     MONTH_ABBR[d.getMonth()],
    };
  });
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtWeekRange(days) {
  const s = days[0].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const e = days[6].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${s} – ${e}`;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function StudentDetailScreen({ navigation }) {
  const { selectedStudent: student, setSelectedDay: setContextDay } = useCoach();

  // Data
  const [overrideWorkouts,  setOverrideWorkouts]  = useState([]);  // workout_override_workouts rows
  const [studentWorkouts,   setStudentWorkouts]   = useState([]);  // all workouts for this student
  const [pendingCheckup,    setPendingCheckup]    = useState(null);  // upcoming pending checkup
  const [submittedCheckups, setSubmittedCheckups] = useState([]);    // submitted checkups (up to 2)
  const [loading,           setLoading]           = useState(true);

  // Week navigation
  const [weekOffset, setWeekOffset] = useState(0);
  const weekDays = useMemo(() => getWeekDays(weekOffset), [weekOffset]);

  // Calendar selection
  const [selectedDay, setSelectedDay] = useState(
    () => getWeekDays(0).find(d => d.dateStr === TODAY_STR) ?? getWeekDays(0)[0]
  );

  // Day editor modal
  const [editorVisible,  setEditorVisible]  = useState(false);
  const [editingDay,     setEditingDay]     = useState(null);
  const [pendingWorkout, setPendingWorkout] = useState(undefined);  // undefined = nothing picked
  const [saving,         setSaving]         = useState(false);

  // ── Workouts lookup map ────────────────────────────────────────────────────

  const workoutsById = useMemo(
    () => Object.fromEntries(studentWorkouts.map(w => [w.id, w])),
    [studentWorkouts]
  );

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const [overridesRes, workoutsRes, checkupRes, submittedRes] = await Promise.all([
        supabase
          .from('workout_override_workouts')
          .select('id, specific_date, workout_id, completed')
          .eq('student_id', student.id),

        supabase
          .from('workouts')
          .select('id, title, purpose, scheduled_date, completed')
          .eq('assigned_to', student.id)
          .order('title', { ascending: true }),

        supabase
          .from('checkups')
          .select('*')
          .eq('student_id', student.id)
          .eq('status', 'pending')
          .order('scheduled_date', { ascending: true })
          .limit(1)
          .maybeSingle(),

        supabase
          .from('checkups')
          .select('id, status, scheduled_date, is_read')
          .eq('student_id', student.id)
          .eq('status', 'submitted')
          .order('created_at', { ascending: true })
          .limit(2),
      ]);

      if (overridesRes.error) console.error('[StudentDetail] overrides:', overridesRes.error);
      if (workoutsRes.error)  console.error('[StudentDetail] workouts:', workoutsRes.error);

      setOverrideWorkouts(overridesRes.data ?? []);
      setStudentWorkouts(workoutsRes.data ?? []);
      setPendingCheckup(checkupRes.data ?? null);
      setSubmittedCheckups(submittedRes.data ?? []);
    } catch (e) {
      console.error('[StudentDetail] fetchData:', e);
    }
  }, [student.id]);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  // ── Day workout lookup (returns array) ────────────────────────────────────

  function getDayWorkouts(day) {
    // Source 1: override junction rows for this specific date
    const dayOverrides = overrideWorkouts.filter(o => o.specific_date === day.dateStr);
    const overrideResults = dayOverrides
      .map(o => ({ ...workoutsById[o.workout_id], overrideId: o.id, completed: o.completed ?? false }))
      .filter(o => o.id);

    // Source 2: legacy direct workouts (scheduled_date) — for any old rows
    const directWorkouts = studentWorkouts.filter(w => w.scheduled_date === day.dateStr);

    // Merge, no duplicates
    const result = [...overrideResults];
    for (const w of directWorkouts) {
      if (!result.some(r => r.id === w.id)) result.push(w);
    }
    return result;
  }

  const selectedDayWorkouts = useMemo(
    () => getDayWorkouts(selectedDay),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedDay, overrideWorkouts, workoutsById]
  );

  // ── Remove a specific workout from a day ──────────────────────────────────

  async function handleRemoveWorkoutFromDay(day, workoutId) {
    // Case 1: assigned via junction table → delete junction row only
    const overrideRow = overrideWorkouts.find(
      o => o.specific_date === day.dateStr && o.workout_id === workoutId
    );
    if (overrideRow) {
      const { error } = await supabase
        .from('workout_override_workouts')
        .delete()
        .eq('id', overrideRow.id);
      if (error) { alert('Error: ' + error.message); return; }
      await fetchData();
      return;
    }

    // Case 2: legacy direct workout (scheduled_date) → warn and delete
    Alert.alert(
      'DELETE WORKOUT?',
      'This will permanently delete the workout and all its exercises.',
      [
        { text: 'CANCEL', style: 'cancel' },
        {
          text: 'DELETE',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('workouts')
              .delete()
              .eq('id', workoutId);
            if (error) { alert('Error: ' + error.message); return; }
            await fetchData();
          },
        },
      ]
    );
  }

  // ── Day editor modal ──────────────────────────────────────────────────────

  function openEditor(day) {
    setEditingDay(day);
    setPendingWorkout(undefined);
    setEditorVisible(true);
  }

  async function saveDay() {
    if (!editingDay || !pendingWorkout) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('workout_override_workouts')
        .insert({
          student_id:    student.id,
          coach_id:      user.id,
          specific_date: editingDay.dateStr,
          workout_id:    pendingWorkout.id,
        });
      if (error) { alert('Save failed: ' + error.message); setSaving(false); return; }
      setEditorVisible(false);
      await fetchData();
    } catch (e) {
      alert('Save failed: ' + (e.message ?? 'Something went wrong.'));
    }
    setSaving(false);
  }

  // ── Toggle is_read on a submitted checkup ────────────────────────────────

  async function handleToggleRead(checkup) {
    const newVal = !checkup.is_read;
    setSubmittedCheckups(prev => prev.map(c => c.id === checkup.id ? { ...c, is_read: newVal } : c));
    const { error } = await supabase
      .from('checkups')
      .update({ is_read: newVal })
      .eq('id', checkup.id);
    if (error) {
      setSubmittedCheckups(prev => prev.map(c => c.id === checkup.id ? { ...c, is_read: !newVal } : c));
      alert('Failed to update: ' + error.message);
    }
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
        <Text style={styles.level}>LVL {student.level ?? '—'}</Text>
        <View style={styles.headerDivider} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* Checkup row */}
        <View style={styles.checkupRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.checkupLabel}>NEXT CHECKUP</Text>
            <Text style={styles.checkupValue}>
              {pendingCheckup ? formatDisplayDate(pendingCheckup.scheduled_date) : 'None scheduled'}
            </Text>
          </View>
          <View style={styles.checkupBtns}>
            {pendingCheckup && (
              <TouchableOpacity
                style={styles.editBtn}
                onPress={() => navigation.navigate('CheckupBuilder', { student, existingCheckup: pendingCheckup })}
              >
                <Text style={styles.editBtnText}>EDIT</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.newCheckupBtn}
              onPress={() => navigation.navigate('CheckupBuilder', { student })}
            >
              <Text style={styles.newCheckupBtnText}>+ NEW</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Submitted checkups with read toggle */}
        {submittedCheckups.map((sc, i) => (
          <View key={sc.id} style={styles.submittedCheckupRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.checkupLabel}>SUBMITTED CHECKUP {submittedCheckups.length > 1 ? i + 1 : ''}</Text>
              <Text style={styles.checkupValue}>{formatDisplayDate(sc.scheduled_date)}</Text>
            </View>
            <View style={styles.checkupBtns}>
              <TouchableOpacity
                style={styles.viewSubmissionBtn}
                onPress={() => navigation.navigate('CheckupReview', { student, checkupId: sc.id })}
              >
                <Text style={styles.viewSubmissionBtnText}>📋 VIEW</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.readToggleBtn, sc.is_read && styles.readToggleBtnRead]}
                onPress={() => handleToggleRead(sc)}
                activeOpacity={0.8}
              >
                <Text style={[styles.readToggleBtnText, sc.is_read && styles.readToggleBtnTextRead]}>
                  {sc.is_read ? '👁 UNREAD' : '👁 READ'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {/* Class & Quests button */}
        <TouchableOpacity
          style={styles.classQuestBtn}
          onPress={() => navigation.navigate('ClassQuest', { student })}
          activeOpacity={0.8}
        >
          <Text style={styles.classQuestBtnText}>⚡ CLASS & QUESTS</Text>
        </TouchableOpacity>

        {/* Calendar */}
        {loading ? (
          <ActivityIndicator color={SL.accent} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Week nav */}
            <View style={styles.calendarNav}>
              <TouchableOpacity
                style={styles.navArrow}
                onPress={() => setWeekOffset(o => o - 1)}
              >
                <Text style={styles.navArrowText}>←</Text>
              </TouchableOpacity>
              <View style={styles.navCenter}>
                {weekOffset === 0 && (
                  <Text style={styles.navCurrentBadge}>THIS WEEK</Text>
                )}
                <Text style={styles.navRangeText}>{fmtWeekRange(weekDays)}</Text>
              </View>
              <TouchableOpacity
                style={styles.navArrow}
                onPress={() => setWeekOffset(o => o + 1)}
              >
                <Text style={styles.navArrowText}>→</Text>
              </TouchableOpacity>
            </View>

            {/* Day nodes — full width grid */}
            <View style={styles.calendarGrid}>
              {weekDays.map((day) => {
                const dayWorkouts = getDayWorkouts(day);
                const isSelected  = day.dateStr === selectedDay?.dateStr;
                const isToday     = day.dateStr === TODAY_STR;

                return (
                  <TouchableOpacity
                    key={day.dateStr}
                    style={[
                      styles.dayNode,
                      isSelected && styles.dayNodeSelected,
                      isToday && !isSelected && styles.dayNodeToday,
                    ]}
                    onPress={() => setSelectedDay(day)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.dayLabel, isSelected && styles.dayLabelSel]}>
                      {day.label}
                    </Text>
                    <Text style={[styles.dayNum, isSelected && styles.dayNumSel]}>
                      {day.date.getDate()}
                    </Text>
                    <Text style={[styles.dayMonth, isSelected && styles.dayMonthSel]}>
                      {day.month}
                    </Text>
                    {dayWorkouts.length > 0 ? (
                      <>
                        <Text
                          style={[styles.dayWorkoutName, isSelected && styles.dayWorkoutNameSel]}
                          numberOfLines={1}
                        >
                          {dayWorkouts[0].title?.toUpperCase()}
                          {dayWorkouts.length > 1 ? ` +${dayWorkouts.length - 1}` : ''}
                        </Text>
                        <View style={styles.dotsRow}>
                          {dayWorkouts.map((_, di) => (
                            <View key={di} style={[styles.dot, isSelected && styles.dotSel]} />
                          ))}
                        </View>
                      </>
                    ) : (
                      <Text style={[styles.dayRest, isSelected && styles.dayRestSel]}>
                        REST
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Selected day detail panel */}
            <View style={styles.dayCard}>
              <View style={styles.dayCardHeader}>
                <Text style={styles.dayCardDayName}>{selectedDay?.label}</Text>
                <Text style={styles.dayCardDate}>{formatDisplayDate(selectedDay?.dateStr)}</Text>
              </View>

              {selectedDayWorkouts.length > 0 ? (
                <>
                  {selectedDayWorkouts.map(workout => (
                    <View key={workout.id} style={[styles.assignedWorkoutCard, workout.completed && { borderLeftWidth: 3, borderLeftColor: '#4CAF50' }]}>
                      <View style={styles.assignedWorkoutCardHead}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.workoutTitle}>{workout.title?.toUpperCase()}</Text>
                          {workout.purpose ? (
                            <Text style={styles.workoutPurpose}>{workout.purpose}</Text>
                          ) : null}
                        </View>
                        {workout.overrideId != null && (
                          workout.completed ? (
                            <View style={styles.completedBadge}>
                              <Text style={styles.completedBadgeText}>✓ DONE</Text>
                            </View>
                          ) : (
                            <View style={styles.pendingBadge}>
                              <Text style={styles.pendingBadgeText}>⏳ PENDING</Text>
                            </View>
                          )
                        )}
                        <TouchableOpacity
                          style={styles.workoutRemoveBtn}
                          onPress={() => handleRemoveWorkoutFromDay(selectedDay, workout.id)}
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
                  ))}

                  <TouchableOpacity
                    style={styles.addAnotherBtn}
                    onPress={() => openEditor(selectedDay)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.addAnotherBtnText}>+ ADD ANOTHER WORKOUT</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={styles.restCard}>
                    <Text style={styles.restLabel}>REST DAY</Text>
                    <Text style={styles.restSub}>No workout assigned yet.</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.addAnotherBtn}
                    onPress={() => openEditor(selectedDay)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.addAnotherBtnText}>+ ASSIGN WORKOUT</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* Create new workout */}
            <TouchableOpacity
              style={styles.newWorkoutBtn}
              onPress={() => {
                setContextDay({ label: selectedDay.label, dateStr: selectedDay.dateStr });
                navigation.navigate('CreateWorkout');
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.newWorkoutBtnText}>+ Create New Workout</Text>
            </TouchableOpacity>

            {/* View all workouts */}
            <TouchableOpacity
              style={styles.viewAllBtn}
              onPress={() => navigation.navigate('AllWorkouts')}
              activeOpacity={0.8}
            >
              <Text style={styles.viewAllBtnText}>View All Workouts</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {/* ── Day Editor Modal ── */}
      <Modal
        visible={editorVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditorVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.editorBox}>
            {/* Title */}
            <Text style={styles.editorTitle}>
              {editingDay?.label} · {formatDisplayDate(editingDay?.dateStr)}
            </Text>

            {/* Currently assigned workouts (read-only) */}
            {editingDay && getDayWorkouts(editingDay).length > 0 && (
              <>
                <Text style={styles.editorSectionLabel}>ALREADY ASSIGNED</Text>
                <View style={styles.assignedChips}>
                  {getDayWorkouts(editingDay).map(w => (
                    <View key={w.id} style={styles.assignedChip}>
                      <Text style={styles.assignedChipText}>✓ {w.title?.toUpperCase()}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {/* Workout picker — excludes already-assigned workouts */}
            <Text style={styles.editorSectionLabel}>ADD WORKOUT</Text>
            <ScrollView style={styles.workoutList} showsVerticalScrollIndicator={false}>
              {studentWorkouts
                .filter(w => editingDay
                  ? !getDayWorkouts(editingDay).some(dw => dw.id === w.id)
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
                    {pendingWorkout?.id === w.id && (
                      <Text style={styles.checkMark}>✓</Text>
                    )}
                  </TouchableOpacity>
                ))
              }
              {studentWorkouts.length === 0 && (
                <Text style={styles.noWorkoutsText}>
                  No workouts created for this student yet.{'\n'}Use "Create New Workout" first.
                </Text>
              )}
            </ScrollView>

            {/* Actions */}
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
    fontSize: 40,
    color: SL.accent,
    letterSpacing: 4,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  level: {
    fontFamily: F.bodyMed,
    fontSize: 24,
    color: SL.text,
    letterSpacing: 3,
    marginTop: 6,
    textAlign: 'center',
  },

  body: { paddingBottom: 48 },

  checkupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: SL.border,
    gap: 12,
  },
  checkupLabel: {
    fontFamily: F.bodyMed,
    fontSize: 11,
    color: SL.muted,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  checkupValue: {
    fontFamily: F.heading,
    fontSize: 20,
    color: SL.accent,
    letterSpacing: 1,
  },
  checkupBtns: { flexDirection: 'row', gap: 8 },
  viewSubmissionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 6,
  },
  viewSubmissionBtnText: { fontFamily: F.bodyMed, fontSize: 14, color: SL.accent, letterSpacing: 2 },
  editBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: SL.muted,
    borderRadius: 6,
  },
  editBtnText: { fontFamily: F.bodyMed, fontSize: 14, color: SL.muted, letterSpacing: 2 },
  newCheckupBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 6,
  },
  newCheckupBtnText: { fontFamily: F.bodyMed, fontSize: 14, color: SL.accent, letterSpacing: 2 },
  submittedCheckupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: SL.border,
    gap: 12,
  },
  readToggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: SL.muted,
    borderRadius: 6,
  },
  readToggleBtnRead: {
    borderColor: SL.gold,
  },
  readToggleBtnText: {
    fontFamily: F.bodyMed,
    fontSize: 13,
    color: SL.muted,
    letterSpacing: 1.5,
  },
  readToggleBtnTextRead: {
    color: SL.gold,
  },

  classQuestBtn: {
    marginHorizontal: 20,
    marginVertical: 12,
    height: 44,
    borderWidth: 1.5,
    borderColor: '#FFD700',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,215,0,0.05)',
  },
  classQuestBtnText: {
    fontFamily: F.heading,
    fontSize: 16,
    color: '#FFD700',
    letterSpacing: 3,
  },

  // ── Week nav ──────────────────────────────────────────────────────────────

  calendarNav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 18,
    paddingBottom: 12,
  },
  navArrow: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: SL.border,
    backgroundColor: SL.panel,
  },
  navArrowText: { fontFamily: F.heading, fontSize: 22, color: SL.accent },
  navCenter: { flex: 1, alignItems: 'center', gap: 3 },
  navCurrentBadge: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.accent,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  navRangeText: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 0.5,
  },

  // ── Calendar grid ─────────────────────────────────────────────────────────

  calendarGrid: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    gap: 4,
  },
  dayNode: {
    flex: 1,
    minHeight: 120,
    backgroundColor: SL.panel,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: SL.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 2,
    gap: 2,
  },
  dayNodeSelected: {
    backgroundColor: '#0a1a2e',
    borderColor: SL.accent,
    borderWidth: 2,
  },
  dayNodeToday: {
    borderColor: SL.text,
    borderWidth: 1.5,
  },

  dayLabel: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  dayLabelSel: { color: SL.accent },

  dayNum: {
    fontFamily: F.heading,
    fontSize: 28,
    color: SL.text,
    lineHeight: 32,
  },
  dayNumSel: { color: SL.text },

  dayMonth: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.muted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  dayMonthSel: { color: SL.muted },

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

  dotsRow: {
    flexDirection: 'row',
    gap: 3,
    marginTop: 1,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 0,
    backgroundColor: SL.accent,
  },
  dotSel: { backgroundColor: SL.accent },

  dayRest: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: '#2a4a6a',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  dayRestSel: { color: SL.muted },

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

  // Assigned workout card
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
  workoutRemoveBtnText: {
    fontFamily: F.body,
    fontSize: 12,
    color: SL.danger,
  },
  completedBadge: {
    backgroundColor: 'rgba(76,175,80,0.15)',
    borderWidth: 1,
    borderColor: '#4CAF50',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  completedBadgeText: {
    fontFamily: F.heading,
    fontSize: 12,
    color: '#4CAF50',
    letterSpacing: 2,
  },
  pendingBadge: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#1a3a5c',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pendingBadgeText: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: '#4a6a8a',
    letterSpacing: 2,
  },

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

  // + ADD ANOTHER / + ASSIGN WORKOUT button
  addAnotherBtn: {
    height: 40,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(74,158,191,0.06)',
  },
  addAnotherBtnText: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.accent,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  restCard: { alignItems: 'center', gap: 8, paddingVertical: 16 },
  restLabel: { fontFamily: F.heading, fontSize: 26, color: SL.muted, letterSpacing: 5 },
  restSub:   { fontFamily: F.bodyMed, fontSize: 20, color: SL.muted, letterSpacing: 0.5 },

  newWorkoutBtn: {
    marginHorizontal: 8,
    marginTop: 12,
    height: 36,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  newWorkoutBtnText: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.accent,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },

  viewAllBtn: {
    marginHorizontal: 8,
    marginTop: 8,
    height: 36,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(74,158,191,0.06)',
  },
  viewAllBtnText: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.accent,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },

  // ── Day Editor Modal ──────────────────────────────────────────────────────

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  editorBox: {
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '85%',
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

  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  toggleBtn: {
    flex: 1,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 6,
    alignItems: 'center',
  },
  toggleBtnActive: { backgroundColor: 'rgba(74,158,191,0.15)', borderColor: SL.accent },
  toggleBtnText: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  toggleBtnTextActive: { color: SL.accent },
  toggleHint: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 20,
  },

  // Assigned chips (read-only list in modal)
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
  checkMark: {
    fontFamily: F.bodyMed,
    fontSize: 22,
    color: SL.accent,
    marginLeft: 8,
  },
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

  // ── Checkup Modal ─────────────────────────────────────────────────────────

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
  modalInput: {
    height: 48,
    backgroundColor: SL.bg,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 6,
    paddingHorizontal: 16,
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.text,
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
