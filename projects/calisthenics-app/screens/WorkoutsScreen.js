import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { computeLvl } from '../lib/computeLvl';
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
  const [overrideWorkouts,      setOverrideWorkouts]      = useState([]);
  const [latestCheckup,         setLatestCheckup]         = useState(null);
  const [coachResponseCheckup,  setCoachResponseCheckup]  = useState(null);
  const [coachResponseIsRead,   setCoachResponseIsRead]   = useState(true);
  const [lvl,                   setLvl]                   = useState(0);
  const [expTotal,              setExpTotal]              = useState(0);
  const [guidingPhrase,         setGuidingPhrase]         = useState(null);
  const [loading,               setLoading]               = useState(true);
  const [refreshing,            setRefreshing]            = useState(false);

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

      const [profileRes, overridesRes, checkupRes, coachResponseRes, expRes, dqExpRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('full_name, class_id, guiding_phrase')
          .eq('id', user.id)
          .single(),

        supabase
          .from('workout_override_workouts')
          .select('id, specific_date, workout_id, completed, coach_feedback, feedback_is_read, workouts(id, title, purpose, scheduled_date)')
          .eq('student_id', user.id),

        supabase
          .from('checkups')
          .select('*')
          .eq('student_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),

        supabase
          .from('checkups')
          .select('id, scheduled_date, coach_response, responded_at, response_is_read')
          .eq('student_id', user.id)
          .not('coach_response', 'is', null)
          .order('responded_at', { ascending: false })
          .limit(1)
          .maybeSingle(),

        supabase
          .from('workout_override_workouts')
          .select('*', { count: 'exact', head: true })
          .eq('student_id', user.id)
          .eq('completed', true),

        supabase
          .from('daily_quest_completions')
          .select('*', { count: 'exact', head: true })
          .eq('student_id', user.id),
      ]);

      if (profileRes.data) {
        setProfile(profileRes.data);
        setGuidingPhrase(profileRes.data.guiding_phrase ?? null);
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
      const overrides = overridesRes.data ?? [];
      setOverrideWorkouts(overrides);
      const wById = {};
      for (const o of overrides) {
        if (o.workouts && o.workout_id) wById[o.workout_id] = o.workouts;
      }
      setWorkoutsById(wById);
      setLatestCheckup(checkupRes.data ?? null);
      setCoachResponseCheckup(coachResponseRes.data ?? null);
      setCoachResponseIsRead(coachResponseRes.data?.response_is_read ?? true);
      setExpTotal((expRes.count ?? 0) * 5 + (dqExpRes.count ?? 0));
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
        };
      })
      .filter(Boolean);
  }

  const selectedDayWorkouts = useMemo(
    () => getDayWorkouts(selectedDay),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedDay, overrideWorkouts, workoutsById]
  );

  // ── Mark a workout as done ─────────────────────────────────────────────────

  async function handleMarkDone(workout) {
    setMarking(prev => ({ ...prev, [workout.overrideId]: true }));
    try {
      const { error } = await supabase
        .from('workout_override_workouts')
        .update({ completed: true })
        .eq('id', workout.overrideId);
      if (!error) {
        setOverrideWorkouts(prev =>
          prev.map(o => o.id === workout.overrideId ? { ...o, completed: true } : o)
        );
        setExpTotal(prev => prev + 5);
      } else {
        alert('Could not mark as done: ' + error.message);
      }
    } catch {
      alert('Something went wrong.');
    }
    setMarking(prev => ({ ...prev, [workout.overrideId]: false }));
  }

  async function handleUndoDone(workout) {
    setMarking(prev => ({ ...prev, [workout.overrideId]: true }));
    try {
      const { error } = await supabase
        .from('workout_override_workouts')
        .update({ completed: false })
        .eq('id', workout.overrideId);
      if (!error) {
        setOverrideWorkouts(prev =>
          prev.map(o => o.id === workout.overrideId ? { ...o, completed: false } : o)
        );
        setExpTotal(prev => Math.max(0, prev - 5));
      } else {
        alert('Could not undo: ' + error.message);
      }
    } catch {
      alert('Something went wrong.');
    }
    setMarking(prev => ({ ...prev, [workout.overrideId]: false }));
  }

  // ── Toggle coach response read state ──────────────────────────────────────

  async function handleToggleResponseRead() {
    if (!coachResponseCheckup) return;
    const newVal = !coachResponseIsRead;
    setCoachResponseIsRead(newVal);
    const { error } = await supabase
      .from('checkups')
      .update({ response_is_read: newVal })
      .eq('id', coachResponseCheckup.id);
    if (error) {
      setCoachResponseIsRead(!newVal);
      alert('Failed to update: ' + error.message);
    }
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  const nextOverride = [...overrideWorkouts]
    .filter(o => o.specific_date >= TODAY_STR && !o.completed)
    .sort((a, b) => a.specific_date.localeCompare(b.specific_date))[0];
  const nextWorkout = nextOverride ? workoutsById[nextOverride.workout_id] : null;

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

      {/* ── Checkup banner ── */}
      {latestCheckup && (
        <TouchableOpacity
          style={styles.checkupBanner}
          onPress={() => navigation.navigate('Checkup', { checkup: latestCheckup })}
          activeOpacity={0.8}
        >
          <Text style={styles.checkupBannerText}>📋 MY CHECKUP</Text>
          <Text style={styles.checkupBannerDate}>{latestCheckup.scheduled_date} →</Text>
        </TouchableOpacity>
      )}

      {/* ── Coach response banner ── */}
      {coachResponseCheckup && (
        <View style={[
          styles.coachResponseBanner,
          { borderColor: coachResponseIsRead ? SL.accent : SL.gold,
            backgroundColor: coachResponseIsRead ? 'rgba(74,158,191,0.08)' : 'rgba(255,215,0,0.06)' },
        ]}>
          <TouchableOpacity
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}
            onPress={() => navigation.navigate('CoachResponse', { checkup: coachResponseCheckup })}
            activeOpacity={0.8}
          >
            <Text style={[
              styles.coachResponseBannerText,
              { color: coachResponseIsRead ? SL.accent : SL.gold },
            ]}>💬 LATEST COACH FEEDBACK</Text>
            {!coachResponseIsRead && (
              <View style={styles.newBadge}>
                <Text style={styles.newBadgeText}>NEW</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleToggleResponseRead}
            activeOpacity={0.8}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={[
              styles.responseReadToggleText,
              { color: coachResponseIsRead ? SL.muted : SL.gold },
            ]}>
              {coachResponseIsRead ? '👁 UNREAD' : '👁 READ'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

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
              <Text style={[styles.dayLabel, isSelected && styles.dayLabelSel]}>
                {day.label}
              </Text>
              <Text style={styles.dayNum}>{day.date.getDate()}</Text>
              <Text style={styles.dayMonth}>{day.month}</Text>

              {dayWorkouts.length > 0 ? (
                <>
                  {allDone ? (
                    <Text style={styles.dayCheck}>✓</Text>
                  ) : (
                    <View style={styles.dotsRow}>
                      {dayWorkouts.map((_, di) => (
                        <View key={di} style={styles.dot} />
                      ))}
                    </View>
                  )}
                  <Text style={styles.dayWorkoutName} numberOfLines={1}>
                    {dayWorkouts[0].title?.toUpperCase()}
                    {dayWorkouts.length > 1 ? ` +${dayWorkouts.length - 1}` : ''}
                  </Text>
                </>
              ) : (
                <Text style={styles.dayRest}>REST</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Stats row ── */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text
            style={[styles.statValue, { fontSize: 16 }, !nextWorkout && { color: SL.muted }]}
            numberOfLines={1}
          >
            {nextWorkout?.title?.toUpperCase() ?? 'REST'}
          </Text>
          <Text style={styles.statLabel}>NEXT UP</Text>
        </View>

        <View style={styles.statCard}>
          <Text style={styles.statValue}>{expTotal}</Text>
          <Text style={styles.statLabel}>EXP</Text>
        </View>

        <View style={styles.statCard}>
          <Text
            style={[
              styles.statValue,
              { fontSize: 14 },
              !guidingPhrase && { color: SL.muted },
            ]}
            numberOfLines={3}
          >
            {guidingPhrase ? `"${guidingPhrase}"` : '—'}
          </Text>
          <Text style={styles.statLabel}>GUIDING PHRASE</Text>
        </View>
      </View>

      {/* ── Day detail panel ── */}
      <View style={styles.dayCard}>
        <View style={styles.dayCardHead}>
          <Text style={styles.dayCardName}>{selectedDay?.label}</Text>
          <Text style={styles.dayCardDate}>{fmtDisplayDate(selectedDay?.dateStr)}</Text>
        </View>

        {selectedDayWorkouts.length > 0 ? (
          selectedDayWorkouts.map(workout => {
            const isMarking = !!marking[workout.overrideId];
            const locked    = isLocked(workout.specific_date);
            const hasUnreadFeedback = workout.coachFeedback && !workout.feedbackIsRead;

            return (
              <View key={workout.id} style={styles.workoutCard}>
                <View style={styles.workoutTitleRow}>
                  <Text style={styles.workoutTitle}>{workout.title?.toUpperCase()}</Text>
                  {hasUnreadFeedback && <View style={styles.feedbackDot} />}
                </View>
                {workout.purpose ? (
                  <Text style={styles.workoutPurpose}>{workout.purpose}</Text>
                ) : null}
                {locked && (
                  <View style={styles.lockedBadge}>
                    <Text style={styles.lockedBadgeText}>🔒 LOCKED (7+ DAYS OLD)</Text>
                  </View>
                )}

                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.viewBtn}
                    onPress={() => navigation.navigate('WorkoutDetail', {
                      workout,
                      studentView: true,
                    })}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.viewBtnText}>VIEW WORKOUT</Text>
                  </TouchableOpacity>

                  {workout.completed ? (
                    <View style={styles.doneRow}>
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
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[styles.markDoneBtn, (isMarking || locked) && { opacity: locked ? 0.4 : 0.6 }]}
                      onPress={locked ? undefined : () => handleMarkDone(workout)}
                      disabled={isMarking || locked}
                      activeOpacity={0.8}
                    >
                      {isMarking
                        ? <ActivityIndicator color={SL.bg} size="small" />
                        : <Text style={styles.markDoneBtnText}>MARK AS DONE</Text>
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
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg },
  body:      { paddingBottom: 56 },

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
    height: 1,
    backgroundColor: SL.accent,
    opacity: 0.3,
    alignSelf: 'stretch',
    marginTop: 16,
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
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: SL.border,
    backgroundColor: SL.panel,
  },
  navArrowText: { fontFamily: F.heading, fontSize: 30, color: SL.accent },
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
    gap: 4,
  },
  dayNode: {
    flex: 1,
    minHeight: 116,
    backgroundColor: SL.panel,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: SL.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 2,
    gap: 2,
  },
  dayNodeToday:    { borderColor: SL.text },
  dayNodeSelected: { backgroundColor: '#0a1a2e', borderColor: SL.accent, borderWidth: 2 },

  dayLabel: {
    fontFamily: F.body,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  dayLabelSel: { color: SL.accent },
  dayNum: {
    fontFamily: F.heading,
    fontSize: 32,
    color: SL.text,
    lineHeight: 36,
  },
  dayMonth: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  dayCheck: {
    fontSize: 20,
    color: SL.green,
    fontFamily: F.heading,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 3,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 0,
    backgroundColor: SL.accent,
  },
  dayWorkoutName: {
    fontFamily: F.body,
    fontSize: 16,
    color: SL.accent,
    letterSpacing: 0.3,
    textAlign: 'center',
    paddingHorizontal: 2,
    textTransform: 'uppercase',
  },
  dayRest: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: '#2a4a6a',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },

  // ── Stats row ────────────────────────────────────────────────────────────────

  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingTop: 12,
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontFamily: F.heading,
    fontSize: 34,
    color: SL.accent,
    letterSpacing: 1,
  },
  statLabel: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 2,
    textTransform: 'uppercase',
    textAlign: 'center',
  },

  // ── Day detail panel ──────────────────────────────────────────────────────────

  dayCard: {
    marginHorizontal: 8,
    marginTop: 12,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    padding: 20,
    gap: 12,
  },
  dayCardHead: { gap: 2 },
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

  workoutCard: {
    backgroundColor: SL.bg,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    padding: 14,
    gap: 12,
  },
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
    flex: 1,
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
    fontSize: 20,
    color: SL.text,
    letterSpacing: 0.5,
    marginTop: -6,
  },

  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  viewBtn: {
    flex: 1,
    height: 40,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewBtnText: {
    fontFamily: F.body,
    fontSize: 16,
    color: SL.accent,
    letterSpacing: 2,
  },
  markDoneBtn: {
    flex: 1,
    height: 40,
    backgroundColor: SL.accent,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  markDoneBtnText: {
    fontFamily: F.body,
    fontSize: 16,
    color: SL.bg,
    letterSpacing: 2,
  },
  doneRow: {
    flexDirection: 'row',
    gap: 8,
    flex: 1,
  },
  doneTag: {
    flex: 2,
    height: 40,
    borderWidth: 1.5,
    borderColor: SL.green,
    borderRadius: 4,
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
    flex: 1,
    height: 40,
    borderWidth: 1.5,
    borderColor: SL.muted,
    borderRadius: 4,
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
