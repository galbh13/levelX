import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable,
  ActivityIndicator, RefreshControl, Modal, Animated, Easing, Dimensions,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { computeLvl } from '../lib/computeLvl';
import { materializeDay, isDateOverridden } from '../lib/schedule';
import { categoryMeta } from '../lib/workouts';
import { F } from '../constants/fonts';

// Off-program ACCESSORIES / LEGS workouts get their type's signature glow; the
// dated program (main/side/untyped) keeps the default ice theme. Returns a color
// or null (= use default styling).
const accentFor = (category) =>
  (category === 'accessory' || category === 'legs') ? categoryMeta(category).color : null;

// Full window width — how far the body slides off-screen during the swipe exit.
const WIN_W = Dimensions.get('window').width;
// Shared swipe duration so the Workouts ↔ Manage transition has one consistent pace.
const SWIPE_MS = 300;
import ScreenFrame from '../components/ScreenFrame';
import PillButton from '../components/PillButton';
import { ShimmerText, ShimmerFrame, BLUE } from '../components/Shimmer';
import { CARD_H, CARD_W } from '../constants/layout';

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

// ─── Calendar window / retention ───────────────────────────────────────────────
// The week ruler only travels 4 weeks back … 4 weeks forward from the current
// week (9 weeks total). Per-date rows outside this window are pruned from the DB
// on load so storage stays small — only the visible 9 weeks are ever kept.
const WEEKS_BACK = 4;
const WEEKS_FWD  = 4;

function windowBounds() {
  return {
    start: getWeekDays(-WEEKS_BACK)[0].dateStr,
    end:   getWeekDays(WEEKS_FWD)[6].dateStr,
  };
}

// Delete the player's own per-date rows that fall outside the 9-week window.
// Only touches transient per-date data (override workouts + daily-quest
// completions); permanent progress (student_quest_completions, workouts,
// templates) is never affected.
async function pruneOutOfWindow(studentId, { start, end }) {
  const outside = (col) => `${col}.lt.${start},${col}.gt.${end}`;
  try {
    await Promise.all([
      supabase.from('workout_override_workouts').delete()
        .eq('student_id', studentId).or(outside('specific_date')),
      supabase.from('daily_quest_completions').delete()
        .eq('student_id', studentId).or(outside('completion_date')),
    ]);
  } catch (e) {
    console.warn('[WorkoutsScreen] prune:', e?.message ?? e);
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function WorkoutsScreen({ navigation, route }) {
  // Admin-as-coach: with a `studentId` param this shows THAT player's actual week
  // — their per-date overrides, completions and edits. No param = the signed-in
  // player's own Workouts tab, unchanged.
  const overrideStudentId = route?.params?.studentId ?? null;
  const adminMode = !!overrideStudentId;
  const resolveTargetId = useCallback(async () => {
    if (overrideStudentId) return overrideStudentId;
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
  }, [overrideStudentId]);

  const [profile,               setProfile]               = useState(null);
  const [className,             setClassName]             = useState(null);
  const [workoutsById,          setWorkoutsById]          = useState({});
  const [allWorkouts,           setAllWorkouts]           = useState([]);   // for the edit picker
  const [overrideWorkouts,      setOverrideWorkouts]      = useState([]);
  const [templateRows,          setTemplateRows]          = useState([]);   // weekly skeleton
  const [dailyQuestIds,         setDailyQuestIds]         = useState([]);   // active daily-quest ids
  const [dailyDoneByDate,       setDailyDoneByDate]       = useState({});   // dateStr → Set(quest ids)
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

  // ── Training Forge press juice ──
  // `forgePress` (0→1) is held while the finger is down → scale punch, chip pop,
  // chevron dart. `forgeSweep` is a one-shot light streak fired on press-in.
  const forgePress = useRef(new Animated.Value(0)).current;
  const forgeSweep = useRef(new Animated.Value(0)).current;
  const [forgeW, setForgeW] = useState(0);

  const onForgeIn = useCallback(() => {
    Animated.spring(forgePress, {
      toValue: 1, useNativeDriver: true, speed: 50, bounciness: 0,
    }).start();
    forgeSweep.setValue(0);
    Animated.timing(forgeSweep, {
      toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
  }, [forgePress, forgeSweep]);

  const onForgeOut = useCallback(() => {
    // Spring back with a little overshoot for that satisfying "release" pop.
    Animated.spring(forgePress, {
      toValue: 0, useNativeDriver: true, speed: 18, bounciness: 14,
    }).start();
  }, [forgePress]);

  const forgeScale  = forgePress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.955] });
  const forgeChipS  = forgePress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });
  const forgeChevX  = forgePress.interpolate({ inputRange: [0, 1], outputRange: [0, 5] });
  const forgeSweepX = forgeSweep.interpolate({ inputRange: [0, 1], outputRange: [-70, forgeW + 70] });
  const forgeSweepO = forgeSweep.interpolate({ inputRange: [0, 0.12, 0.85, 1], outputRange: [0, 0.55, 0.4, 0] });

  // ── Forge → Manage "System seal" exit ──
  // Pressing TRAINING FORGE swipes the BODY off to the left while the headline
  // (name + LVL · CLASS + divider) stays put — Manage then slides its identical
  // body in from the right, so the header reads as one continuous, unmoved element.
  const exitAnim   = useRef(new Animated.Value(0)).current;
  const exitingRef = useRef(false);
  const exitedRef  = useRef(false);   // did we leave via the Forge swipe?

  const onForgePress = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    exitedRef.current  = true;
    Animated.timing(exitAnim, {
      toValue: 1, duration: SWIPE_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true,
    }).start(({ finished }) => {
      // `fromForge` triggers the matching slide-in; pass lvl/class we already have
      // so Manage's header renders instantly with no refetch flash.
      if (finished) navigation.navigate('Manage', { fromForge: true, lvl, className });
    });
  }, [exitAnim, navigation, lvl, className]);

  // ── HUD chrome (entrance removed) ──
  // The staggered boot-up was retired when tab swiping landed: the neighbouring
  // page is VISIBLE mid-drag (before focus fires), so the chrome must sit fully
  // built at all times — values live at 1 and never replay. The Animated.Values
  // are kept (at rest) because the layout binds to them for the Forge exit slide.
  const boot = useRef({
    header:  new Animated.Value(1),
    divider: new Animated.Value(1),
    forge:   new Animated.Value(1),
    nav:     new Animated.Value(1),
    cells:   Array.from({ length: 7 }, () => new Animated.Value(1)),
    panel:   new Animated.Value(1),
  }).current;

  // On return: if we left via the Forge swipe, swipe the body back IN from the left
  // (completing the page swipe, same pace). Otherwise just sit in place.
  useFocusEffect(useCallback(() => {
    exitingRef.current = false;
    if (exitedRef.current) {
      exitedRef.current = false;
      exitAnim.setValue(1);               // start off-screen left
      Animated.timing(exitAnim, {
        toValue: 0, duration: SWIPE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start();
    } else {
      exitAnim.setValue(0);
    }
  }, [exitAnim]));

  const exitBodyX = exitAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -WIN_W] });
  const exitBodyO = exitAnim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] });

  // ── Fetch week data ────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const tid = await resolveTargetId();
      if (!tid) return;

      const win = windowBounds();
      // Trim anything outside the 9-week window before reading.
      await pruneOutOfWindow(tid, win);

      const [profileRes, overridesRes, templateRes, workoutsRes, dqRes, dqcRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('full_name, class_id')
          .eq('id', tid)
          .single(),

        supabase
          .from('workout_override_workouts')
          .select('id, specific_date, workout_id, completed, coach_feedback, feedback_is_read')
          .eq('student_id', tid),

        supabase
          .from('weekly_workout_template')
          .select('id, day_of_week, workout_id')
          .eq('student_id', tid),

        supabase
          .from('workouts')
          .select('id, title, purpose, scheduled_date, category')
          .eq('assigned_to', tid)
          .order('title', { ascending: true }),

        // Active daily quests — a rest day counts as "done" when all of these are
        // checked off for that date.
        supabase
          .from('daily_quests')
          .select('id')
          .eq('student_id', tid)
          .eq('active', true),

        // Daily-quest completions inside the visible window.
        supabase
          .from('daily_quest_completions')
          .select('daily_quest_id, completion_date')
          .eq('student_id', tid)
          .gte('completion_date', win.start)
          .lte('completion_date', win.end),
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
            computeLvl(tid, profileRes.data.class_id),
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

      setDailyQuestIds((dqRes.data ?? []).map(q => q.id));
      const byDate = {};
      (dqcRes.data ?? []).forEach(r => {
        (byDate[r.completion_date] ??= new Set()).add(r.daily_quest_id);
      });
      setDailyDoneByDate(byDate);
    } catch (e) {
      console.error('[WorkoutsScreen] fetchData:', e);
    }
  }, [weekOffset, resolveTargetId]);

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
            category:       w.category,
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
          category:       w.category,
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

  const activeDailyIds = useMemo(() => new Set(dailyQuestIds), [dailyQuestIds]);

  // ── Mark a workout as done ─────────────────────────────────────────────────

  const mkKey = (w) => w.overrideId ?? `t:${w.id}`;

  // Ensure a date has its own override rows (copying the weekday's skeleton in the
  // first time it's touched), so completion / edits can attach to that date.
  async function ensureMaterialized(dateStr) {
    if (isDateOverridden(dateStr, overrideWorkouts)) return;
    const tid = await resolveTargetId();
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    const ids = templateRows.filter(t => t.day_of_week === dow).map(t => t.workout_id);
    await materializeDay({ studentId: tid, coachId: tid, dateStr, templateWorkoutIds: ids });
  }

  async function handleMarkDone(workout) {
    setMarking(prev => ({ ...prev, [mkKey(workout)]: true }));
    try {
      const tid = await resolveTargetId();
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
          .eq('student_id', tid)
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
      const tid = await resolveTargetId();
      await ensureMaterialized(dateStr);  // copy skeleton first so siblings are kept
      const { error } = await supabase
        .from('workout_override_workouts')
        .insert({ student_id: tid, coach_id: tid, specific_date: dateStr, workout_id: workoutId });
      if (error) alert('Error: ' + error.message);
      setEditPending(undefined);
      await fetchData();
    } catch (e) {
      alert('Error: ' + (e.message ?? 'Something went wrong.'));
    }
    setEditSaving(false);
  }

  async function removeWorkoutFromDate(day, workout) {
    const tid = await resolveTargetId();
    // Template-derived day: materialize first so removing one keeps the others.
    if (!workout.overrideId) await ensureMaterialized(day.dateStr);
    const { error } = await supabase
      .from('workout_override_workouts')
      .delete()
      .eq('student_id', tid)
      .eq('specific_date', day.dateStr)
      .eq('workout_id', workout.id);
    if (error) alert('Error: ' + error.message);
    await fetchData();
  }

  // Drop all per-date overrides for a date → it falls back to the weekly skeleton.
  async function resetDayToPlan(dateStr) {
    const tid = await resolveTargetId();
    const { error } = await supabase
      .from('workout_override_workouts')
      .delete()
      .eq('student_id', tid)
      .eq('specific_date', dateStr);
    if (error) alert('Error: ' + error.message);
    setEditVisible(false);
    await fetchData();
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  // The full layout ALWAYS renders inside a fixed-size card (matching the Weekly
  // Plan), so the frame never resizes with data or while loading — the spinner
  // shows inside the day panel.

  return (
    <ScreenFrame maxWidth={CARD_W} ready={!loading}>
    <View style={styles.card}>
    <View style={styles.body}>
      {/* Admin-as-coach: BACK to the player hub (this screen is a tab for players,
          so the pill only shows when an admin opened it for a specific player). */}
      {adminMode && (
        <View style={styles.adminBackRow}>
          <PillButton label="← BACK" size="sm" onPress={() => navigation.goBack()} />
        </View>
      )}

      {/* ── Header ── */}
      <Animated.View style={[styles.header, {
        opacity: boot.header,
        transform: [{ translateY: boot.header.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
      }]}>
        <Text style={styles.studentName}>
          {profile?.full_name?.toUpperCase() ?? '—'}
        </Text>
        <View style={styles.statRow}>
          <Text style={styles.level}>LVL {lvl ?? '—'}</Text>
          {className && (
            <>
              <View style={styles.statDot} />
              <Text style={styles.className}>{className.toUpperCase()}</Text>
            </>
          )}
        </View>
        {/* Ice divider scans out from its center as the headline settles. */}
        <Animated.View style={[styles.headerDivider, { transform: [{ scaleX: boot.divider }] }]} />
      </Animated.View>

      {/* Everything below the headline swipes off to the left on the Forge exit
          (the headline itself stays put). */}
      <Animated.View style={[styles.swipeBody, { transform: [{ translateX: exitBodyX }], opacity: exitBodyO }]}>

      {/* ── Training upgrade console (self-coach) ──
          Reframed as a game-style "forge / upgrade station": a glowing panel with
          a live ice-shimmer frame, a power chip, and a build/upgrade subtitle. */}
      <Animated.View style={[styles.manageRow, {
        opacity: boot.forge,
        transform: [
          { translateY: boot.forge.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) },
          { scale: boot.forge.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
        ],
      }]}>
        <Pressable onPressIn={onForgeIn} onPressOut={onForgeOut} onPress={onForgePress}>
          <Animated.View
            style={[styles.forgeBtn, { transform: [{ scale: forgeScale }] }]}
            onLayout={e => setForgeW(e.nativeEvent.layout.width)}
          >
            <ShimmerFrame
              style={StyleSheet.absoluteFill}
              colors={BLUE}
              radius={14}
              thickness={2}
              active
            />
            <Animated.View style={[styles.forgeChip, { transform: [{ scale: forgeChipS }] }]}>
              <Text style={styles.forgeChipGlyph}>▲</Text>
            </Animated.View>
            <Text style={styles.forgeTitle}>TRAINING FORGE</Text>
            <Animated.Text style={[styles.forgeChevron, { transform: [{ translateX: forgeChevX }] }]}>›</Animated.Text>
            {/* one-shot light streak that sweeps across on press (holo shine) */}
            <Animated.View
              pointerEvents="none"
              style={[styles.forgeSweep, { opacity: forgeSweepO, transform: [{ translateX: forgeSweepX }, { skewX: '-18deg' }] }]}
            />
          </Animated.View>
        </Pressable>
      </Animated.View>

      {/* ── Week nav ── */}
      <Animated.View style={[styles.calendarNav, {
        opacity: boot.nav,
        transform: [{ translateY: boot.nav.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
      }]}>
        <TouchableOpacity
          style={[styles.navArrow, weekOffset <= -WEEKS_BACK && styles.navArrowDisabled]}
          disabled={weekOffset <= -WEEKS_BACK}
          onPress={() => setWeekOffset(o => Math.max(-WEEKS_BACK, o - 1))}
        >
          <View style={[styles.chevron, styles.chevronLeft]} />
        </TouchableOpacity>
        <View style={styles.navCenter}>
          <View style={styles.navRangeCard}>
            <Text style={styles.navRange}>{fmtWeekRange(weekDays)}</Text>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.navArrow, weekOffset >= WEEKS_FWD && styles.navArrowDisabled]}
          disabled={weekOffset >= WEEKS_FWD}
          onPress={() => setWeekOffset(o => Math.min(WEEKS_FWD, o + 1))}
        >
          <View style={[styles.chevron, styles.chevronRight]} />
        </TouchableOpacity>
      </Animated.View>

      {/* ── Calendar grid ── */}
      <View style={styles.calendarGrid}>
        {weekDays.map((day, i) => {
          const dayWorkouts = getDayWorkouts(day);
          const isSelected  = day.dateStr === selectedDay?.dateStr;
          const isToday     = day.dateStr === TODAY_STR;
          // A workout day is done when every workout is completed. A REST day
          // (no workouts) still counts as done when all active daily quests are
          // checked off for that date.
          const dailyDone   = [...(dailyDoneByDate[day.dateStr] ?? [])]
            .filter(id => activeDailyIds.has(id)).length;
          const allDone     = dayWorkouts.length > 0
            ? dayWorkouts.every(w => w.completed)
            : activeDailyIds.size > 0 && dailyDone >= activeDailyIds.size;

          const cellV = boot.cells[i];
          return (
            <Animated.View
              key={day.dateStr}
              style={{
                flex: 1,
                opacity: cellV,
                transform: [
                  { translateY: cellV.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) },
                  { scale: cellV.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
                ],
              }}
            >
            <TouchableOpacity
              style={[
                styles.dayNode,
                isToday && !isSelected && styles.dayNodeToday,
                isSelected && styles.dayNodeSelected,
                allDone && styles.dayNodeDone,
              ]}
              onPress={() => setSelectedDay(day)}
              activeOpacity={0.75}
            >
              <Text style={[
                styles.dayLabel,
                (isSelected || isToday) && styles.dayLabelSel,
                allDone && styles.dayLabelDone,
              ]}>
                {day.label}
              </Text>
              <Text style={[
                styles.dayNum,
                (isSelected || isToday) && styles.dayNumActive,
                allDone && styles.dayNumDone,
              ]}>
                {day.date.getDate()}
              </Text>
              {/* Month is shown once in the week-range pill above — repeating it
                  in every cell was noise on a phone. */}

              {/* A rest day is simply a day with no accent dot below — no label. */}

              {/* Per-workout accent dots — a dot for every workout on this day:
                  accessory/legs in their signature type color, the dated
                  program (main/side/untyped) in the default ice-blue accent. */}
              {(() => {
                const accents = dayWorkouts.map(w => accentFor(w.category) ?? SL.accent);
                if (!accents.length) return null;
                return (
                  <View style={styles.accDots}>
                    {accents.map((c, di) => (
                      <View key={di} style={[styles.accDot, { backgroundColor: c, shadowColor: c }]} />
                    ))}
                  </View>
                );
              })()}

              {isToday && <View style={styles.todayBar} />}
            </TouchableOpacity>
            </Animated.View>
          );
        })}
      </View>

      {/* ── Day detail panel ── */}
      <Animated.View style={[styles.dayCard, {
        opacity: boot.panel,
        transform: [{ translateY: boot.panel.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
      }]}>
        <View style={styles.dayCardHead}>
          <Text style={styles.dayCardDate}>{fmtDisplayDate(selectedDay?.dateStr)}</Text>
          <View style={styles.dayCardEditBtn}>
            <PillButton
              label="✎ EDIT DAY"
              size="sm"
              onPress={() => { setEditPending(undefined); setEditVisible(true); }}
            />
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.dayCardBody,
            (loading || selectedDayWorkouts.length === 0) && styles.dayCardBodyEmpty,
          ]}
          showsVerticalScrollIndicator={false}
        >
        {loading ? (
          <View style={styles.restCard}>
            <ActivityIndicator color={SL.accent} size="large" />
          </View>
        ) : selectedDayWorkouts.length > 0 ? (
          selectedDayWorkouts.map(workout => {
            const isMarking = !!marking[mkKey(workout)];
            const locked    = isLocked(workout.specific_date);
            const hasUnreadFeedback = workout.coachFeedback && !workout.feedbackIsRead;
            const tc        = accentFor(workout.category); // accessory/legs glow, else null

            return (
              <View key={workout.id} style={[styles.workoutCard, tc && { borderLeftColor: tc, shadowColor: tc, shadowOpacity: 0.4, shadowRadius: 8 }]}>
                <View style={styles.workoutInfo}>
                  <View style={styles.workoutTitleRow}>
                    <Text style={[styles.workoutTitle, tc && { color: tc }]} numberOfLines={2}>{workout.title?.toUpperCase()}</Text>
                    {tc && (
                      <View style={[styles.typeTag, { borderColor: tc }]}>
                        <Text style={[styles.typeTagText, { color: tc }]}>{categoryMeta(workout.category).l}</Text>
                      </View>
                    )}
                    {hasUnreadFeedback && <View style={styles.feedbackDot} />}
                  </View>
                  {workout.purpose ? (
                    <Text style={styles.workoutPurpose} numberOfLines={1}>{workout.purpose}</Text>
                  ) : null}
                  {locked && (
                    <View style={styles.lockedBadge}>
                      <Text style={styles.lockedBadgeText}>🔒 LOCKED</Text>
                    </View>
                  )}
                </View>

                <View style={styles.actionRow}>
                  {workout.completed ? (
                    /* Done — just a shining COMPLETED badge + UNDO (no mode/view). */
                    <>
                      <View style={styles.completedTag}>
                        <ShimmerText
                          text="✓ COMPLETED"
                          style={styles.completedTagText}
                          colors={BLUE}
                          direction="ltr"
                          active
                        />
                      </View>
                      <PillButton
                        label="UNDO"
                        tone="muted"
                        size="sm"
                        style={styles.actionBtn}
                        textStyle={styles.actionBtnText}
                        onPress={locked ? undefined : () => handleUndoDone(workout)}
                        disabled={isMarking || locked}
                      />
                    </>
                  ) : (
                    /* Not done — VIEW + DONE share one row. Entering the live
                       session (Workout Mode) is NOT offered here anymore: the
                       player steps into it exclusively through the RED GATE portal
                       on HomeScreen's today's-missions. */
                    <>
                      <PillButton
                        label="VIEW"
                        size="sm"
                        style={styles.actionBtn}
                        textStyle={styles.actionBtnText}
                        onPress={() => navigation.navigate('WorkoutDetail', {
                          workout,
                          studentView: true,
                        })}
                      />
                      <PillButton
                        label="DONE"
                        variant="solid"
                        size="sm"
                        style={styles.actionBtn}
                        textStyle={styles.actionBtnText}
                        onPress={locked ? undefined : () => handleMarkDone(workout)}
                        disabled={isMarking || locked}
                        loading={isMarking}
                      />
                    </>
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
        </ScrollView>
      </Animated.View>

      </Animated.View>

      {/* ── Per-date edit modal ── */}
      <Modal
        visible={editVisible}
        transparent
        animationType="fade"
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
              <PillButton
                label="CLOSE"
                tone="muted"
                onPress={() => setEditVisible(false)}
                disabled={editSaving}
                style={{ flex: 1 }}
              />
              <PillButton
                label="ADD"
                variant="solid"
                onPress={() => editPending && addWorkoutToDate(selectedDay.dateStr, editPending.id)}
                disabled={editSaving || !editPending}
                loading={editSaving}
                style={{ flex: 2 }}
              />
            </View>

            {isDateOverridden(selectedDay?.dateStr, overrideWorkouts) && (
              <PillButton
                label="↺ RESET TO WEEKLY PLAN"
                tone="muted"
                onPress={() => resetDayToPlan(selectedDay.dateStr)}
                disabled={editSaving}
                style={{ marginTop: 14 }}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
    </View>
    </ScreenFrame>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Fixed card size so the frame matches the Weekly Plan and never resizes with data.
  card: { height: CARD_H },

  // The body region (everything under the headline) that swipes left on exit.
  swipeBody: { flex: 1, width: '100%' },
  body: { flex: 1, width: '100%', paddingBottom: 12 },

  // ── Header ──────────────────────────────────────────────────────────────────

  // Admin BACK pill — absolute so it overlays the header's top padding without
  // shifting the fixed-height layout.
  adminBackRow: {
    position: 'absolute',
    top: 16,
    // Match the week strip's inset (calendarGrid paddingHorizontal) so the BACK
    // pill keeps the same space from the frame border.
    left: 28,
    zIndex: 10,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 64,
    paddingBottom: 20,
    alignItems: 'center',
  },
  studentName: {
    fontFamily: F.heading,
    fontSize: 42,
    color: '#FFFFFF',
    letterSpacing: 4,
    textTransform: 'uppercase',
    textAlign: 'center',
    textShadowColor: SL.accent,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 6,
  },
  statDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: SL.muted,
  },
  level: {
    fontFamily: F.body,
    fontSize: 26,
    color: SL.text,
    letterSpacing: 3,
  },
  className: {
    fontFamily: F.bodyMed,
    fontSize: 22,
    color: SL.gold,
    letterSpacing: 3,
  },
  headerDivider: {
    height: 3,
    width: 180,
    backgroundColor: SL.accent,
    opacity: 0.95,
    alignSelf: 'center',
    marginTop: 16,
    borderRadius: 2,
    // Bright ice-glow so the line shines.
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 12,
  },

  // ── Manage banner ─────────────────────────────────────────────────────────────

  manageRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginTop: 18,
  },
  // ── Training "forge" upgrade console ──
  forgeBtn: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 13,
    paddingHorizontal: 22,
    borderRadius: 13,
    backgroundColor: '#0a1626',
    overflow: 'hidden',
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
  },
  forgeSweep: {
    position: 'absolute',
    top: -4,
    bottom: -4,
    left: 0,
    width: 46,
    backgroundColor: 'rgba(180,230,255,0.85)',
    shadowColor: '#bfe9ff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
  },
  forgeChip: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(74,158,191,0.12)',
    borderWidth: 1.5,
    borderColor: SL.accent,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 8,
  },
  forgeChipGlyph: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.accent,
    textShadowColor: SL.accent,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  forgeTitle: {
    fontFamily: F.heading,
    fontSize: 20,
    color: SL.text,
    letterSpacing: 2,
    textShadowColor: SL.accent,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  forgeChevron: {
    fontFamily: F.heading,
    fontSize: 26,
    color: SL.accent,
    textShadowColor: SL.accent,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
    marginLeft: 2,
  },

  // ── Week nav ────────────────────────────────────────────────────────────────

  calendarNav: {
    flexDirection: 'row',
    alignItems: 'center',
    // Match the week strip's inset (calendarGrid) so the ← / → arrows keep the
    // same space from the frame border instead of clipping against it.
    paddingHorizontal: 28,
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
  navArrowDisabled: { opacity: 0.25 },
  // Hollow chevron drawn from two borders (a top-right corner ⌐) then rotated so
  // it points left/right — crisper than the font glyph and pixel-consistent on web.
  chevron: {
    width: 12,
    height: 12,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderColor: SL.accent,
    borderRadius: 1.5,
  },
  // Rotated corners land optically off-centre; the small margins nudge them back
  // into the middle of the circle.
  chevronLeft:  { transform: [{ rotate: '-135deg' }], marginLeft: 4 },
  chevronRight: { transform: [{ rotate: '45deg' }],   marginRight: 4 },
  navCenter:    { flex: 1, alignItems: 'center', gap: 2 },
  navRangeCard: {
    paddingVertical: 7,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: SL.border,
    backgroundColor: 'rgba(74,158,191,0.06)',
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  navRange: {
    fontFamily: F.bodyMed,
    fontSize: 24,
    color: SL.accent,
    letterSpacing: 0.5,
  },

  // ── Calendar grid ────────────────────────────────────────────────────────────

  calendarGrid: {
    flexDirection: 'row',
    // Align the week strip's outer edges with the session node inside dayCard
    // (dayCard margin 8 + border 1.5 + padding 20 ≈ 29), so it sits on the same
    // line as the workout card and leaves breathing room to the frame border.
    paddingHorizontal: 28,
    gap: 6,
  },
  dayNode: {
    flex: 1,
    minHeight: 108,
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
  // Accomplished day — full-day completion glows: shining ice-blue frame + labels.
  dayNodeDone: {
    borderColor: SL.accent,
    backgroundColor: 'rgba(74,158,191,0.12)',
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 16,
  },
  dayLabel: {
    fontFamily: F.body,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  dayLabelSel: { color: SL.accent },
  dayLabelDone: { color: SL.accent },
  dayNum: {
    fontFamily: F.heading,
    fontSize: 34,
    color: SL.text,
    lineHeight: 38,
  },
  dayNumActive: { color: SL.accent },
  dayNumDone: {
    color: SL.accent,
    textShadowColor: 'rgba(74,158,191,0.7)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
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
    flex: 1,                  // fills remaining space inside the fixed-height card
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
  // Sessions stack from the top (first one highest); only the REST placeholder centers.
  dayCardBody: { gap: 12, flexGrow: 1, justifyContent: 'flex-start' },
  dayCardBodyEmpty: { justifyContent: 'center' },
  // Date on the left, EDIT DAY pill on the right — a clean row, never overlapping.
  dayCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 36,
  },
  dayCardDate: {
    flex: 1,
    fontFamily: F.heading,
    fontSize: 30,
    color: SL.accent,
    letterSpacing: 0.5,
  },
  dayCardEditBtn: {
    flexShrink: 0,
  },
  // ── Per-date edit modal ───────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  editorBox: {
    width: '100%',
    maxWidth: 620,
    height: 620,            // FIXED — dialog size is independent of its data
    maxHeight: '92%',       // …but never taller than the viewport
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 18,
    padding: 24,
    paddingBottom: 28,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
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
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: SL.accent,
    borderRadius: 999,
    backgroundColor: 'rgba(74,158,191,0.12)',
  },
  assignedChipText: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.accent,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  assignedChipRemove: { fontFamily: F.body, fontSize: 16, color: SL.muted, paddingLeft: 12 },
  workoutList: { flex: 1, marginBottom: 20 },
  workoutOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 12,
    backgroundColor: SL.bg,
  },
  workoutOptionSelected: {
    backgroundColor: 'rgba(74,158,191,0.12)',
    borderColor: SL.accent,
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

  // Stacked: workout info on top, action buttons centered below — so the buttons
  // never overflow the card the way a single side-by-side row did.
  workoutCard: {
    backgroundColor: SL.bg,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderLeftWidth: 4,
    borderLeftColor: SL.accent,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  workoutInfo: { flex: 1, gap: 2 },
  workoutTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  workoutTitle: {
    fontFamily: F.heading,
    fontSize: 19,
    color: SL.accent,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  typeTag: {
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1,
  },
  typeTagText: { fontFamily: F.bodyMed, fontSize: 10, letterSpacing: 1.5 },
  accDots: {
    flexDirection: 'row', gap: 3, marginTop: 3, justifyContent: 'center', flexWrap: 'wrap',
    position: 'absolute', bottom: 6, left: 0, right: 0,
  },
  accDot: {
    width: 5, height: 5, borderRadius: 999,
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 3,
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
    fontSize: 13,
    color: SL.muted,
    letterSpacing: 0.5,
  },

  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    flexShrink: 0,
  },
  // Compact action buttons so WORKOUT MODE + VIEW + MARK DONE fit one row.
  actionBtn: { paddingHorizontal: 12 },
  actionBtnText: { fontSize: 14, letterSpacing: 1 },
  // Shining ice-blue "completed" badge — replaces the action buttons once done.
  completedTag: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(74,158,191,0.12)',
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
  },
  completedTagText: {
    fontFamily: F.heading,
    fontSize: 15,
    color: SL.accent,
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
