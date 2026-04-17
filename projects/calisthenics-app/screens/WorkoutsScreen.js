import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { supabase } from '../lib/supabase';
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
};

// ─── Date helpers ─────────────────────────────────────────────────────────────

const MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const DAY_LABELS = ['MON','TUE','WED','THU','FRI','SAT','SUN'];

function toDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

const TODAY_STR = toDateStr(new Date());

function getWeekDays(offset = 0) {
  const today  = new Date();
  const dow    = today.getDay();
  const diff   = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff + offset * 7);
  monday.setHours(0, 0, 0, 0);

  return DAY_LABELS.map((label, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const jsDay     = d.getDay();
    const dayOfWeek = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon … 6=Sun
    return {
      label,
      date:     d,
      dateStr:  toDateStr(d),
      dayIndex: i,
      dayOfWeek,
      month:    MONTH_ABBR[d.getMonth()],
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

function calcStreak(allOverrides) {
  if (!allOverrides || allOverrides.length === 0) return 0;

  // Group by date: date → { total, completed }
  const dateMap = {};
  for (const o of allOverrides) {
    if (!dateMap[o.specific_date]) {
      dateMap[o.specific_date] = { total: 0, completed: 0 };
    }
    dateMap[o.specific_date].total += 1;
    if (o.completed) dateMap[o.specific_date].completed += 1;
  }

  // A day "counts" only if it has workouts AND all are completed
  const completedDays = new Set(
    Object.entries(dateMap)
      .filter(([, v]) => v.completed > 0)
      .map(([date]) => date)
  );

  console.log('[calcStreak] dateMap:', dateMap);
  console.log('[calcStreak] completedDays:', [...completedDays]);

  let streak = 0;
  const cursor = new Date();

  // If today is not fully done, start counting from yesterday
  const todayStr = toDateStr(cursor);
  if (!completedDays.has(todayStr)) {
    cursor.setDate(cursor.getDate() - 1);
  }

  while (true) {
    const dateStr = toDateStr(cursor);
    if (completedDays.has(dateStr)) {
      // Day had workouts, all completed — count it
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else if (dateMap[dateStr]) {
      // Day had workouts but not all done — streak broken
      break;
    } else {
      // Rest day — skip back, but cap at 365 days
      cursor.setDate(cursor.getDate() - 1);
      if (Math.floor((new Date() - cursor) / 86400000) > 365) break;
    }
  }

  return streak;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function WorkoutsScreen({ navigation }) {
  const [profile,               setProfile]               = useState(null);
  const [workoutsById,          setWorkoutsById]          = useState({});
  const [overrideWorkouts,      setOverrideWorkouts]      = useState([]);  // workout_override_workouts rows
  const [pendingCheckup,        setPendingCheckup]        = useState(null);
  const [coachResponseCheckup,  setCoachResponseCheckup]  = useState(null);
  const [expTotal,              setExpTotal]              = useState(0);
  const [winStreak,             setWinStreak]             = useState(0);
  const [allOverrides,          setAllOverrides]          = useState([]);
  const [loading,               setLoading]               = useState(true);
  const [refreshing,            setRefreshing]            = useState(false);

  const [weekOffset, setWeekOffset] = useState(0);
  const weekDays = useMemo(() => getWeekDays(weekOffset), [weekOffset]);

  const [selectedDay, setSelectedDay] = useState(
    () => getWeekDays(0).find(d => d.dateStr === TODAY_STR) ?? getWeekDays(0)[0]
  );

  // Per-workout marking state: { [workoutId]: true } while in-flight
  const [marking, setMarking] = useState({});

  // ── Fetch week data ────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [profileRes, overridesRes, checkupRes, coachResponseRes, expRes, allOverridesRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('full_name, level')
          .eq('id', user.id)
          .single(),

        supabase
          .from('workout_override_workouts')
          .select('id, specific_date, workout_id, completed')
          .eq('student_id', user.id),

        supabase
          .from('checkups')
          .select('*')
          .eq('student_id', user.id)
          .eq('status', 'pending')
          .order('scheduled_date', { ascending: true })
          .limit(1)
          .maybeSingle(),

        supabase
          .from('checkups')
          .select('id, scheduled_date, coach_response, responded_at')
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
          .from('workout_override_workouts')
          .select('id, specific_date, completed')
          .eq('student_id', user.id),
      ]);

      if (profileRes.data)   setProfile(profileRes.data);
      if (overridesRes.data) setOverrideWorkouts(overridesRes.data);
      setPendingCheckup(checkupRes.data ?? null);
      setCoachResponseCheckup(coachResponseRes.data ?? null);
      const freshAllOverrides = allOverridesRes.data ?? [];
      setExpTotal(expRes.count ?? 0);
      setWinStreak(calcStreak(freshAllOverrides));
      setAllOverrides(freshAllOverrides);

      const ids = [...new Set(
        (overridesRes.data ?? []).map(o => o.workout_id).filter(Boolean)
      )];

      if (ids.length > 0) {
        const { data: ws } = await supabase
          .from('workouts')
          .select('id, title, purpose, completed, scheduled_date')
          .in('id', ids);
        if (ws) setWorkoutsById(Object.fromEntries(ws.map(w => [w.id, w])));
      } else {
        setWorkoutsById({});
      }
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

  // ── Day workout lookup (returns array) ────────────────────────────────────

  function getDayWorkouts(day) {
    const dayOverrides = overrideWorkouts.filter(o => o.specific_date === day.dateStr);
    return dayOverrides
      .map(o => ({ ...workoutsById[o.workout_id], overrideId: o.id, completed: o.completed ?? false }))
      .filter(o => o.id);
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
        const updatedOverrides = allOverrides.map(o =>
          o.id === workout.overrideId ? { ...o, completed: true } : o
        );
        setAllOverrides(updatedOverrides);
        setExpTotal(prev => prev + 1);
        setWinStreak(calcStreak(updatedOverrides));
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
        const updatedOverrides = allOverrides.map(o =>
          o.id === workout.overrideId ? { ...o, completed: false } : o
        );
        setAllOverrides(updatedOverrides);
        setExpTotal(prev => Math.max(0, prev - 1));
        setWinStreak(calcStreak(updatedOverrides));
      } else {
        alert('Could not undo: ' + error.message);
      }
    } catch {
      alert('Something went wrong.');
    }
    setMarking(prev => ({ ...prev, [workout.overrideId]: false }));
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  const nextOverride = [...overrideWorkouts]
    .filter(o => o.specific_date >= TODAY_STR && !o.completed)
    .sort((a, b) => a.specific_date.localeCompare(b.specific_date))[0];
  const nextWorkout = nextOverride ? workoutsById[nextOverride.workout_id] : null;

  const completedThisWeek = weekDays.filter(d =>
    getDayWorkouts(d).length > 0 && getDayWorkouts(d).every(w => w.completed)
  ).length;

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
        <Text style={styles.level}>LVL {profile?.level ?? '—'}</Text>
        <View style={styles.headerDivider} />
      </View>

      {/* ── Checkup due banner ── */}
      {pendingCheckup && (
        <TouchableOpacity
          style={styles.checkupBanner}
          onPress={() => navigation.navigate('Checkup', { checkup: pendingCheckup })}
          activeOpacity={0.8}
        >
          <Text style={styles.checkupBannerText}>
            {pendingCheckup.scheduled_date <= TODAY_STR ? '📋 CHECKUP DUE' : '📋 UPCOMING CHECKUP'}
          </Text>
          <Text style={styles.checkupBannerDate}>{pendingCheckup.scheduled_date} →</Text>
        </TouchableOpacity>
      )}

      {/* ── Coach response banner ── */}
      {coachResponseCheckup && (
        <TouchableOpacity
          style={styles.coachResponseBanner}
          onPress={() => navigation.navigate('CoachResponse', { checkup: coachResponseCheckup })}
          activeOpacity={0.8}
        >
          <Text style={styles.coachResponseBannerText}>💬 COACH RESPONSE RECEIVED</Text>
          <Text style={styles.coachResponseBannerDate}>{coachResponseCheckup.scheduled_date} →</Text>
        </TouchableOpacity>
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
        {/* NEXT UP */}
      <View style={styles.statCard}>
        <Text
          style={[styles.statValue, { fontSize: 16 }, !nextWorkout && { color: SL.muted }]}
          numberOfLines={1}
        >
          {nextWorkout?.title?.toUpperCase() ?? 'REST'}
        </Text>
        <Text style={styles.statLabel}>NEXT UP</Text>
      </View>

      {/* EXP */}
      <View style={styles.statCard}>
        <Text style={styles.statValue}>{expTotal}</Text>
        <Text style={styles.statLabel}>EXP</Text>
      </View>

      {/* WIN STREAK */}
      <View style={styles.statCard}>
        <Text style={styles.statValue}>{winStreak}</Text>
        <Text style={styles.statLabel}>WIN STREAK</Text>
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
            return (
              <View key={workout.id} style={styles.workoutCard}>
                <Text style={styles.workoutTitle}>{workout.title?.toUpperCase()}</Text>
                {workout.purpose ? (
                  <Text style={styles.workoutPurpose}>{workout.purpose}</Text>
                ) : null}

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
                        style={styles.undoBtn}
                        onPress={() => handleUndoDone(workout)}
                        disabled={isMarking}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.undoBtnText}>UNDO</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[styles.markDoneBtn, isMarking && { opacity: 0.6 }]}
                      onPress={() => handleMarkDone(workout)}
                      disabled={isMarking}
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
    fontSize: 32,
    color: SL.accent,
    letterSpacing: 4,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  level: {
    fontFamily: F.body,
    fontSize: 20,
    color: SL.text,
    letterSpacing: 3,
    marginTop: 6,
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
    fontSize: 18,
    color: SL.accent,
    letterSpacing: 2,
  },
  checkupBannerDate: {
    fontFamily: F.bodyMed,
    fontSize: 14,
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
    borderColor: SL.green,
    borderRadius: 6,
    backgroundColor: 'rgba(76,175,80,0.08)',
  },
  coachResponseBannerText: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.green,
    letterSpacing: 2,
  },
  coachResponseBannerDate: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.green,
    letterSpacing: 1,
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
  navArrowText: { fontFamily: F.heading, fontSize: 18, color: SL.accent },
  navCenter:    { flex: 1, alignItems: 'center', gap: 2 },
  navBadge: {
    fontFamily: F.body,
    fontSize: 11,
    color: SL.accent,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  navRange: {
    fontFamily: F.bodyMed,
    fontSize: 14,
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
    fontSize: 14,
    color: SL.muted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  dayLabelSel: { color: SL.accent },
  dayNum: {
    fontFamily: F.heading,
    fontSize: 28,
    color: SL.text,
    lineHeight: 32,
  },
  dayMonth: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: SL.muted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  dayCheck: {
    fontSize: 14,
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
    fontSize: 10,
    color: SL.accent,
    letterSpacing: 0.3,
    textAlign: 'center',
    paddingHorizontal: 2,
    textTransform: 'uppercase',
  },
  dayRest: {
    fontFamily: F.bodyMed,
    fontSize: 10,
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
    fontSize: 28,
    color: SL.accent,
    letterSpacing: 1,
  },
  statLabel: {
    fontFamily: F.bodyMed,
    fontSize: 11,
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
    fontSize: 20,
    color: SL.accent,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  dayCardDate: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 0.5,
  },

  // Individual workout card inside day panel
  workoutCard: {
    backgroundColor: SL.bg,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    padding: 14,
    gap: 12,
  },
  workoutTitle: {
    fontFamily: F.heading,
    fontSize: 20,
    color: SL.accent,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  workoutPurpose: {
    fontFamily: F.body,
    fontSize: 15,
    color: SL.text,
    letterSpacing: 0.5,
    marginTop: -6,
  },

  // Action buttons row within each workout card
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
    fontSize: 14,
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
    fontSize: 14,
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
    fontSize: 14,
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
    fontSize: 14,
    color: SL.muted,
    letterSpacing: 2,
  },

  // Rest day
  restCard: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 24,
  },
  restLabel: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.muted,
    letterSpacing: 5,
  },
  restSub: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
});
