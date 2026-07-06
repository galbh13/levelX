import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable,
  ActivityIndicator, Animated, Easing, Dimensions,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useCoach } from '../context/CoachContext';
import { F } from '../constants/fonts';
import { DAY_LABELS } from '../lib/schedule';
import { computeLvl } from '../lib/computeLvl';
import { categoryMeta } from '../lib/workouts';
import ScreenFrame from '../components/ScreenFrame';
import PillButton from '../components/PillButton';
import { CARD_H, CARD_W } from '../constants/layout';

// Off-program ACCESSORIES / LEGS workouts glow in their type color; the dated
// program keeps the default ice theme. Returns a color or null (= default).
const accentFor = (category) =>
  (category === 'accessory' || category === 'legs') ? categoryMeta(category).color : null;

// ─── Glowing action tile ──────────────────────────────────────────────────────
// A dark "system" panel with a STATIC bright ice-edge + glow halo (no moving
// shimmer) and a glowing label, plus a tactile press punch. No icons.
function ForgeButton({ label, onPress }) {
  const press = useRef(new Animated.Value(0)).current;
  const onIn  = () => Animated.spring(press, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  const onOut = () => Animated.spring(press, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 14 }).start();
  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] });
  return (
    <Pressable style={{ flex: 1 }} onPressIn={onIn} onPressOut={onOut} onPress={onPress}>
      <Animated.View style={[styles.forgeBtn, { transform: [{ scale }] }]}>
        {/* a brighter inner hairline for a "polished glass" edge */}
        <View pointerEvents="none" style={styles.forgeBtnInner} />
        <Text style={styles.forgeBtnText} numberOfLines={2}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

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

// Full window width — how far the body slides in from the right on entrance.
const WIN_W = Dimensions.get('window').width;
// Shared swipe duration — matches WorkoutsScreen so both directions feel identical.
const SWIPE_MS = 300;

// Current weekday (0=Sun … 6=Sat) — highlighted in the grid like Workouts' "today".
const TODAY_DOW = new Date().getDay();

// ─── Screen ───────────────────────────────────────────────────────────────────
// "Manage My Training" — the recurring WEEKLY SKELETON editor. Assign default
// workout(s) to each weekday (Sun–Sat). No dates, no completion here: those live
// on the dated Workouts screen, which fills each real date from this skeleton and
// lets specific days be overridden. Writes `weekly_workout_template`.

export default function StudentDetailScreen({ navigation, route }) {
  const { selectedStudent: student, setSelectedDay: setContextDay } = useCoach();

  // Data
  const [templateRows,    setTemplateRows]    = useState([]);  // weekly_workout_template rows
  const [studentWorkouts, setStudentWorkouts] = useState([]);  // all workouts for this player
  // Seed from the values the Workouts screen already had (passed on navigate) so
  // the header shows LVL · CLASS immediately — the fetch below just reconfirms them.
  const [lvl,             setLvl]             = useState(route?.params?.lvl ?? 0);
  const [className,       setClassName]       = useState(route?.params?.className ?? null);
  const [loading,         setLoading]         = useState(true);

  // Selected weekday (0=Sun … 6=Sat) — default today's weekday.
  const [selectedDow, setSelectedDow] = useState(() => new Date().getDay());

  // ── Entrance swipe (ONLY when arriving from the Workouts → Forge press) ──
  // The body slides in from the right while the headline stays put, continuing the
  // Workouts swipe. Gated on the `fromForge` param and run on mount only, so
  // returning here from a child screen (Create/Library/Quests) does NOT replay it.
  // Captured ONCE at mount: did we arrive via the Workouts → Forge swipe? Gates
  // both the entrance slide-in and the BACK swipe-out to that specific flow.
  const cameFromForge = useRef(route?.params?.fromForge === true).current;
  const enterAnim = useRef(new Animated.Value(cameFromForge ? 0 : 1)).current;
  const backingRef = useRef(false);
  useEffect(() => {
    if (!cameFromForge) return;
    const anim = Animated.timing(enterAnim, {
      toValue: 1, duration: SWIPE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    anim.start();
    // Consume the flag so it can't replay on a later focus.
    navigation.setParams({ fromForge: undefined });
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const enterBodyX = enterAnim.interpolate({ inputRange: [0, 1], outputRange: [WIN_W, 0] });
  const enterBodyO = enterAnim.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 1, 1] });

  // BACK: swipe the body right (reverse of the entrance) then pop. Only for the
  // Forge flow; other entries just go back normally. We re-arm `fromForge` so the
  // pop's own transition is 'none' — leaving ONLY our swipe (and no hologram, since
  // the Workouts screen underneath is already mounted, not rebuilt).
  const onBack = useCallback(() => {
    if (!cameFromForge) { navigation.goBack(); return; }
    if (backingRef.current) return;
    backingRef.current = true;
    navigation.setParams({ fromForge: true });
    Animated.timing(enterAnim, {
      toValue: 0, duration: SWIPE_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) navigation.goBack();
    });
  }, [cameFromForge, enterAnim, navigation]);

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
          .select('id, title, purpose, category')
          .eq('assigned_to', student.id)
          .order('title', { ascending: true }),
      ]);

      if (templateRes.error) console.error('[StudentDetail] template:', templateRes.error);
      if (workoutsRes.error) console.error('[StudentDetail] workouts:', workoutsRes.error);

      setTemplateRows(templateRes.data ?? []);
      setStudentWorkouts(workoutsRes.data ?? []);

      // Hero headline data — LVL + CLASS, matching the Workouts screen header.
      const { data: prof } = await supabase
        .from('profiles')
        .select('class_id')
        .eq('id', student.id)
        .single();
      if (prof?.class_id) {
        const [{ data: classData }, lvlVal] = await Promise.all([
          supabase.from('classes').select('name').eq('id', prof.class_id).maybeSingle(),
          computeLvl(student.id, prof.class_id),
        ]);
        setClassName(classData?.name ?? null);
        setLvl(lvlVal ?? 0);
      } else {
        setClassName(null);
        setLvl(0);
      }
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

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!student) {
    return (
      <ScreenFrame maxWidth={CARD_W} holoEntry={false}>
        <View style={{ paddingVertical: 120, alignItems: 'center', gap: 16 }}>
          <Text style={{ fontFamily: F.body, color: SL.text, fontSize: 14, letterSpacing: 1 }}>
            No student selected.
          </Text>
          <PillButton label="← GO BACK" onPress={() => navigation.goBack()} />
        </View>
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame maxWidth={CARD_W} ready={!loading} holoEntry={false}>
      <View style={styles.card}>
      {/* Hero header — matches the Workouts screen: white shining name + LVL · CLASS. */}
      <View style={styles.header}>
        <View style={styles.backRow}>
          <PillButton label="← BACK" size="sm" onPress={onBack} />
        </View>
        <View style={styles.accessoriesRow}>
          <PillButton
            label="ACCESSORIES"
            size="sm"
            tone="gold"
            onPress={() => navigation.navigate('WeeklyAccessories')}
          />
        </View>
        <Text style={styles.studentName}>
          {student.full_name?.toUpperCase() ?? '—'}
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
        <View style={styles.headerDivider} />
      </View>

      <Animated.View style={[styles.body, { transform: [{ translateX: enterBodyX }], opacity: enterBodyO }]}>
        {/* All four actions in one forge-styled row. */}
        <View style={styles.actionRow}>
          <ForgeButton
            label="DAILY QUESTS"
            onPress={() => navigation.navigate('DailyQuest', { student })}
          />
          <ForgeButton
            label="WORKOUTS LIBRARY"
            onPress={() => navigation.navigate('EliteWorkouts')}
          />
          <ForgeButton
            label="CREATE WORKOUT"
            onPress={() => {
              setContextDay({ label: DAY_LABELS[selectedDow], dayOfWeek: selectedDow });
              navigation.navigate('CreateWorkout');
            }}
          />
          <ForgeButton
            label="MY WORKOUTS"
            onPress={() => navigation.navigate('AllWorkouts')}
          />
        </View>

            {/* Weekday skeleton — SUN…SAT (mirrors the Workouts week grid) */}
            <View style={styles.weekGrid}>
              {DAY_LABELS.map((label, dow) => {
                const dayWorkouts = getDowWorkouts(dow);
                const isSelected  = dow === selectedDow;
                const isToday     = dow === TODAY_DOW;
                return (
                  <TouchableOpacity
                    key={label}
                    style={[
                      styles.dayNode,
                      isToday && !isSelected && styles.dayNodeToday,
                      isSelected && styles.dayNodeSelected,
                    ]}
                    onPress={() => setSelectedDow(dow)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.dayLabel, (isSelected || isToday) && styles.dayLabelSel]}>
                      {label}
                    </Text>
                    {/* A rest day is simply a day with no accent dot — no label. */}
                    {dayWorkouts.length > 0 && (
                      <View style={styles.dotsRow}>
                        {dayWorkouts.map((w, di) => {
                          const tc = accentFor(w.category);
                          return (
                            <View key={di} style={[styles.dot, tc && { backgroundColor: tc, shadowColor: tc, shadowOpacity: 0.9, shadowRadius: 3 }]} />
                          );
                        })}
                      </View>
                    )}
                    {isToday && <View style={styles.todayBar} />}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Selected weekday detail — FIXED height so the card never resizes
                with the day's data (rest day vs. 1+ workouts); overflow scrolls. */}
            <View style={styles.dayCard}>
              <View style={styles.dayCardHeader}>
                <Text style={styles.dayCardDayName}>{DOW_FULL[selectedDow]}</Text>
              </View>

              <ScrollView
                style={styles.dayCardBody}
                contentContainerStyle={[
                  styles.dayCardBodyContent,
                  (loading || selectedWorkouts.length === 0) && styles.dayCardBodyEmpty,
                ]}
                showsVerticalScrollIndicator={false}
              >
                {loading ? (
                  <View style={styles.restCard}>
                    <ActivityIndicator color={SL.accent} size="large" />
                  </View>
                ) : selectedWorkouts.length > 0 ? (
                  selectedWorkouts.map(workout => {
                    const tc = accentFor(workout.category); // accessory/legs glow, else null
                    return (
                    <View key={workout.templateId} style={[styles.workoutCard, tc && { borderLeftColor: tc, shadowColor: tc, shadowOpacity: 0.4, shadowRadius: 8 }]}>
                      <View style={styles.workoutInfo}>
                        <View style={styles.workoutTitleRow}>
                          <Text style={[styles.workoutTitle, tc && { color: tc }]} numberOfLines={1}>{workout.title?.toUpperCase()}</Text>
                          {tc && (
                            <View style={[styles.typeTag, { borderColor: tc }]}>
                              <Text style={[styles.typeTagText, { color: tc }]}>{categoryMeta(workout.category).l}</Text>
                            </View>
                          )}
                        </View>
                        {workout.purpose ? (
                          <Text style={styles.workoutPurpose} numberOfLines={1}>{workout.purpose}</Text>
                        ) : null}
                      </View>
                      <View style={styles.cardActionRow}>
                        <PillButton
                          label="VIEW"
                          variant="solid"
                          size="sm"
                          style={styles.actionBtn}
                          textStyle={styles.actionBtnText}
                          onPress={() => navigation.navigate('WorkoutDetail', { workout })}
                        />
                        <PillButton
                          label="✕"
                          tone="danger"
                          size="sm"
                          style={styles.actionBtn}
                          textStyle={styles.actionBtnText}
                          onPress={() => handleRemoveFromDay(workout.templateId)}
                        />
                      </View>
                    </View>
                    );
                  })
                ) : (
                  <View style={styles.restCard}>
                    <Text style={styles.restLabel}>REST DAY</Text>
                  </View>
                )}
              </ScrollView>
            </View>

      </Animated.View>
      </View>
    </ScreenFrame>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg },

  // Fixed card height so the frame is the same size regardless of data/loading.
  card: { height: CARD_H },
  body: { flex: 1, width: '100%', paddingBottom: 12 },

  // ── Forge-style action buttons (4-up row) ──
  // Tiles are tall so this block occupies the same vertical zone the Workouts
  // screen uses for its TRAINING FORGE button + week-nav row — keeping the grid
  // and day panel at an identical position/height across both screens.
  actionRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 18,
    marginBottom: 34,
    gap: 8,
  },
  forgeBtn: {
    flex: 1,
    minHeight: 100,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#5AC8FA',          // bright static ice edge
    backgroundColor: '#0a1626',
    shadowColor: '#5AC8FA',          // matching glow halo
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
  },
  // A faint brighter hairline just inside the edge → a "polished glass" sheen.
  forgeBtnInner: {
    position: 'absolute',
    top: 2,
    left: 2,
    right: 2,
    bottom: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(159,228,255,0.25)',
  },
  forgeBtnText: {
    fontFamily: F.heading,
    fontSize: 14,
    lineHeight: 18,
    color: '#FFFFFF',
    letterSpacing: 0.3,
    textAlign: 'center',
    textShadowColor: SL.accent,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },

  // ── Hero header (must match WorkoutsScreen EXACTLY for the transition) ──
  header: {
    paddingHorizontal: 20,
    paddingTop: 64,
    paddingBottom: 20,
    alignItems: 'center',
  },
  // BACK pill overlaid top-left so the name stays dead-centered.
  backRow: {
    position: 'absolute',
    top: 20,
    left: 16,
    zIndex: 2,
  },
  // ACCESSORIES pill mirrored top-right (gold), leaving the name centered.
  accessoriesRow: {
    position: 'absolute',
    top: 20,
    right: 16,
    zIndex: 2,
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
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 12,
  },

  // ── Weekday grid (matches the Workouts week grid) ──────────────────────────
  weekGrid: {
    flexDirection: 'row',
    // Align the week strip's outer edges with the day panel below it (dayCard
    // margin 8 + border 1.5 + padding 20 ≈ 29), leaving space to the frame border.
    paddingHorizontal: 28,
    gap: 6,
  },
  dayNode: {
    flex: 1,
    minHeight: 124,
    overflow: 'hidden',
    backgroundColor: SL.panel,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: SL.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    gap: 3,
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
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  dayLabelSel: { color: SL.accent },
  // Absolute-positioned at the bottom so the presence/absence of dots never
  // shifts the day label — it stays at a constant height across the whole strip.
  dotsRow: {
    flexDirection: 'row', gap: 4, justifyContent: 'center',
    position: 'absolute', bottom: 8, left: 0, right: 0,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: SL.accent },
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

  // ── Selected day panel (matches the Workouts day panel) ────────────────────
  dayCard: {
    marginHorizontal: 8,
    marginTop: 14,
    flex: 1,                     // fills remaining space inside the fixed-height card
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
  dayCardBody: { flex: 1 },
  dayCardBodyContent: { gap: 12, flexGrow: 1, justifyContent: 'flex-start' },
  dayCardBodyEmpty: { justifyContent: 'center' },
  dayCardHeader: { gap: 4, minHeight: 36 },
  dayCardDayName: {
    fontFamily: F.heading,
    fontSize: 30,
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
  // Session card — matches the Workouts day panel: title left, action pills right.
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
  workoutTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
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
  workoutPurpose: {
    fontFamily: F.body,
    fontSize: 13,
    color: SL.muted,
    letterSpacing: 0.5,
  },
  cardActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    flexShrink: 0,
  },
  actionBtn: { paddingHorizontal: 12 },
  actionBtnText: { fontSize: 14, letterSpacing: 1 },
  restCard: { alignItems: 'center', gap: 8, paddingVertical: 16 },
  restLabel: { fontFamily: F.heading, fontSize: 26, color: SL.muted, letterSpacing: 5 },
  restSub:   { fontFamily: F.bodyMed, fontSize: 20, color: SL.muted, letterSpacing: 0.5 },

});
