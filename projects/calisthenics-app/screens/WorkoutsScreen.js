import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable,
  ActivityIndicator, RefreshControl, Modal, Animated, Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useCoach } from '../context/CoachContext';
import { computeLvl } from '../lib/computeLvl';
import { materializeDay, isDateOverridden, dedupeOverrideRows } from '../lib/schedule';
import { categoryMeta, categoryLabel, WORKOUT_CATEGORIES } from '../lib/workouts';
import { F } from '../constants/fonts';
import { useAppDimensions, NATIVE_SCALE } from '../constants/layout';

// EVERY typed workout wears its own type color — the same rule HomeScreen's
// missions follow, so a HANDSTAND session reads rose on the board, on the week
// strip and inside Workout Mode. Untyped/legacy rows return null = default ice.
const accentFor = (category) =>
  categoryLabel(category) ? categoryMeta(category).color : null;

import ScreenFrame from '../components/ScreenFrame';
import PillButton from '../components/PillButton';
import { useTourTarget } from '../lib/tourTargets';


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

// The edit modal is OUTSIDE ScaledRoot: App.js lays the native tree out on an
// oversized canvas and scales it back by NATIVE_SCALE, but a React Native
// <Modal> renders in its OWN window and does NOT inherit that transform, so
// every fixed pixel in the dialog came out 1/0.72 = 39% bigger than the app
// behind it -- which is why the per-date editor ate the screen and buried its
// buttons. Every fixed value in the modal styles is a canvas unit passed
// through s(). On web the modal is inside the zoomed root, so S is 1.
const MODAL_S = Platform.OS === 'web' ? 1 : NATIVE_SCALE;
const s = (n) => n * MODAL_S;

// The picker list is sized to the BIGGEST category, not the visible one, so the
// dialog keeps ONE frame while you flip between MAIN QUEST / SIDE QUEST / ...
// A short category just leaves empty space at the bottom - deliberately.
// Rows are a fixed height so that height is exact arithmetic, not a guess.
const EDIT_ROW_H   = s(56);
const EDIT_ROW_GAP = s(8);
const EDIT_MAX_ROWS = 6;   // beyond this the list scrolls instead of growing
const editListHeight = (rows) => {
  const n = Math.min(Math.max(rows, 1), EDIT_MAX_ROWS);
  return n * EDIT_ROW_H + (n - 1) * EDIT_ROW_GAP;
};

// ─── Direct action tile (player) ──────────────────────────────────────────────
// The player's Workouts screen skips the Training Forge swipe entirely — DAILY
// QUESTS and MY WORKOUTS are reached straight from here. A dark "system" panel
// with a bright static ice edge + glow halo and a tactile press punch (mirrors
// the old ForgeButton, kept when that hub was deleted).
function ActionTile({ label, onPress }) {
  const press = useRef(new Animated.Value(0)).current;
  const onIn  = () => Animated.spring(press, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  const onOut = () => Animated.spring(press, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 14 }).start();
  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] });
  return (
    <Pressable style={styles.actionTilePress} onPressIn={onIn} onPressOut={onOut} onPress={onPress}>
      <Animated.View style={[styles.actionTile, { transform: [{ scale }] }]}>
        <View pointerEvents="none" style={styles.actionTileInner} />
        <Text style={styles.actionTileText} numberOfLines={2}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

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
  // Elements the guided tour measures + points its arrow at (player mode only).
  const tourWeekRef       = useTourTarget('workouts.week');
  const tourMyWorkoutsRef = useTourTarget('workouts.myworkouts');
  const tourDailyRef      = useTourTarget('workouts.daily');
  const tourEditDayRef    = useTourTarget('workouts.editday');
  // Self player (CoachContext, seeded by SelfStudentSync) — passed to DailyQuest,
  // which is scoped by its `student` param. Only used in player mode.
  // `isAdmin` = we're under the coach-side CoachProvider (AdminNavigator).
  // WORKOUTS LIBRARY is coach-only: players never see the tile, and the route
  // isn't registered in their stack.
  const { selectedStudent, isAdmin } = useCoach();

  // ── Phone layout ──
  // The card is ALWAYS exactly as tall as the viewport, so on a phone the fixed
  // blocks (hero → tiles → week nav → week strip) eat the whole budget and the
  // stack collides — the week-range pill lands on the tiles and the day panel
  // rides up over the SUN→SAT strip. `compact` trims each fixed block (and the
  // type that drives its height) so everything keeps its own line.
  // NOT useWindowDimensions — on native that reports the device window while the
  // tree is laid out on the larger ScaledRoot canvas, which handed this screen
  // phone-sized styles on a 546x1182 canvas (web got the roomy ones). See
  // useAppDimensions in constants/layout.js.
  const { width: winW, height: winH } = useAppDimensions();
  const compact = winW < 560 || winH < 900;
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
  const [editFilter,     setEditFilter]     = useState('main'); // category key (MAIN QUEST default; no "ALL")

  // Optimistic per-date edits: dateStr → ordered workout-id list to show RIGHT NOW,
  // before the slow materialize + DB write + refetch chain finishes. Keeps the
  // add/remove UI instant instead of frozen for the round-trip. Cleared once the
  // real data catches up. `editSeq` tags each date's latest op so a stale op's
  // cleanup never wipes a newer optimistic value.
  const [optimisticDays, setOptimisticDays] = useState({});
  const editSeq  = useRef({});
  const editChain = useRef(Promise.resolve());

  const [weekOffset, setWeekOffset] = useState(0);
  const weekDays = useMemo(() => getWeekDays(weekOffset), [weekOffset]);

  const [selectedDay, setSelectedDay] = useState(
    () => getWeekDays(0).find(d => d.dateStr === TODAY_STR) ?? getWeekDays(0)[0]
  );

  // ── HUD chrome (entrance removed) ──
  // The staggered boot-up was retired when tab swiping landed: the neighbouring
  // page is VISIBLE mid-drag (before focus fires), so the chrome must sit fully
  // built at all times — values live at 1 and never replay. The Animated.Values
  // are kept (at rest) because the entrance layout still binds to them.
  const boot = useRef({
    header:  new Animated.Value(1),
    divider: new Animated.Value(1),
    forge:   new Animated.Value(1),
    nav:     new Animated.Value(1),
    cells:   Array.from({ length: 7 }, () => new Animated.Value(1)),
    panel:   new Animated.Value(1),
  }).current;

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
      setOverrideWorkouts(dedupeOverrideRows(overridesRes.data ?? []));
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
    const resolved = resolveDayWorkouts(day);
    // An in-flight optimistic edit for this date overrides what the DB currently
    // says, so add/remove shows immediately. Reuse the resolved rows (to keep
    // completion state) and synthesize a placeholder for a freshly-added workout.
    const opt = optimisticDays[day.dateStr];
    if (!opt) return resolved;
    const byId = Object.fromEntries(resolved.map(r => [r.id, r]));
    return opt
      .map(id => {
        if (byId[id]) return byId[id];
        const w = workoutsById[id];
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
          fromTemplate:   false,
        };
      })
      .filter(Boolean);
  }

  function resolveDayWorkouts(day) {
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
    [selectedDay, overrideWorkouts, templateRows, workoutsById, optimisticDays]
  );

  const activeDailyIds = useMemo(() => new Set(dailyQuestIds), [dailyQuestIds]);

  // ── Edit-modal ADD WORKOUT picker ──────────────────────────────────────────
  // Candidates = workouts not already on the selected date, bucketed by TYPE so
  // the modal offers the same MAIN/SIDE/ACCESSORIES filter as My Workouts.
  const editCatKey = (w) => w?.category && WORKOUT_CATEGORIES.some(c => c.k === w.category)
    ? w.category
    : '__none';
  const { editCandidates, editCats, editCounts } = useMemo(() => {
    const editCandidates = allWorkouts.filter(w => !selectedDayWorkouts.some(dw => dw.id === w.id));
    const editCounts = {};
    for (const w of editCandidates) {
      const k = editCatKey(w);
      editCounts[k] = (editCounts[k] ?? 0) + 1;
    }
    const editCats = [...WORKOUT_CATEGORIES.map(c => c.k), '__none'].filter(k => editCounts[k]);
    return { editCandidates, editCats, editCounts };
  }, [allWorkouts, selectedDayWorkouts]);
  // The picker has NO "ALL" — it always shows exactly one TYPE (default MAIN QUEST).
  // Fall back to the first available type when the current filter has nothing on
  // offer (e.g. no main-quest candidates on this day), so the list is never blank.
  const editDefaultFilter = editCats.includes('main') ? 'main' : (editCats[0] ?? 'main');
  const editActiveFilter = editCats.includes(editFilter) ? editFilter : editDefaultFilter;
  const editVisibleWorkouts = editCandidates.filter(w => editCatKey(w) === editActiveFilter);
  // Tallest category on offer - the picker reserves room for THAT many rows.
  const editMaxRows = editCats.reduce((m, k) => Math.max(m, editCounts[k] ?? 0), 1);

  // Switch the picker filter; drop a pending pick the new filter would hide.
  function pickEditFilter(k) {
    setEditFilter(k);
    if (editPending && editCatKey(editPending) !== k) setEditPending(undefined);
  }

  // ── Per-date materialization ───────────────────────────────────────────────

  // Dates known to already have override rows. Mirrors overrideWorkouts, but is a
  // synchronous ref so two edits queued on the same not-yet-materialized day (before
  // any refetch lands) can't BOTH materialize it — materializeDay isn't idempotent.
  const materializedRef = useRef(new Set());
  useEffect(() => {
    materializedRef.current = new Set(overrideWorkouts.map(o => o.specific_date));
  }, [overrideWorkouts]);

  // Ensure a date has its own override rows (copying the weekday's skeleton in the
  // first time it's touched), so completion / edits can attach to that date.
  async function ensureMaterialized(dateStr) {
    if (materializedRef.current.has(dateStr) || isDateOverridden(dateStr, overrideWorkouts)) return;
    materializedRef.current.add(dateStr);  // claim synchronously before the awaits
    const tid = await resolveTargetId();
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    const ids = templateRows.filter(t => t.day_of_week === dow).map(t => t.workout_id);
    await materializeDay({ studentId: tid, coachId: tid, dateStr, templateWorkoutIds: ids });
  }


  // ── Per-date editing (override the weekly skeleton for one date) ────────────

  // Run a per-date DB mutation in the background while the UI already shows the
  // optimistic result. Writes are serialized (editChain) so two quick edits on a
  // template-derived day can't both try to materialize it. `nextIds` is what the
  // date should show; it's cleared once the mutation + refetch land, unless a newer
  // edit for the same date has superseded it.
  function runDayEdit(dateStr, nextIds, mutate) {
    const seq = (editSeq.current[dateStr] = (editSeq.current[dateStr] ?? 0) + 1);
    setEditPending(undefined);
    setOptimisticDays(prev => ({ ...prev, [dateStr]: nextIds }));  // instant feedback
    const run = editChain.current.then(async () => {
      try {
        await mutate();
        await fetchData();
      } catch (e) {
        alert('Error: ' + (e.message ?? 'Something went wrong.'));
        await fetchData().catch(() => {});
      } finally {
        // Only drop the overlay if this is still the latest edit for the date.
        if (editSeq.current[dateStr] === seq) {
          setOptimisticDays(prev => {
            const next = { ...prev };
            delete next[dateStr];
            return next;
          });
        }
      }
    });
    editChain.current = run.catch(() => {});
    return run;
  }

  function addWorkoutToDate(dateStr, workoutId) {
    const current = getDayWorkouts(selectedDay).map(w => w.id);
    const nextIds = current.includes(workoutId) ? current : [...current, workoutId];
    return runDayEdit(dateStr, nextIds, async () => {
      const tid = await resolveTargetId();
      await ensureMaterialized(dateStr);  // copy skeleton first so siblings are kept
      // ensureMaterialized may have JUST copied this very workout in from the
      // weekday skeleton, and the picker's "not already on this date" check ran
      // against the pre-materialize UI state. Inserting blind on top of that is
      // how a day ended up listing the same mission twice. Ask the date what it
      // holds now, and only add what's actually missing.
      const { data: onDate, error: readErr } = await supabase
        .from('workout_override_workouts')
        .select('workout_id')
        .eq('student_id', tid)
        .eq('specific_date', dateStr);
      if (readErr) throw new Error(readErr.message);
      if ((onDate ?? []).some(r => r.workout_id === workoutId)) return;
      const { error } = await supabase
        .from('workout_override_workouts')
        .insert({ student_id: tid, coach_id: tid, specific_date: dateStr, workout_id: workoutId });
      if (error) throw new Error(error.message);
    });
  }

  function removeWorkoutFromDate(day, workout) {
    const nextIds = getDayWorkouts(day).map(w => w.id).filter(id => id !== workout.id);
    return runDayEdit(day.dateStr, nextIds, async () => {
      const tid = await resolveTargetId();
      // Template-derived day: materialize first so removing one keeps the others.
      if (!workout.overrideId) await ensureMaterialized(day.dateStr);
      const { error } = await supabase
        .from('workout_override_workouts')
        .delete()
        .eq('student_id', tid)
        .eq('specific_date', day.dateStr)
        .eq('workout_id', workout.id);
      if (error) throw new Error(error.message);
    });
  }

  // Drop all per-date overrides for a date → it falls back to the weekly skeleton.
  function resetDayToPlan(dateStr) {
    // Optimistically show the weekday skeleton the date will fall back to.
    const day = weekDays.find(d => d.dateStr === dateStr) ?? selectedDay;
    const dow = day.date.getDay();
    const nextIds = templateRows.filter(t => t.day_of_week === dow).map(t => t.workout_id);
    setEditVisible(false);
    return runDayEdit(dateStr, nextIds, async () => {
      const tid = await resolveTargetId();
      const { error } = await supabase
        .from('workout_override_workouts')
        .delete()
        .eq('student_id', tid)
        .eq('specific_date', dateStr);
      if (error) throw new Error(error.message);
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  // The full layout ALWAYS renders inside a fixed-size card (matching the Weekly
  // Plan), so the frame never resizes with data or while loading — the spinner
  // shows inside the day panel.

  return (
    <ScreenFrame fill ready={!loading}>
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
      <Animated.View style={[styles.header, compact && styles.headerCompact, {
        opacity: boot.header,
        transform: [{ translateY: boot.header.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
      }]}>
        <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.studentName, compact && styles.studentNameCompact]}>
          {profile?.full_name?.toUpperCase() ?? '—'}
        </Text>
        <View style={styles.statRow}>
          <Text style={[styles.level, compact && styles.levelCompact]}>LVL {lvl ?? '—'}</Text>
          {className && (
            <>
              <View style={styles.statDot} />
              <Text style={[styles.className, compact && styles.classNameCompact]}>{className.toUpperCase()}</Text>
            </>
          )}
        </View>
        {/* Ice divider scans out from its center as the headline settles. */}
        <Animated.View style={[styles.headerDivider, { transform: [{ scaleX: boot.divider }] }]} />
      </Animated.View>

      {/* Everything below the hero. The hero itself stays put above. */}
      <View style={styles.swipeBody}>

      {/* ── Training console ──
          DAILY QUESTS and MY WORKOUTS are reached DIRECTLY from here by both
          roles. The old admin-only TRAINING FORGE → Manage swipe was retired
          2026-08-13 (Accessories + the weekly-skeleton editor went with it).
          WORKOUTS LIBRARY is the one COACH-ONLY tile — players have no permission
          for it, so it renders only under the admin CoachProvider. */}
      <Animated.View style={[styles.manageRow, styles.actionTileRow, compact && styles.manageRowCompact, {
        opacity: boot.forge,
        transform: [
          { translateY: boot.forge.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) },
          { scale: boot.forge.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
        ],
      }]}>
        <View ref={tourDailyRef} collapsable={false} style={styles.actionTileWrap}>
          <ActionTile
            label="DAILY QUESTS"
            onPress={() => navigation.navigate('DailyQuest', { student: selectedStudent })}
          />
        </View>
        <View ref={tourMyWorkoutsRef} collapsable={false} style={styles.actionTileWrap}>
          <ActionTile
            label="MY WORKOUTS"
            onPress={() => navigation.navigate('AllWorkouts')}
          />
        </View>
        {isAdmin && (
          <View style={styles.actionTileWrap}>
            <ActionTile
              label="WORKOUTS LIBRARY"
              onPress={() => navigation.navigate('EliteWorkouts')}
            />
          </View>
        )}
      </Animated.View>

      {/* ── Week nav ── */}
      <Animated.View style={[styles.calendarNav, compact && styles.calendarNavCompact, {
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
            <Text numberOfLines={1} style={[styles.navRange, compact && styles.navRangeCompact]}>{fmtWeekRange(weekDays)}</Text>
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
      {/* Outer keeps the 28px side inset; the tour highlights the INNER row so its
          box hugs SUN→SAT (the day cells) instead of spanning the full padded width. */}
      <View style={[styles.calendarGrid, compact && styles.calendarGridCompact]}>
       <View ref={tourWeekRef} collapsable={false} style={styles.calendarRow}>
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
                compact && styles.dayNodeCompact,
                isToday && !isSelected && styles.dayNodeToday,
                isSelected && styles.dayNodeSelected,
                allDone && styles.dayNodeDone,
              ]}
              onPress={() => setSelectedDay(day)}
              activeOpacity={0.75}
            >
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                adjustsFontSizeToFit
                style={[
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
      </View>

      {/* ── Day detail panel ── */}
      <Animated.View style={[styles.dayCard, compact && styles.dayCardCompact, {
        opacity: boot.panel,
        transform: [{ translateY: boot.panel.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
      }]}>
        <View style={styles.dayCardHead}>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.dayCardDate, compact && styles.dayCardDateCompact]}>{fmtDisplayDate(selectedDay?.dateStr)}</Text>
          <View ref={tourEditDayRef} collapsable={false} style={styles.dayCardEditBtn}>
            <PillButton
              label="✎ EDIT DAY"
              size="sm"
              onPress={() => { setEditPending(undefined); setEditFilter(editDefaultFilter); setEditVisible(true); }}
            />
          </View>
        </View>

        <ScrollView
          style={styles.dayCardScroll}
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
            const hasUnreadFeedback = workout.coachFeedback && !workout.feedbackIsRead;
            const tc        = accentFor(workout.category); // type glow, null when untyped

            /* The board only REPRESENTS the week's training — ticking off and
               undoing live on HomeScreen's missions, which is the one place a
               session is completed. So no DONE / UNDO / COMPLETED badge here:
               the row is a title, its type color, and a small ✓ when it's behind
               you. Tapping it opens the workout (the old VIEW pill). */
            return (
              <TouchableOpacity
                key={workout.id}
                style={[
                  styles.workoutCard,
                  // Done or not, the card wears its OWN type color — a finished
                  // HANDSTAND stays rose instead of flipping to the ice theme.
                  tc && {
                    borderColor: workout.completed ? tc : tc + '66',
                    borderLeftColor: tc,
                    shadowColor: tc,
                    shadowOpacity: 0.4,
                    shadowRadius: 8,
                  },
                ]}
                onPress={() => navigation.navigate('WorkoutDetail', {
                  workout,
                  studentView: true,
                })}
                activeOpacity={0.8}
              >
                <View style={styles.workoutInfo}>
                  <View style={styles.workoutTitleRow}>
                    {/* Title only — the purpose/description is read in Workout
                        Mode, in full, so the board stays a clean list. */}
                    <Text
                      style={[
                        styles.workoutTitle,
                        tc && { color: tc },
                        workout.completed && styles.workoutTitleDone,
                      ]}
                      numberOfLines={2}
                    >
                      {workout.title?.toUpperCase()}
                    </Text>
                    {hasUnreadFeedback && <View style={styles.feedbackDot} />}
                  </View>
                </View>

                {/* The whole "completed" statement: one small check in the row's
                    own colour. No shimmer, no badge — nothing to celebrate twice. */}
                {workout.completed && (
                  <Text style={[styles.workoutDoneMark, tc && { color: tc }]}>✓</Text>
                )}
              </TouchableOpacity>
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

      {/* The panel is sized by its sessions, not by the screen. Whatever height is
          left over lands HERE, below the card, instead of inflating an empty
          panel that swallowed ~70% of the phone. */}
      <View style={styles.bodySpacer} />

      </View>

      {/* ── Per-date edit modal ── */}
      <Modal
        visible={editVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEditVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.editorBox}>
            <Text
              style={styles.editorTitle}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              EDIT · {fmtDisplayDate(selectedDay?.dateStr)}
            </Text>
            {/* Current workouts for this date */}
            {selectedDayWorkouts.length > 0 && (
              <>
                <Text style={styles.editorSectionLabel}>CURRENTLY</Text>
                <View style={styles.assignedChips}>
                  {selectedDayWorkouts.map(w => (
                    <View key={w.id} style={styles.assignedChip}>
                      <Text style={styles.assignedChipText} numberOfLines={2}>{w.title?.toUpperCase()}</Text>
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

            {/* Type filter pills — same MAIN/SIDE/ACCESSORIES split as My Workouts;
                only shown when more than one type is on offer. */}
            {editCats.length > 1 && (
              <View style={styles.editFilterRow}>
                {editCats.map(k => {
                    const m = categoryMeta(k);
                    return { k, l: m.l, color: m.color, n: editCounts[k] };
                }).map(c => {
                  const active = editActiveFilter === c.k;
                  return (
                    <TouchableOpacity
                      key={c.k}
                      style={[
                        styles.editFilterChip,
                        active && { borderColor: c.color, backgroundColor: c.color + '22', shadowColor: c.color },
                      ]}
                      onPress={() => pickEditFilter(c.k)}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.editFilterDot, { backgroundColor: c.color, opacity: active ? 1 : 0.45 }]} />
                      <Text
                        style={[styles.editFilterText, active && { color: c.color }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.75}
                      >
                        {c.l}
                      </Text>
                      <Text style={[styles.editFilterCount, active && { color: c.color }]}>{c.n}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <ScrollView
              style={[styles.workoutList, { height: editListHeight(editMaxRows) }]}
              showsVerticalScrollIndicator={false}
            >
              {editVisibleWorkouts.map(w => {
                const meta = categoryMeta(editCatKey(w));
                return (
                  <TouchableOpacity
                    key={w.id}
                    style={[styles.workoutOption, editPending?.id === w.id && styles.workoutOptionSelected]}
                    onPress={() => setEditPending(w)}
                  >
                    <View style={[styles.workoutOptionDot, { backgroundColor: meta.color }]} />
                    <Text
                      style={[styles.workoutOptionText, editPending?.id === w.id && { color: SL.accent }]}
                      numberOfLines={2}
                    >
                      {w.title}
                    </Text>
                    {editPending?.id === w.id && <Text style={styles.checkMark}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
              {allWorkouts.length === 0 ? (
                <Text style={styles.noWorkoutsText}>No workouts yet. Create one from Manage My Training.</Text>
              ) : editVisibleWorkouts.length === 0 ? (
                <Text style={styles.noWorkoutsText}>Nothing of this type left to add.</Text>
              ) : null}
            </ScrollView>

            <View style={styles.editorButtons}>
              <PillButton
                label="CLOSE"
                tone="muted"
                size="sm"
                onPress={() => setEditVisible(false)}
                style={styles.editorBtn}
                textStyle={styles.editorBtnText}
              />
              <PillButton
                label="ADD"
                variant="solid"
                size="sm"
                onPress={() => editPending && addWorkoutToDate(selectedDay.dateStr, editPending.id)}
                disabled={!editPending}
                style={styles.editorBtn}
                textStyle={styles.editorBtnText}
              />
              {(isDateOverridden(selectedDay?.dateStr, overrideWorkouts) ||
                optimisticDays[selectedDay?.dateStr]) && (
                <PillButton
                  label="↺ RESET"
                  tone="muted"
                  size="sm"
                  onPress={() => resetDayToPlan(selectedDay.dateStr)}
                  style={styles.editorBtn}
                  textStyle={styles.editorBtnText}
                />
              )}
            </View>
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
  card: { flex: 1 },

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
    flexShrink: 0,
  },
  // Phone: the hero keeps its shape but gives ~60px back to the day panel.
  headerCompact: { paddingTop: 22, paddingBottom: 10 },
  studentNameCompact: { fontSize: 30, letterSpacing: 2, textShadowRadius: 12 },
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
  levelCompact: { fontSize: 19, letterSpacing: 2 },
  level: {
    fontFamily: F.body,
    fontSize: 26,
    color: SL.text,
    letterSpacing: 3,
  },
  classNameCompact: { fontSize: 16, letterSpacing: 2 },
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
    zIndex: 4,
    flexDirection: 'row',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginTop: 18,
    flexShrink: 0,
  },
  // Phone: shorter tiles, tighter gap to the hero.
  manageRowCompact: { marginTop: 16, marginHorizontal: 12 },
  // Player two-up direct actions (DAILY QUESTS / MY WORKOUTS) — same footprint as
  // the single forge button so the calendar below never shifts.
  actionTileRow: {
    justifyContent: 'flex-start',
    gap: 8,
  },
  // Wrapper so the guided tour can measure each tile. It is a COLUMN, so its
  // children must NOT use `flex: 1`: flex-basis 0 inside an auto-height column
  // collapses to 0 on Yoga/native (web resolves it from content, which is why
  // this only ever broke in the APK — the tile drew 62dp tall while the row
  // measured 0, so the week nav, the SUN→SAT strip and the day panel all rode
  // up ~62dp and stacked on top of each other). `alignSelf: stretch` fills the
  // width; the height comes from the tile's own minHeight.
  actionTileWrap: { flex: 1 },
  actionTilePress: { alignSelf: 'stretch' },
  actionTile: {
    alignSelf: 'stretch',
    minHeight: 62,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: '#5AC8FA',          // bright static ice edge
    backgroundColor: '#0a1626',
    shadowColor: '#5AC8FA',          // matching glow halo
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
  },
  // Faint brighter hairline just inside the edge → a "polished glass" sheen.
  actionTileInner: {
    position: 'absolute',
    top: 2, left: 2, right: 2, bottom: 2,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(159,228,255,0.25)',
  },
  actionTileText: {
    fontFamily: F.heading,
    fontSize: 15,
    lineHeight: 19,
    color: '#FFFFFF',
    letterSpacing: 0.5,
    textAlign: 'center',
    textShadowColor: SL.accent,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  // ── Week nav ────────────────────────────────────────────────────────────────

  calendarNav: {
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    // Match the week strip's inset (calendarGrid) so the ← / → arrows keep the
    // same space from the frame border instead of clipping against it.
    paddingHorizontal: 28,
    paddingTop: 16,
    paddingBottom: 10,
    flexShrink: 0,
  },
  // Phone: the ← RANGE → row sits closer under the tiles but keeps a real gap,
  // so the range pill can never land on top of DAILY QUESTS / MY WORKOUTS.
  calendarNavCompact: { paddingHorizontal: 12, paddingTop: 18, paddingBottom: 12 },
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
    maxWidth: '100%',
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: SL.border,
    backgroundColor: 'rgba(74,158,191,0.06)',
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  navRangeCompact: { fontSize: 15, letterSpacing: 0 },
  navRange: {
    fontFamily: F.bodyMed,
    fontSize: 24,
    color: SL.accent,
    letterSpacing: 0.5,
  },

  // ── Calendar grid ────────────────────────────────────────────────────────────

  calendarGridCompact: { paddingHorizontal: 12 },
  calendarGrid: {
    zIndex: 2,
    paddingBottom: 10,
    // Align the week strip's outer edges with the session node inside dayCard
    // (dayCard margin 8 + border 1.5 + padding 20 ≈ 29), so it sits on the same
    // line as the workout card and leaves breathing room to the frame border.
    paddingHorizontal: 28,
    flexShrink: 0,
  },
  // The actual SUN→SAT day-cell row (tour-highlighted). Kept separate from the
  // padded wrapper so the highlight box hugs the cells, not the full padded width.
  calendarRow: {
    flexDirection: 'row',
    gap: 6,
    flexShrink: 0,
  },
  dayNode: {
    flex: 1,
    minHeight: 104,
    backgroundColor: SL.panel,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: SL.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 10,
    // Reserved lane at the bottom of every cell for the accent dots, so they are
    // never crowded by the day number above them.
    paddingBottom: 22,
    paddingHorizontal: 4,
    gap: 2,
    overflow: 'hidden',
  },
  // Phone: a shorter cell — the week strip must stay fully visible above the panel.
  dayNodeCompact: { minHeight: 96, paddingTop: 10, paddingBottom: 20, borderRadius: 10 },
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
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  dayLabelSel: { color: SL.accent },
  dayLabelDone: { color: SL.accent },
  dayNum: {
    fontFamily: F.heading,
    fontSize: 28,
    color: SL.text,
    lineHeight: 32,
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
    zIndex: 1,
    marginHorizontal: 8,
    marginTop: 64,            // the panel sits LOW — a wide, deliberate gap under the week strip
    // The panel takes the whole lower half of the card rather than ending where
    // its sessions end — the leftover space reads as part of the panel instead of
    // as dead screen. flexShrink lets a packed day scroll inside it.
    flexGrow: 1,
    flexShrink: 1,
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
  // Phone: the panel starts a clear gap BELOW the week strip (it used to ride up
  // over the day cells) and trims its own padding to win that space back.
  dayCardCompact: { marginTop: 84, marginHorizontal: 6, padding: 14, gap: 8 },
  // Auto-height inside an auto-height card: flex:1 here would collapse the list.
  dayCardScroll: { flexGrow: 0, flexShrink: 1 },
  // Sessions stack from the top (first one highest); only the REST placeholder centers.
  dayCardBody: { gap: 10, justifyContent: 'flex-start' },
  dayCardBodyEmpty: { justifyContent: 'center' },
  // Soaks up the height the panel no longer claims, so the card ends where its
  // sessions end and the rest of the screen simply breathes.
  bodySpacer: { flexGrow: 1, flexShrink: 0, minHeight: 12 },
  // Date on the left, EDIT DAY pill on the right — a clean row, never overlapping.
  dayCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 36,
  },
  dayCardDateCompact: { fontSize: 22 },
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
    paddingHorizontal: s(30),
  },
  editorBox: {
    width: '100%',
    maxWidth: s(560),
    // No fixed height: the dialog is as tall as its content (the picker list
    // shrinks to fit), so a short list no longer leaves half the box empty.
    maxHeight: '88%',       // ...but never taller than the viewport
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: s(18),
    padding: s(20),
    paddingBottom: s(20),
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
  },
  editorTitle: {
    fontFamily: F.heading,
    fontSize: s(22),
    color: SL.accent,
    letterSpacing: s(2),
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: s(14),
  },
  editorSectionLabel: {
    fontFamily: F.bodyMed,
    fontSize: s(14),
    color: SL.muted,
    letterSpacing: s(2),
    textTransform: 'uppercase',
    marginBottom: s(9),
  },
  assignedChips: { gap: s(6), marginBottom: s(14) },
  assignedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: s(8),
    paddingHorizontal: s(14),
    borderWidth: 1,
    borderColor: SL.accent,
    borderRadius: 999,
    backgroundColor: 'rgba(74,158,191,0.12)',
  },
  assignedChipText: {
    flex: 1,
    fontFamily: F.bodyMed,
    fontSize: s(18),
    color: SL.accent,
    letterSpacing: s(0.6),
    textTransform: 'uppercase',
  },
  assignedChipRemove: { fontFamily: F.body, fontSize: s(15), color: SL.muted, paddingLeft: s(10) },
  // Type filter pills above the ADD WORKOUT picker (same look as My Workouts,
  // sized down to fit the modal).
  editFilterRow: { flexDirection: 'row', flexWrap: 'nowrap', gap: s(4), marginBottom: s(12) },
  editFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    justifyContent: 'center',
    gap: s(4),
    paddingHorizontal: s(7),
    height: s(27),
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: SL.border,
    backgroundColor: SL.bg,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
  },
  editFilterDot: { width: s(6), height: s(6), borderRadius: 999, flexShrink: 0 },
  editFilterText: {
    fontFamily: F.bodyMed,
    fontSize: s(11),
    color: SL.muted,
    letterSpacing: s(0.2),
  },
  editFilterCount: {
    fontFamily: F.heading,
    fontSize: s(11),
    color: SL.muted,
    letterSpacing: s(0.5),
    flexShrink: 0,
  },

  // Height comes from editListHeight() at the call site (the largest category's
  // row count), so the dialog's frame never resizes as you switch filters.
  workoutList: { flexGrow: 0, flexShrink: 1, marginBottom: s(16) },
  workoutOption: {
    flexDirection: 'row',
    alignItems: 'center',
    height: EDIT_ROW_H,
    paddingHorizontal: s(14),
    marginBottom: EDIT_ROW_GAP,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: s(10),
    backgroundColor: SL.bg,
  },
  workoutOptionSelected: {
    backgroundColor: 'rgba(74,158,191,0.12)',
    borderColor: SL.accent,
  },
  workoutOptionDot: { width: s(8), height: s(8), borderRadius: 999, marginRight: s(10) },
  workoutOptionText: {
    flex: 1,
    fontFamily: F.bodyMed,
    fontSize: s(19),
    lineHeight: s(22),
    color: SL.text,
    letterSpacing: s(0.4),
    textTransform: 'uppercase',
  },
  checkMark: { fontFamily: F.bodyMed, fontSize: s(19), color: SL.accent, marginLeft: s(8) },
  noWorkoutsText: {
    fontFamily: F.bodyMed,
    fontSize: s(15),
    color: SL.muted,
    letterSpacing: s(0.5),
    textAlign: 'center',
    marginVertical: s(16),
    lineHeight: s(21),
  },
  editorButtons: { flexDirection: 'row', gap: s(9) },
  // The dialog's own pill metrics - PillButton's own sizes are tuned for canvas
  // units, so the modal passes padding/text through s() to match its density.
  editorBtn: { flex: 1, paddingVertical: s(11), paddingHorizontal: s(8) },
  editorBtnText: { fontSize: s(14), letterSpacing: s(1) },

  // Stacked: workout info on top, action buttons centered below — so the buttons
  // never overflow the card the way a single side-by-side row did.
  workoutCard: {
    backgroundColor: SL.bg,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderLeftWidth: 4,
    borderLeftColor: SL.accent,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  workoutInfo: { flex: 1, gap: 1 },
  workoutTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  workoutTitle: {
    fontFamily: F.heading,
    fontSize: 17,
    lineHeight: 20,
    color: SL.accent,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  accDots: {
    flexDirection: 'row', gap: 4, marginTop: 3, justifyContent: 'center', flexWrap: 'wrap',
    position: 'absolute', bottom: 8, left: 0, right: 0,
  },
  accDot: {
    width: 7, height: 7, borderRadius: 999,
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 3,
  },
  feedbackDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: SL.gold,
    flexShrink: 0,
  },
  // A cleared row is struck through and quieted IN ITS OWN COLOUR — the same
  // "done" language as HomeScreen's missions and the daily quests.
  workoutTitleDone: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  workoutDoneMark: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.accent,
    opacity: 0.85,
    flexShrink: 0,
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
