import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { computeLvl } from '../lib/computeLvl';
import { materializeDay, isDateOverridden } from '../lib/schedule';
import { F } from '../constants/fonts';

// ─── Theme ────────────────────────────────────────────────────────────────────

const SL = {
  bg:    '#050912',
  panel: '#070d1a',
  border:'#1a3a5c',
  accent:'#4A9EBF',
  text:  '#E8F4FF',
  muted: '#4a6a8a',
  green: '#4CAF50',
  gold:  '#FFD700',
};

// ─── Date helpers ─────────────────────────────────────────────────────────────

const MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const DAY_LABELS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

function toDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

const TODAY_STR = toDateStr(new Date());

function getWeekDays(offset = 0) {
  const today  = new Date();
  const dow    = today.getDay();
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - dow + offset * 7);
  sunday.setHours(0, 0, 0, 0);

  return DAY_LABELS.map((label, i) => {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    return {
      label,
      date:    d,
      dateStr: toDateStr(d),
      month:   MONTH_ABBR[d.getMonth()],
    };
  });
}

function fmtWeekRange(days) {
  const s = days[0].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const e = days[6].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${s} – ${e}`;
}

function fmtDisplayDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function isLocked(dateStr) {
  if (!dateStr) return false;
  const workoutDate = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((today - workoutDate) / (1000 * 60 * 60 * 24));
  return diffDays >= 7;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function WorkoutsScreen({ navigation }) {
  const [profile,               setProfile]               = useState(null);
  const [className,             setClassName]             = useState(null);
  const [workoutsById,          setWorkoutsById]          = useState({});
  const [allWorkouts,           setAllWorkouts]           = useState([]);   // for the edit picker
  const [overrideWorkouts,      setOverrideWorkouts]      = useState([]);
  const [templateRows,          setTemplateRows]          = useState([]);   // weekly skeleton
  const [lvl,                   setLvl]                   = useState(0);
  const [loading,               setLoading]               = useState(true);
  const [refreshing,            setRefreshing]            = useState(false);

  // Per-date edit modal
  const [editVisible,    setEditVisible]    = useState(false);
  const [editPending,    setEditPending]    = useState(undefined);
  const [editSaving,     setEditSaving]     = useState(false);

  const [weekOffset, setWeekOffset] = useState(0);
  const weekDays = useMemo(() => getWeekDays(weekOffset), [weekOffset]);

  const [selectedDay, setSelectedDay] = useState(
    () => getWeekDays(0).find(d => d.dateStr === TODAY_STR) ?? getWeekDays(0)[0]
  );

  const [marking, setMarking] = useState({});

  // ── Fetch week data ────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [profileRes, overridesRes, templateRes, workoutsRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('full_name, class_id')
          .eq('id', user.id)
          .single(),

        supabase
          .from('workout_override_workouts')
          .select('id, specific_date, workout_id, completed, coach_feedback, feedback_is_read')
          .eq('student_id', user.id),

        supabase
          .from('weekly_workout_template')
          .select('id, day_of_week, workout_id')
          .eq('student_id', user.id),

        supabase
          .from('workouts')
          .select('id, title, purpose, scheduled_date')
          .eq('assigned_to', user.id)
          .order('title', { ascending: true }),
      ]);

      if (profileRes.data) {
        setProfile(profileRes.data);
        if (profileRes.data.class_id) {
          const [{ data: classData }, lvlVal] = await Promise.all([
            supabase
              .from('classes')
              .select('name')
              .eq('id', profileRes.data.class_id)
              .maybeSingle(),
            computeLvl(user.id, profileRes.data.class_id),
          ]);
          setClassName(classData?.name ?? null);
          setLvl(lvlVal ?? 0);
        } else {
          setLvl(0);
        }
      }
      const workouts = workoutsRes.data ?? [];
      setAllWorkouts(workouts);
      setWorkoutsById(Object.fromEntries(workouts.map(w => [w.id, w])));
      setOverrideWorkouts(overridesRes.data ?? []);
      setTemplateRows(templateRes.data ?? []);
    } catch (e) {
      console.error('[WorkoutsScreen] fetchData:', e);
    }
  }, [weekOffset]);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  // ── Day workout lookup ─────────────────────────────────────────────────────

  function getDayWorkouts(day) {
    const dayOverrides = overrideWorkouts.filter(o => o.specific_date === day.dateStr);
    if (dayOverrides.length > 0) {
      // Per-date override wins for this date (this is how a single day is edited).
      return dayOverrides
        .map(o => {
          const w = workoutsById[o.workout_id];
          if (!w) return null;
          return {
            id:             w.id,
            title:          w.title,
            purpose:        w.purpose,
            scheduled_date: w.scheduled_date,
            overrideId:     o.id,
            completed:      o.completed ?? false,
            specific_date:  o.specific_date,
            coachFeedback:  o.coach_feedback ?? null,
            feedbackIsRead: o.feedback_is_read ?? false,
            fromTemplate:   false,
          };
        })
        .filter(Boolean);
    }
    // Otherwise fall back to the recurring weekly skeleton for this weekday.
    const dow = day.date.getDay();
    return templateRows
      .filter(t => t.day_of_week === dow)
      .map(t => {
        const w = workoutsById[t.workout_id];
        if (!w) return null;
        return {
          id:             w.id,
          title:          w.title,
          purpose:        w.purpose,
          scheduled_date: w.scheduled_date,
          overrideId:     null,
          completed:      false,
          specific_date:  day.dateStr,
          coachFeedback:  null,
          feedbackIsRead: false,
          fromTemplate:   true,
        };
      })
      .filter(Boolean);
  }

  const selectedDayWorkouts = useMemo(
    () => getDayWorkouts(selectedDay),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedDay, overrideWorkouts, templateRows, workoutsById]
  );

  // ── Mark a workout as done ─────────────────────────────────────────────────

  const mkKey = (w) => w.overrideId ?? `t:${w.id}`;

  // Ensure a date has its own override rows (copying the weekday's skeleton in the
  // first time it's touched), so completion / edits can attach to that date.
  async function ensureMaterialized(dateStr) {
    if (isDateOverridden(dateStr, overrideWorkouts)) return;
    const { data: { user } } = await supabase.auth.getUser();
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    const ids = templateRows.filter(t => t.day_of_week === dow).map(t => t.workout_id);
    await materializeDay({ studentId: user.id, coachId: user.id, dateStr, templateWorkoutIds: ids });
  }

  async function handleMarkDone(workout) {
    setMarking(prev => ({ ...prev, [mkKey(workout)]: true }));
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (workout.overrideId) {
        const { error } = await supabase
          .from('workout_override_workouts')
          .update({ completed: true })
          .eq('id', workout.overrideId);
        if (error) { alert('Could not mark as done: ' + error.message); }
      } else {
        // Template-derived day — materialize it, then complete this workout.
        await ensureMaterialized(workout.specific_date);
        const { error } = await supabase
          .from('workout_override_workouts')
          .update({ completed: true })
          .eq('student_id', user.id)
          .eq('specific_date', workout.specific_date)
          .eq('workout_id', workout.id);
        if (error) { alert('Could not mark as done: ' + error.message); }
      }
      await fetchData();
    } catch {
      alert('Something went wrong.');
    }
    setMarking(prev => ({ ...prev, [mkKey(workout)]: false }));
  }

  async function handleUndoDone(workout) {
    setMarking(prev => ({ ...prev, [mkKey(workout)]: true }));
    try {
      const { error } = await supabase
        .from('workout_override_workouts')
        .update({ completed: false })
        .eq('id', workout.overrideId);
      if (!error) {
        setOverrideWorkouts(prev =>
          prev.map(o => o.id === workout.overrideId ? { ...o, completed: false } : o)
        );
      } else {
        alert('Could not undo: ' + error.message);
      }
    } catch {
      alert('Something went wrong.');
    }
    setMarking(prev => ({ ...prev, [mkKey(workout)]: false }));
  }

  // ── Per-date editing (override the weekly skeleton for one date) ────────────

  async function addWorkoutToDate(dateStr, workoutId) {
    setEditSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await ensureMaterialized(dateStr);  // copy skeleton first so siblings are kept
      const { error } = await supabase
        .from('workout_override_workouts')
        .insert({ student_id: user.id, coach_id: user.id, specific_date: dateStr, workout_id: workoutId });
      if (error) alert('Error: ' + error.message);
      setEditPending(undefined);
      await fetchData();
    } catch (e) {
      alert('Error: ' + (e.message ?? 'Something went wrong.'));
    }
    setEditSaving(false);
  }

  async function removeWorkoutFromDate(day, workout) {
    const { data: { user } } = await supabase.auth.getUser();
    // Template-derived day: materialize first so removing one keeps the others.
    if (!workout.overrideId) await ensureMaterialized(day.dateStr);
    const { error } = await supabase
      .from('workout_override_workouts')
      .delete()
      .eq('student_id', user.id)
      .eq('specific_date', day.dateStr)
      .eq('workout_id', workout.id);
    if (error) alert('Error: ' + error.message);
    await fetchData();
  }

  // Drop all per-date overrides for a date → it falls back to the weekly skeleton.
  async function resetDayToPlan(dateStr) {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('workout_override_workouts')
      .delete()
      .eq('student_id', user.id)
      .eq('specific_date', dateStr);
    if (error) alert('Error: ' + error.message);
    setEditVisible(false);
    await fetchData();
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={SL.accent} />
      </View>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.body}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={SL.accent} />}
    >
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.studentName}>
          {profile?.full_name?.toUpperCase() ?? '—'}
        </Text>
        <Text style={styles.level}>LVL {lvl ?? '—'}</Text>
        {className && (
          <Text style={styles.className}>{className.toUpperCase()}</Text>
        )}
        <View style={styles.headerDivider} />
      </View>

      {/* ── Manage training (self-coach) ── */}
      <TouchableOpacity
        style={styles.manageBanner}
        onPress={() => navigation.navigate('Manage')}
        activeOpacity={0.85}
      >
        <Text style={styles.manageBannerText}>⚙ MANAGE MY TRAINING</Text>
        <Text style={styles.manageBannerArrow}>→</Text>
      </TouchableOpacity>

      {/* ── Week nav ── */}
      <View style={styles.calendarNav}>
        <TouchableOpacity style={styles.navArrow} onPress={() => setWeekOffset(o => o - 1)}>
          <Text style={styles.navArrowText}>←</Text>
        </TouchableOpacity>
        <View style={styles.navCenter}>
          {weekOffset === 0 && <Text style={styles.navBadge}>THIS WEEK</Text>}
          <Text style={styles.navRange}>{fmtWeekRange(weekDays)}</Text>
        </View>
        <TouchableOpacity style={styles.navArrow} onPress={() => setWeekOffset(o => o + 1)}>
          <Text style={styles.navArrowText}>→</Text>
        </TouchableOpacity>
      </View>

      {/* ── Calendar grid ── */}
      <View style={styles.calendarGrid}>
        {weekDays.map(day => {
          const dayWorkouts = getDayWorkouts(day);
          const isSelected  = day.dateStr === selectedDay?.dateStr;
          const isToday     = day.dateStr === TODAY_STR;
          const allDone     = dayWorkouts.length > 0 && dayWorkouts.every(w => w.completed);

          return (
            <TouchableOpacity
              key={day.dateStr}
              style={[
                styles.dayNode,
                isToday && !isSelected && styles.dayNodeToday,
                isSelected && styles.dayNodeSelected,
              ]}
              onPress={() => setSelectedDay(day)}
              activeOpacity={0.75}
            >
              <Text style={[styles.dayLabel, (isSelected || isToday) && styles.dayLabelSel]}>
                {day.label}
              </Text>
              <Text style={[styles.dayNum, (isSelected || isToday) && styles.dayNumActive]}>
                {day.date.getDate()}
              </Text>
              <Text style={styles.dayMonth}>{day.month}</Text>

              {dayWorkouts.length > 0 ? (
                <View style={styles.dayStatus}>
                  <Text
                    style={[styles.dayWorkoutName, allDone && { color: SL.green }]}
                    numberOfLines={2}
                  >
                    {dayWorkouts[0].title?.toUpperCase()}
                    {dayWorkouts.length > 1 ? ` +${dayWorkouts.length - 1}` : ''}
                  </Text>
                  {allDone && <Text style={styles.dayCheck}>✓ DONE</Text>}
                </View>
              ) : (
                <Text style={styles.dayRest}>REST</Text>
              )}

              {isToday && <View style={styles.todayBar} />}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Day detail panel ── */}
      <View style={styles.dayCard}>
        <View style={styles.dayCardHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.dayCardName}>{selectedDay?.label}</Text>
            <Text style={styles.dayCardDate}>{fmtDisplayDate(selectedDay?.dateStr)}</Text>
            <Text style={styles.daySourceHint}>
              {isDateOverridden(selectedDay?.dateStr, overrideWorkouts) ? 'CUSTOM FOR THIS DATE' : 'FROM WEEKLY PLAN'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.editDayBtn}
            onPress={() => { setEditPending(undefined); setEditVisible(true); }}
            activeOpacity={0.8}
          >
            <Text style={styles.editDayBtnText}>✎ EDIT DAY</Text>
          </TouchableOpacity>
        </View>

        {selectedDayWorkouts.length > 0 ? (
          selectedDayWorkouts.map(workout => {
            const isMarking = !!marking[mkKey(workout)];
            const locked    = isLocked(workout.specific_date);
            const hasUnreadFeedback = workout.coachFeedback && !workout.feedbackIsRead;

            return (
              <View key={workout.id} style={styles.workoutCard}>
                <View style={styles.workoutInfo}>
                  <View style={styles.workoutTitleRow}>
                    <Text style={styles.workoutTitle} numberOfLines={1}>{workout.title?.toUpperCase()}</Text>
                    {hasUnreadFeedback && <View style={styles.feedbackDot} />}
                  </View>
                  {workout.purpose ? (
                    <Text style={styles.workoutPurpose} numberOfLines={1}>{workout.purpose}</Text>
                  ) : null}
                  {locked && (
                    <View style={styles.lockedBadge}>
                      <Text style={styles.lockedBadgeText}>🔒 LOCKED (7+ DAYS OLD)</Text>
                    </View>
                  )}
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.viewBtn}
                    onPress={() => navigation.navigate('WorkoutDetail', {
                      workout,
                      studentView: true,
                    })}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.viewBtnText}>VIEW</Text>
                  </TouchableOpacity>

                  {workout.completed ? (
                    <>
                      <View style={styles.doneTag}>
                        <Text style={styles.doneTagText}>✓ DONE</Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.undoBtn, locked && { opacity: 0.4 }]}
                        onPress={locked ? undefined : () => handleUndoDone(workout)}
                        disabled={isMarking || locked}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.undoBtnText}>UNDO</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity
                      style={[styles.markDoneBtn, (isMarking || locked) && { opacity: locked ? 0.4 : 0.6 }]}
                      onPress={locked ? undefined : () => handleMarkDone(workout)}
                      disabled={isMarking || locked}
                      activeOpacity={0.8}
                    >
                      {isMarking
                        ? <ActivityIndicator color={SL.bg} size="small" />
                        : <Text style={styles.markDoneBtnText}>MARK DONE</Text>
                      }
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })
        ) : (
          <View style={styles.restCard}>
            <Text style={styles.restLabel}>REST DAY</Text>
            <Text style={styles.restSub}>Recovery is part of the program.</Text>
          </View>
        )}
      </View>

      <View style={{ height: 32 }} />

      {/* ── Per-date edit modal ── */}
      <Modal
        visible={editVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.editorBox}>
            <Text style={styles.editorTitle}>
              EDIT · {fmtDisplayDate(selectedDay?.dateStr)}
            </Text>
            <Text style={styles.editorSub}>
              Changes here only affect this date. Reset to fall back to your weekly plan.
            </Text>

            {/* Current workouts for this date */}
            {selectedDayWorkouts.length > 0 && (
              <>
                <Text style={styles.editorSectionLabel}>ON THIS DAY</Text>
                <View style={styles.assignedChips}>
                  {selectedDayWorkouts.map(w => (
                    <View key={w.id} style={styles.assignedChip}>
                      <Text style={styles.assignedChipText}>{w.title?.toUpperCase()}</Text>
                      <TouchableOpacity
                        onPress={() => removeWorkoutFromDate(selectedDay, w)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={styles.assignedChipRemove}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </>
            )}

            {/* Workout picker — excludes already-present */}
            <Text style={styles.editorSectionLabel}>ADD WORKOUT</Text>
            <ScrollView style={styles.workoutList} showsVerticalScrollIndicator={false}>
              {allWorkouts
                .filter(w => !selectedDayWorkouts.some(dw => dw.id === w.id))
                .map(w => (
                  <TouchableOpacity
                    key={w.id}
                    style={[styles.workoutOption, editPending?.id === w.id && styles.workoutOptionSelected]}
                    onPress={() => setEditPending(w)}
                  >
                    <Text style={[styles.workoutOptionText, editPending?.id === w.id && { color: SL.accent }]}>
                      {w.title}
                    </Text>
                    {editPending?.id === w.id && <Text style={styles.checkMark}>✓</Text>}
                  </TouchableOpacity>
                ))}
              {allWorkouts.length === 0 && (
                <Text style={styles.noWorkoutsText}>No workouts yet. Create one from Manage My Training.</Text>
              )}
            </ScrollView>

            <View style={styles.editorButtons}>
              <TouchableOpacity
                style={styles.editorCancelBtn}
                onPress={() => setEditVisible(false)}
                disabled={editSaving}
              >
                <Text style={styles.editorCancelText}>CLOSE</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.editorSaveBtn, (editSaving || !editPending) && { opacity: 0.4 }]}
                onPress={() => editPending && addWorkoutToDate(selectedDay.dateStr, editPending.id)}
                disabled={editSaving || !editPending}
              >
                {editSaving
                  ? <ActivityIndicator color={SL.bg} size="small" />
                  : <Text style={styles.editorSaveText}>ADD</Text>}
              </TouchableOpacity>
            </View>

            {isDateOverridden(selectedDay?.dateStr, overrideWorkouts) && (
              <TouchableOpacity
                style={styles.resetBtn}
                onPress={() => resetDayToPlan(selectedDay.dateStr)}
                disabled={editSaving}
              >
                <Text style={styles.resetBtnText}>↺ RESET TO WEEKLY PLAN</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg },
  // Centered, capped width — matches the Home page so the two read consistently.
  body: { paddingBottom: 56, width: '100%', maxWidth: 1440, alignSelf: 'center' },

  // ── Header ──────────────────────────────────────────────────────────────────

  header: {
    paddingHorizontal: 20,
    paddingTop: 64,
    paddingBottom: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: SL.border,
  },
  studentName: {
    fontFamily: F.heading,
    fontSize: 42,
    color: SL.accent,
    letterSpacing: 4,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  level: {
    fontFamily: F.body,
    fontSize: 28,
    color: SL.text,
    letterSpacing: 3,
    marginTop: 6,
  },
  className: {
    fontFamily: F.bodyMed,
    fontSize: 22,
    color: SL.gold,
    letterSpacing: 3,
    marginTop: 4,
    textAlign: 'center',
  },
  headerDivider: {
    height: 2,
    backgroundColor: SL.accent,
    opacity: 0.4,
    alignSelf: 'stretch',
    marginTop: 16,
    borderRadius: 1,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
  },

  // ── Manage banner ─────────────────────────────────────────────────────────────

  manageBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 10,
    backgroundColor: 'rgba(74,158,191,0.08)',
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
  },
  manageBannerText: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.accent,
    letterSpacing: 2.5,
  },
  manageBannerArrow: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.accent,
  },

  // ── Checkup banner ──────────────────────────────────────────────────────────

  checkupBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 6,
    backgroundColor: 'rgba(74,158,191,0.08)',
  },
  checkupBannerText: {
    fontFamily: F.heading,
    fontSize: 20,
    color: SL.accent,
    letterSpacing: 2,
  },
  checkupBannerDate: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.accent,
    letterSpacing: 1,
  },

  coachResponseBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 6,
    backgroundColor: 'rgba(74,158,191,0.08)',
  },
  coachResponseBannerText: {
    fontFamily: F.heading,
    fontSize: 20,
    letterSpacing: 2,
  },
  newBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: SL.gold,
    borderRadius: 3,
  },
  newBadgeText: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.bg,
    letterSpacing: 1,
  },
  responseReadToggleText: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    letterSpacing: 1.5,
  },

  // ── Week nav ────────────────────────────────────────────────────────────────

  calendarNav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 16,
    paddingBottom: 10,
  },
  navArrow: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: SL.accent,
    backgroundColor: 'rgba(74,158,191,0.06)',
  },
  navArrowText: { fontFamily: F.heading, fontSize: 26, color: SL.accent },
  navCenter:    { flex: 1, alignItems: 'center', gap: 2 },
  navBadge: {
    fontFamily: F.body,
    fontSize: 18,
    color: SL.accent,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  navRange: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.muted,
    letterSpacing: 0.5,
  },

  // ── Calendar grid ────────────────────────────────────────────────────────────

  calendarGrid: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    gap: 6,
  },
  dayNode: {
    flex: 1,
    minHeight: 124,
    backgroundColor: SL.panel,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: SL.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    gap: 3,
    overflow: 'hidden',
  },
  dayNodeToday: { borderColor: SL.accent },
  dayNodeSelected: {
    backgroundColor: '#0a1a2e',
    borderColor: SL.accent,
    borderWidth: 2,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
  },
  dayLabel: {
    fontFamily: F.body,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  dayLabelSel: { color: SL.accent },
  dayNum: {
    fontFamily: F.heading,
    fontSize: 34,
    color: SL.text,
    lineHeight: 38,
  },
  dayNumActive: { color: SL.accent },
  dayMonth: {
    fontFamily: F.bodyMed,
    fontSize: 15,
    color: SL.muted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  dayStatus: { alignItems: 'center', gap: 2, marginTop: 2 },
  dayWorkoutName: {
    fontFamily: F.bodyMed,
    fontSize: 15,
    color: SL.accent,
    letterSpacing: 0.3,
    textAlign: 'center',
    paddingHorizontal: 2,
    textTransform: 'uppercase',
  },
  dayCheck: {
    fontFamily: F.heading,
    fontSize: 13,
    color: SL.green,
    letterSpacing: 1,
  },
  dayRest: {
    fontFamily: F.bodyMed,
    fontSize: 15,
    color: '#2a4a6a',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  todayBar: {
    position: 'absolute',
    bottom: 0,
    left: 12,
    right: 12,
    height: 3,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    backgroundColor: SL.accent,
  },

  // ── Stats row ────────────────────────────────────────────────────────────────

  // ── Day detail panel ──────────────────────────────────────────────────────────

  dayCard: {
    marginHorizontal: 8,
    marginTop: 14,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 12,
    padding: 20,
    gap: 12,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
  },
  dayCardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  dayCardName: {
    fontFamily: F.heading,
    fontSize: 26,
    color: SL.accent,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  dayCardDate: {
    fontFamily: F.bodyMed,
    fontSize: 22,
    color: SL.muted,
    letterSpacing: 0.5,
  },
  daySourceHint: {
    alignSelf: 'flex-start',
    fontFamily: F.bodyMed,
    fontSize: 13,
    color: SL.muted,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 8,
    borderWidth: 1,
    borderColor: SL.border,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  editDayBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 6,
    backgroundColor: 'rgba(74,158,191,0.08)',
  },
  editDayBtnText: {
    fontFamily: F.heading,
    fontSize: 16,
    color: SL.accent,
    letterSpacing: 1.5,
  },

  // ── Per-date edit modal ───────────────────────────────────────────────────
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
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
    fontSize: 24,
    color: SL.accent,
    letterSpacing: 3,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  editorSub: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 0.5,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 18,
  },
  editorSectionLabel: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  assignedChips: { gap: 6, marginBottom: 16 },
  assignedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  assignedChipRemove: { fontFamily: F.body, fontSize: 16, color: SL.muted, paddingLeft: 12 },
  workoutList: { maxHeight: 220, marginBottom: 20 },
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
    borderWidth: 1,
    borderColor: SL.accent,
    borderRadius: 4,
  },
  workoutOptionText: {
    flex: 1,
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.text,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  checkMark: { fontFamily: F.bodyMed, fontSize: 20, color: SL.accent, marginLeft: 8 },
  noWorkoutsText: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 0.5,
    textAlign: 'center',
    marginVertical: 20,
    lineHeight: 26,
  },
  editorButtons: { flexDirection: 'row', gap: 10 },
  editorCancelBtn: {
    flex: 1,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 6,
  },
  editorCancelText: {
    fontFamily: F.bodyMed,
    fontSize: 18,
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
    fontSize: 20,
    color: SL.bg,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  resetBtn: {
    marginTop: 14,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: SL.muted,
    borderRadius: 6,
  },
  resetBtnText: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  workoutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SL.bg,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderLeftWidth: 4,
    borderLeftColor: SL.accent,
    borderRadius: 8,
    padding: 16,
    gap: 14,
  },
  workoutInfo: { flex: 1, gap: 4 },
  workoutTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  workoutTitle: {
    fontFamily: F.heading,
    fontSize: 24,
    color: SL.accent,
    letterSpacing: 2,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  feedbackDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: SL.gold,
    flexShrink: 0,
  },
  workoutPurpose: {
    fontFamily: F.body,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 0.5,
  },

  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  viewBtn: {
    height: 44,
    paddingHorizontal: 20,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(74,158,191,0.06)',
  },
  viewBtnText: {
    fontFamily: F.heading,
    fontSize: 17,
    color: SL.accent,
    letterSpacing: 2,
  },
  markDoneBtn: {
    height: 44,
    paddingHorizontal: 24,
    backgroundColor: SL.accent,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
  },
  markDoneBtnText: {
    fontFamily: F.heading,
    fontSize: 17,
    color: SL.bg,
    letterSpacing: 2,
  },
  doneTag: {
    height: 44,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: SL.green,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(76,175,80,0.08)',
  },
  doneTagText: {
    fontFamily: F.body,
    fontSize: 16,
    color: SL.green,
    letterSpacing: 2,
  },
  undoBtn: {
    height: 44,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: SL.muted,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  undoBtnText: {
    fontFamily: F.body,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 2,
  },

  lockedBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: SL.muted,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  lockedBadgeText: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.muted,
    letterSpacing: 1.5,
  },

  restCard: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 24,
  },
  restLabel: {
    fontFamily: F.heading,
    fontSize: 28,
    color: SL.muted,
    letterSpacing: 5,
  },
  restSub: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
});
