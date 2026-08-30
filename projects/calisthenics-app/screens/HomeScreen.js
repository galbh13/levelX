import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Animated, Easing, useWindowDimensions, AccessibilityInfo,
} from 'react-native';
import { F } from '../constants/fonts';
import { supabase } from '../lib/supabase';
import { computeLvl, computeClassMax } from '../lib/computeLvl';
import { evaluatePrestige, prestigeStars } from '../lib/prestige';
import { DEFAULT_JOB } from '../lib/jobs';
import { israelToday } from '../lib/israelDate';
import { materializeDay } from '../lib/schedule';
import { categoryLabel, categoryMeta } from '../lib/workouts';
import { ShimmerText, ShimmerFill, GOLD } from '../components/Shimmer';
import ScreenFrame, { FRAME_PAD } from '../components/ScreenFrame';
import PopCheck from '../components/PopCheck';
import ClearSweep from '../components/ClearSweep';
import DoneAura from '../components/DoneAura';
import QuestGate from '../components/QuestGate';
import { hapticTap } from '../lib/haptics';
import { CARD_W } from '../constants/layout';
import { sessionKey, activeSessionKeys } from '../lib/workoutSession';
import { useTourTarget } from '../lib/tourTargets';
import { useTour } from '../context/TourContext';
import { lighten, rgba } from '../lib/colorMix';

// EVERY typed mission glows in its own type color — the same hex the launcher
// window wears, so the row you tap and the window that opens are one thing.
// (Was accessory/legs only, which left a SIDE QUEST row plain and then opened a
// violet window.) Untyped/legacy missions return null = the default theme.
const accentFor = (category) =>
  categoryLabel(category) ? categoryMeta(category).color : null;

// The live card's glow, rail and beacon used to be hard-coded ice blue (#8CE0FF);
// every one of them is now derived from the mission's OWN type color (via the
// shared shade helpers) so an in-progress HANDSTAND stays rose mid-session.

const SL = {
  bg:     '#050912',
  panel:  '#070d1a',
  border: '#1a3a5c',
  accent: '#4A9EBF',
  text:   '#E8F4FF',
  muted:  '#4a6a8a',
  green:  '#4CAF50',
  gold:   '#FFD700',
  red:    '#E11D48',
};

const TODAY = new Date().toISOString().split('T')[0];

// Render the class rank as a Roman numeral (e.g. "2" → "II"). If the token is
// already non-numeric (already roman, or a worded rank), it's returned as-is.
const ROMAN = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];
function toRoman(token) {
  const n = parseInt(token, 10);
  if (!Number.isInteger(n) || String(n) !== String(token).trim() || n <= 0) return token;
  let out = '';
  let rem = n;
  for (const [val, sym] of ROMAN) { while (rem >= val) { out += sym; rem -= val; } }
  return out;
}

// The gem is a ROTATED square, so the numeral doesn't get the gem's full width:
// at the text's own cap height the diamond has already narrowed to roughly half
// of it. A single "I" fits at full size, but "III" / "VIII" run into (and past)
// the gold edge — which is why the numeral is sized by GLYPH COUNT rather than
// set at one fixed size. Values are for the wide desktop card; makeDyn's card
// scale multiplies on top. Wide numerals also drop their tracking to 0.
const RANK_SIZE = { 1: 46, 2: 40, 3: 33 };
const rankType = (text) => ({
  fontSize: RANK_SIZE[text.length] ?? 26,
  letterSpacing: text.length >= 3 ? 0 : 1,
});

// A mission the player is CURRENTLY mid-session on (a live Workout Mode session
// is saved on this device). It reads totally different from a normal mission
// card so the eye is pulled straight to it: a breathing type-color glow, a hot
// pulsing "● IN PROGRESS" beacon, an energized left rail, and a light sweep that
// keeps streaking across the card — it looks ALIVE, not idle. Tapping resumes.
// Animations are native-driver (opacity + transform only) and torn down on
// unmount, so they run only while a live card is on screen.
function LiveMissionCard({ workout, onOpen, tint }) {
  // The whole live treatment is one color family: the mission's type color (rose
  // for HANDSTAND, gold for ACCESSORIES…), falling back to the ice accent when a
  // legacy workout has no type.
  const base  = tint || SL.accent;
  const bright = lighten(base);
  const pulse = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);

  useEffect(() => {
    const p = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1050, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1050, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    const s = Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 1900, easing: Easing.linear, useNativeDriver: true }));
    p.start(); s.start();
    return () => { p.stop(); s.stop(); };
  }, [pulse, sweep]);

  const glowO  = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.28, 1] });
  const railO  = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
  const dotO   = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  const dotS   = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.35] });
  const sweepX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-90, (w || 260) + 90] });

  return (
    <TouchableOpacity
      style={[styles.liveCard, { borderColor: base }]}
      onPress={onOpen}
      activeOpacity={0.85}
      onLayout={e => setW(e.nativeEvent.layout.width)}
    >
      {/* Breathing type-color glow border — the card seems to inhale/exhale. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.liveGlow, { opacity: glowO, borderColor: bright, shadowColor: base }]}
      />
      {/* Diagonal light streak sweeping across, on a loop — pure energy. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.liveSweep,
          { backgroundColor: rgba(bright, 0.16), shadowColor: bright },
          { transform: [{ translateX: sweepX }, { rotate: '18deg' }] },
        ]}
      />
      {/* Energized left rail, pulsing in time with the glow. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.liveRail, { opacity: railO, backgroundColor: bright, shadowColor: base }]}
      />

      <View style={styles.liveBody}>
        <View style={styles.liveBadgeRow}>
          <Animated.View
            style={[
              styles.liveDot,
              { backgroundColor: bright, shadowColor: bright },
              { opacity: dotO, transform: [{ scale: dotS }] },
            ]}
          />
          <Text style={[styles.liveBadgeText, { color: lighten(base, 0.7), textShadowColor: rgba(bright, 0.8) }]}>
            IN PROGRESS
          </Text>
        </View>
        <Text style={[styles.missionTitle, { color: base }]} numberOfLines={2} ellipsizeMode="tail">
          {workout.title?.toUpperCase()}
        </Text>
        <Text style={[styles.liveResume, { color: base, textShadowColor: rgba(base, 0.6) }]}>▶ TAP TO RESUME</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function HomeScreen({ navigation }) {
  const [profile,        setProfile]        = useState(null);
  const [className,      setClassName]      = useState(null);
  const [workouts,       setWorkouts]       = useState([]);
  const [lvl,            setLvl]            = useState(0);
  const [maxLvl,         setMaxLvl]         = useState(0);
  const [prestigeReady,  setPrestigeReady]  = useState(false);
  const [stars,          setStars]          = useState(0);
  const [dailyQuests,    setDailyQuests]    = useState([]);
  const [doneTodayIds,   setDoneTodayIds]   = useState(new Set());
  const [loading,        setLoading]        = useState(true);
  // The walkthrough itself is NOT rendered here any more — it lives at the app
  // root (PlayerTour in App.js), because a <Modal> inside a tab-pager page gets
  // torn down on the APK the moment the tour navigates to another tab. This
  // screen only opens it (the TUTORIAL pill) and reads whether it's running, so
  // it can show the tutorial-only demo mission. Opening it ONLY happens on that
  // tap — there is no first-launch auto-open.
  const { tourOpen: showOnboarding, openTour } = useTour();
  // Mission tapped → the system's quest-alert window opens over Home.
  const [activeMission,  setActiveMission]  = useState(null);
  // Keys of workouts with a saved (in-progress) Workout Mode session on this
  // device — so today's mission card switches to its live, animated state.
  const [inProgress,     setInProgress]     = useState(new Set());
  const { width: winW } = useWindowDimensions();
  // The big "trophy HUD" display elements (player name, level number, rank
  // medallion, section titles) and the generous vertical paddings are tuned for
  // the WIDE desktop card (CARD_W). On a phone the card width collapses to the
  // viewport, so at full size that display type overflows the screen vertically.
  // Derive a scale from the card's real width and shrink the oversized display
  // pieces + spacing so the whole Home card fits a regular phone, while still
  // growing back to the full desktop look on wide windows. (Body text — mission /
  // quest rows, labels — is left near full size so it stays readable; see makeDyn.)
  const cardW = Math.min(CARD_W, winW - FRAME_PAD * 2);
  const scale = Math.min(1, Math.max(0.55, cardW / 1100));
  const d     = useMemo(() => makeDyn(scale), [scale]);

  // ── Animations ────────────────────────────────────────────────────────────
  // Staggered entrance for the three vertical blocks (hero → stat → grid) plus a
  // one-time level count-up + progress-bar fill on load. All native-driver
  // (opacity/transform) except the count-up/fill which drive plain state via
  // listeners. Reduced-motion jumps straight to the settled state.
  const heroAnim = useRef(new Animated.Value(0)).current;
  const statAnim = useRef(new Animated.Value(0)).current;
  const gridAnim = useRef(new Animated.Value(0)).current;
  const [displayLvl, setDisplayLvl] = useState(0);
  // The bar is ANIMATED, not re-rendered. `barGrow` (0→1) slides the fill in on
  // the NATIVE thread and `barTarget` is the level's real percentage. The fill
  // used to be plain state written from a per-frame listener, which re-rendered
  // this whole screen 60 times a second for the length of the intro — that was
  // the stutter. `countUp` is its JS-side twin: the number can't leave the JS
  // thread, but its rounded value only changes a handful of times, so it costs a
  // handful of renders instead of one per frame.
  const barGrow = useRef(new Animated.Value(0)).current;
  const countUp = useRef(new Animated.Value(0)).current;
  const [barTarget, setBarTarget] = useState(0);
  // Track width in px — a transform can't be driven by a percentage.
  const [trackW, setTrackW] = useState(0);
  const reduceMotion = useRef(false);
  const introDone    = useRef(false);
  // The entrance (blocks pop-in + level count-up + bar fill) plays ONCE per mount
  // — i.e. on app open / sign-in (Home is the initial route so its mount = app
  // open). Swiping back to Home never replays it: the tree stays mounted, so this
  // guard is already tripped and nothing re-animates (not even the bar).
  const introPlayed = useRef(false);
  // After the first successful load, focus refetches run SILENTLY (no spinner) —
  // the data is already on screen, so re-entering the tab never flashes loading.
  const loadedRef   = useRef(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then(v => { if (alive) reduceMotion.current = !!v; });
    return () => { alive = false; };
  }, []);

  // Elements the guided tour measures + points its arrow at.
  const tourLevelRef    = useTourTarget('home.level');
  const tourMissionsRef = useTourTarget('home.missions');
  // The FIRST mission row — the tour circles just one mission (not the whole panel)
  // to teach "tap a single mission". Falls back to the panel on a rest day.
  const tourMission1Ref = useTourTarget('home.mission1');

  // Entrance: stagger the blocks up, count the level up, and fill the bar — ONCE
  // per mount, the moment data is first ready. Depends on `!!profile` (a bool, not
  // the object) so silent refetches — which set a NEW profile object each time —
  // never re-run this effect and stop the count-up mid-flight.
  useEffect(() => {
    if (loading || !profile || introPlayed.current) return;
    introPlayed.current = true;

    const targetPct = maxLvl > 0 ? Math.min(lvl / maxLvl, 1) * 100 : 0;

    if (reduceMotion.current) {
      heroAnim.setValue(1); statAnim.setValue(1); gridAnim.setValue(1);
      setDisplayLvl(lvl); setBarTarget(targetPct); barGrow.setValue(1); countUp.setValue(1);
      introDone.current = true;
      return;
    }

    heroAnim.setValue(0); statAnim.setValue(0); gridAnim.setValue(0);
    const enter = v => Animated.timing(v, {
      toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    Animated.stagger(120, [enter(heroAnim), enter(statAnim), enter(gridAnim)]).start();

    setDisplayLvl(0); setBarTarget(targetPct); barGrow.setValue(0); countUp.setValue(0);

    // Two drivers, same curve, started together — so the number and the bar rise
    // in lockstep while each runs where it belongs: the bar's slide natively, the
    // count-up in JS (a listener can't read a native value without dragging every
    // frame back over the bridge).
    const cfg = { toValue: 1, duration: 1100, delay: 260, easing: Easing.out(Easing.cubic) };
    const sub = countUp.addListener(({ value }) => {
      setDisplayLvl(Math.round(value * lvl));
    });
    const slide = Animated.timing(barGrow, { ...cfg, useNativeDriver: true });
    const count = Animated.timing(countUp, { ...cfg, useNativeDriver: false });
    slide.start();
    count.start(({ finished }) => {
      if (finished) { setDisplayLvl(lvl); introDone.current = true; }
      countUp.removeListener(sub);
    });
    return () => { countUp.removeListener(sub); slide.stop(); count.stop(); };
  }, [loading, !!profile, heroAnim, statAnim, gridAnim, barGrow, countUp]);

  // After the intro count-up settles, keep the number/bar in sync with later
  // level changes (e.g. finishing a workout) — instantly, no re-count.
  useEffect(() => {
    if (!introDone.current) return;
    setDisplayLvl(lvl);
    setBarTarget(maxLvl > 0 ? Math.min(lvl / maxLvl, 1) * 100 : 0);
    barGrow.setValue(1);
    countUp.setValue(1);
  }, [lvl, maxLvl]);

  const fetchData = useCallback(async () => {
    if (!loadedRef.current) setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profileData } = await supabase
        .from('profiles')
        .select('full_name, prestige_count, class_id, job')
        .eq('id', user.id)
        .single();

      if (!profileData) return;
      setProfile(profileData);

      const israelDay = israelToday();
      const todayDow  = new Date(TODAY + 'T00:00:00').getDay();
      const [classRes, overridesRes, templateRes, lvlVal, dqRes, dqDoneRes, maxLvlVal, questsRes, complRes, classCountRes] = await Promise.all([
        profileData.class_id
          ? supabase.from('classes').select('name, prestige_at, order_index').eq('id', profileData.class_id).single()
          : Promise.resolve({ data: null }),
        supabase
          .from('workout_override_workouts')
          .select('id, workout_id, completed')
          .eq('student_id', user.id)
          .eq('specific_date', TODAY),
        supabase
          .from('weekly_workout_template')
          .select('workout_id')
          .eq('student_id', user.id)
          .eq('day_of_week', todayDow),
        computeLvl(user.id, profileData.class_id),
        supabase
          .from('daily_quests')
          .select('id, title')
          .eq('student_id', user.id)
          .eq('active', true)
          .order('created_at', { ascending: true }),
        supabase
          .from('daily_quest_completions')
          .select('daily_quest_id')
          .eq('student_id', user.id)
          .eq('completion_date', israelDay),
        computeClassMax(profileData.class_id),
        profileData.class_id
          ? supabase.from('class_quests').select('id, name, chain, quest_type, prerequisites').eq('class_id', profileData.class_id)
          : Promise.resolve({ data: [] }),
        supabase.from('student_quest_completions').select('quest_id').eq('student_id', user.id),
        // Per-job class count — stars reflect classes overcome within the
        // player's own job ladder, not the total across every job.
        supabase.from('classes').select('id', { count: 'exact', head: true })
          .eq('job', profileData.job ?? DEFAULT_JOB),
      ]);

      setClassName(classRes.data?.name ?? null);
      setLvl(lvlVal ?? 0);
      setMaxLvl(maxLvlVal ?? 0);

      // Gold bar = prestige actually AVAILABLE (full gate), not just the level
      // line. Same evaluator SkillsScreen uses.
      const prestigeEval = evaluatePrestige({
        job:          profileData.job ?? DEFAULT_JOB,
        orderIndex:   classRes.data?.order_index ?? 0,
        quests:       questsRes.data ?? [],
        completedIds: new Set((complRes.data ?? []).map(c => c.quest_id)),
        lvl:          lvlVal ?? 0,
        prestigeAt:   classRes.data?.prestige_at ?? 80,
      });
      setPrestigeReady(prestigeEval.ok);
      // Stars = classes overcome (current order_index, +1 if the final class is fully met).
      setStars(prestigeStars({
        orderIndex:    classRes.data?.order_index ?? 0,
        classCount:    classCountRes.count ?? null,
        finalClassMet: prestigeEval.ok,
      }));
      setDailyQuests(dqRes.data ?? []);
      setDoneTodayIds(new Set((dqDoneRes.data ?? []).map(r => r.daily_quest_id)));

      // Per-date override wins for today; otherwise fall back to the weekly skeleton.
      const overrides = overridesRes.data ?? [];
      const resolved = overrides.length > 0
        ? overrides.map(o => ({ workout_id: o.workout_id, overrideId: o.id, completed: o.completed ?? false }))
        : (templateRes.data ?? []).map(t => ({ workout_id: t.workout_id, overrideId: null, completed: false }));

      if (resolved.length === 0) {
        setWorkouts([]); return;   // the `finally` clears loading
      }

      const workoutIds = [...new Set(resolved.map(r => r.workout_id))];
      const { data: workoutRows } = await supabase
        .from('workouts')
        .select('id, title, purpose, category')
        .in('id', workoutIds);

      const workoutsById = Object.fromEntries((workoutRows ?? []).map(w => [w.id, w]));
      const merged = resolved
        .map(r => ({ ...workoutsById[r.workout_id], overrideId: r.overrideId, completed: r.completed }))
        .filter(w => w.id);

      setWorkouts(merged);
    } catch (e) {
      console.error('[HomeScreen] fetchData:', e);
    } finally {
      // MUST be `finally`: the early `return`s above (no user, no profile row)
      // jump straight past the end of the function, and while these two lines
      // lived out here that left `loading` true forever — the tab bar and frame
      // rendered around a permanently empty card. A player whose profile can't
      // be read now gets an empty home, not a dead black one.
      loadedRef.current = true;
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    fetchData();
    let alive = true;
    activeSessionKeys().then(keys => { if (alive) setInProgress(new Set(keys)); });
    return () => { alive = false; };
  }, [fetchData]));

  async function toggleDailyQuest(quest) {
    hapticTap();
    const isDone = doneTodayIds.has(quest.id);
    const today = israelToday();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Optimistic update
    const nextDone = new Set(doneTodayIds);
    if (isDone) nextDone.delete(quest.id); else nextDone.add(quest.id);
    setDoneTodayIds(nextDone);

    if (isDone) {
      const { error } = await supabase
        .from('daily_quest_completions')
        .delete()
        .eq('daily_quest_id', quest.id)
        .eq('student_id', user.id)
        .eq('completion_date', today);
      if (error) { console.error('[HomeScreen] uncheck daily quest:', error); await fetchData(); }
    } else {
      const { error } = await supabase
        .from('daily_quest_completions')
        .insert({
          daily_quest_id: quest.id,
          student_id: user.id,
          completion_date: today,
        });
      if (error) { console.error('[HomeScreen] check daily quest:', error); await fetchData(); }
    }
  }

  // Toggle a workout's completion straight from Home (same write WorkoutsScreen uses).
  async function toggleWorkout(workout) {
    hapticTap();
    // Real override row → just flip completed (optimistic).
    if (workout.overrideId) {
      const next = !workout.completed;
      setWorkouts(prev => prev.map(w =>
        w.overrideId === workout.overrideId ? { ...w, completed: next } : w
      ));
      const { error } = await supabase
        .from('workout_override_workouts')
        .update({ completed: next })
        .eq('id', workout.overrideId);
      if (error) {
        console.error('[HomeScreen] toggleWorkout:', error);
        setWorkouts(prev => prev.map(w =>
          w.overrideId === workout.overrideId ? { ...w, completed: !next } : w
        ));
      }
      return;
    }

    // Template-derived day — materialize today (keeping siblings), then mark done.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await materializeDay({
      studentId: user.id,
      coachId:   user.id,
      dateStr:   TODAY,
      templateWorkoutIds: workouts.map(w => w.id),
    });
    const { error } = await supabase
      .from('workout_override_workouts')
      .update({ completed: true })
      .eq('student_id', user.id)
      .eq('specific_date', TODAY)
      .eq('workout_id', workout.id);
    if (error) console.error('[HomeScreen] toggleWorkout materialize:', error);
    await fetchData();
  }

  // Jump straight into the live session for the tapped mission. WorkoutMode is a
  // ROOT screen pushed ABOVE the tab pager (registered in App.js's PlayerApp root
  // stack), so this is a plain push that never moves the bottom-tab pager — the old
  // cross-tab nested navigate desynced the pager and dropped us on the Workouts
  // list. It needs the dated workout (specific_date) to key the local session +
  // completion write. EXIT's goBack() pops back down to the tabs (on Home).
  function startWorkoutMode(workout) {
    setActiveMission(null);
    navigation.navigate('WorkoutMode', { workout: { ...workout, specific_date: TODAY } });
  }

  const missionLive  = !!activeMission && inProgress.has(sessionKey(TODAY, activeMission.id));
  const allDone      = workouts.length > 0 && workouts.every(w => w.completed);
  const toNext       = Math.max(0, maxLvl - lvl);
  const missionsDone = workouts.filter(w => w.completed).length;
  const dqDone       = dailyQuests.filter(q => doneTodayIds.has(q.id)).length;


  // Split the class name ("CLASS II") into a kicker + the rank token, so the rank
  // can sit big inside the crest medallion and "CLASS" reads as a spaced kicker
  // beneath. Single-token names fall back to showing the whole name in the gem.
  const classParts  = (className ?? '').trim().split(/\s+/).filter(Boolean);
  const classRank   = classParts.length > 1 ? classParts[classParts.length - 1] : (classParts[0] ?? '');
  const classKicker = classParts.length > 1 ? classParts.slice(0, -1).join(' ') : null;
  const rankNumeral = toRoman(classRank).toUpperCase();
  const rankStyle   = rankType(rankNumeral);

  // Fade + rise as each block enters (native driver).
  const enterStyle = a => ({
    opacity: a,
    transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }],
  });

  return (
    <ScreenFrame ready={!loading}>
    <View style={styles.card}>
    <View style={[styles.body, d.body]}>

      {/* Top row: HOW IT WORKS (replay the walkthrough) + Sign Out */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.helpBtn}
          activeOpacity={0.8}
          onPress={openTour}
        >
          <Text style={styles.helpLabel}>TUTORIAL</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.signOutBtn}
          activeOpacity={0.8}
          onPress={() => supabase.auth.signOut()}
        >
          <View style={styles.powerIcon}>
            <View style={styles.powerRing} />
            <View style={styles.powerStem} />
          </View>
        </TouchableOpacity>
      </View>

      {/* The full layout ALWAYS renders, so the card never collapses to a spinner
          on load (the cause of the old size jump). While the first load is in
          flight a spinner is overlaid on top (see loadingOverlay below). */}
      <>
          {/* ── Hero ── */}
          <Animated.View style={[styles.hero, d.hero, enterStyle(heroAnim)]}>
            <Text style={[styles.playerName, d.playerName]}>{profile?.full_name?.toUpperCase() ?? '—'}</Text>
            {className && (
              <View style={[styles.crestBlock, d.crestBlock]}>
                <View style={[styles.crest, d.crest]}>
                  {/* Rank medallion — a glowing gold gem holding the numeral. */}
                  <View style={[styles.medallionWrap, d.medallionWrap]}>
                    <View style={[styles.medallion, d.medallion]} />
                    <View style={[styles.medallionInner, d.medallionInner]} />
                    <Text
                      style={[
                        styles.medallionRank,
                        d.medallionRank,
                        // Glyph-count sizing (III must be smaller than I to stay
                        // inside the rotated gem), scaled with the card.
                        { fontSize: Math.round(rankStyle.fontSize * scale), letterSpacing: rankStyle.letterSpacing },
                      ]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                    >
                      {rankNumeral}
                    </Text>
                  </View>
                </View>

                {classKicker && (
                  <Text
                    style={[styles.crestKicker, d.crestKicker]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.6}
                  >
                    {classKicker.toUpperCase()}
                  </Text>
                )}
              </View>
            )}
          </Animated.View>

          {/* ── LVL ── */}
          <Animated.View style={[styles.statsRow, d.statsRow, enterStyle(statAnim)]}>
            <View ref={tourLevelRef} collapsable={false} style={[styles.statCard, d.statCard]}>
              <View style={styles.levelTopRow}>
                <Text style={[styles.levelKicker, d.levelKicker]}>CURRENT LEVEL</Text>
                {/* The % pill was dropped — the bar + "x / y" below already show
                    progress; one number less to read. */}
                {prestigeReady && (
                  <View style={styles.prestigePill}>
                    <ShimmerText
                      text="★ PRESTIGE READY"
                      style={styles.prestigePillText}
                      colors={GOLD}
                      sweep={false}
                      active
                    />
                  </View>
                )}
              </View>

              <ShimmerText text={String(displayLvl)} style={[styles.statNumber, d.statNumber]} active={prestigeReady} />

              {/* The fill is laid out at its FINAL width and slid in from the
                  left; the track clips the overhang, so it reads as a bar
                  growing while being one native transform. */}
              <View
                style={styles.progressBg}
                onLayout={(e) => {
                  const w = Math.round(e.nativeEvent.layout.width);
                  setTrackW(prev => (prev === w ? prev : w));
                }}
              >
                <Animated.View
                  style={[styles.progressFillWrap, {
                    width: (trackW * barTarget) / 100,
                    transform: [{
                      translateX: barGrow.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-(trackW * barTarget) / 100, 0],
                      }),
                    }],
                  }]}
                >
                  <ShimmerFill style={styles.progressFill} active={prestigeReady} />
                </Animated.View>
              </View>

              <View style={styles.levelBottomRow}>
                <Text style={styles.progressLabel}>{lvl} / {maxLvl}</Text>
                <Text style={styles.toNextLabel}>
                  {toNext > 0 ? `${toNext} TO GO` : 'MAXED'}
                </Text>
              </View>
            </View>
          </Animated.View>

          {/* ── Today's Missions (top) + Daily Quests (below) — one column ── */}
          <Animated.View style={[styles.sectionsRow, d.sectionsRow, enterStyle(gridAnim)]}>

            {/* Today's Missions */}
            <View
              ref={tourMissionsRef}
              collapsable={false}
              style={[styles.sectionPanel, d.sectionPanel]}
            >
              <View style={styles.panelHeader}>
                <View style={styles.panelHeaderBar} />
                <Text style={[styles.panelHeaderText, d.panelHeaderText]} numberOfLines={2} ellipsizeMode="tail">
                  TODAY'S MISSIONS
                </Text>
                {workouts.length > 0 && (
                  <View style={[styles.countChip, allDone && styles.countChipDone]}>
                    <Text style={[styles.countChipText, allDone && styles.countChipTextDone]}>
                      {missionsDone}/{workouts.length}
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.panelDivider} />

              {workouts.length === 0 ? (
                showOnboarding ? (
                  // Tutorial-only demo mission: on a rest day there's no real card
                  // for the "Start a Workout" step to box, so during the walkthrough
                  // we show one placeholder mission (non-interactive) purely so the
                  // player can SEE + experience what a mission looks like. Tagged as
                  // home.mission1 so the tour highlights its exact shape.
                  <View ref={tourMission1Ref} collapsable={false} style={styles.missionCard} pointerEvents="none">
                    <View style={styles.missionAccent} />
                    <View style={styles.missionBody}>
                      <Text style={styles.missionTitle} numberOfLines={1}>EXAMPLE WORKOUT</Text>
                    </View>
                    <View style={styles.missionCheckbox} />
                  </View>
                ) : (
                  <View style={styles.restDay}>
                    <Text style={[styles.restDayText, d.restDayText]}>REST DAY</Text>
                  </View>
                )
              ) : (
                <>
                  {workouts.map((workout, mi) => {
                    // Mid-session today → swap in the live, animated card.
                    if (!workout.completed && inProgress.has(sessionKey(TODAY, workout.id))) {
                      return (
                        // The tour's "Start a Workout" step measures the FIRST
                        // mission row — and this live variant is a first row too.
                        // Without the tag here, a player mid-session (the common
                        // case: you resume a workout, so your one mission is
                        // in-progress) left home.mission1 unregistered and the
                        // step fell back to drawing a circle in empty space.
                        <View
                          key={workout.overrideId}
                          ref={mi === 0 ? tourMission1Ref : undefined}
                          collapsable={false}
                        >
                          <LiveMissionCard
                            workout={workout}
                            tint={accentFor(workout.category)}
                            onOpen={() => setActiveMission(workout)}
                          />
                        </View>
                      );
                    }
                    const tc = accentFor(workout.category); // type glow, null when untyped
                    return (
                    <TouchableOpacity
                      key={workout.overrideId}
                      ref={mi === 0 ? tourMission1Ref : undefined}
                      style={[
                        styles.missionCard,
                        workout.completed && styles.missionCardDone,
                        // Done or not, the card wears its OWN type color — a
                        // completed HANDSTAND stays rose instead of flipping to
                        // the ice-blue "done" theme.
                        tc && (workout.completed
                          ? { borderColor: tc, shadowColor: tc }
                          : { borderColor: tc + '66', shadowColor: tc }),
                      ]}
                      onPress={() => setActiveMission(workout)}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.missionAccent, tc && { backgroundColor: tc, shadowColor: tc }]} />
                      <View style={styles.missionBody}>
                        {/* Title only — the purpose/description lives in Workout
                            Mode, in full, so the board stays a clean list. */}
                        <Text
                          style={[
                            styles.missionTitle,
                            tc && { color: tc },
                            workout.completed && styles.missionTitleDone,
                          ]}
                          numberOfLines={2}
                          ellipsizeMode="tail"
                        >
                          {workout.title?.toUpperCase()}
                        </Text>
                      </View>
                      {/* Checkbox stays the quick-complete toggle (its own tap target,
                          so the card body opens the launcher instead). */}
                      <TouchableOpacity
                        style={[
                          styles.missionCheckbox,
                          workout.completed && styles.missionCheckboxDone,
                          tc && (workout.completed
                            ? { backgroundColor: tc, borderColor: tc, shadowColor: tc }
                            : { borderColor: tc + '99' }),
                        ]}
                        onPress={() => toggleWorkout(workout)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        activeOpacity={0.7}
                      >
                        {workout.completed && (
                          <PopCheck><Text style={styles.missionCheckMark}>✓</Text></PopCheck>
                        )}
                      </TouchableOpacity>
                      {/* Cleared: a light travelling the frame, on forever. */}
                      <DoneAura active={workout.completed} color={tc || SL.accent} />
                      {/* The scan that confirms it — plays on the tick, then unmounts. */}
                      <ClearSweep done={workout.completed} color={tc || SL.accent} />
                    </TouchableOpacity>
                    );
                  })}
                </>
              )}

            </View>

            {/* Daily Quests */}
            <View style={[styles.sectionPanel, d.sectionPanel]}>
              <View style={styles.panelHeader}>
                <View style={styles.panelHeaderBar} />
                <Text style={[styles.panelHeaderText, d.panelHeaderText]} numberOfLines={2} ellipsizeMode="tail">
                  DAILY QUESTS
                </Text>
                {dailyQuests.length > 0 && (
                  <View style={[styles.countChip, dqDone === dailyQuests.length && styles.countChipDone]}>
                    <Text style={[styles.countChipText, dqDone === dailyQuests.length && styles.countChipTextDone]}>
                      {dqDone}/{dailyQuests.length}
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.panelDivider} />

              {dailyQuests.length > 0 ? (
                dailyQuests.map(q => {
                  const done = doneTodayIds.has(q.id);
                  return (
                    <TouchableOpacity
                      key={q.id}
                      style={[styles.dqCard, done && styles.dqCardDone]}
                      onPress={() => toggleDailyQuest(q)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.dqTitle, done && styles.dqTitleDone]} numberOfLines={2}>
                        {q.title}
                      </Text>
                      <View style={[styles.dqCheckbox, done && styles.dqCheckboxDone]}>
                        {done && <PopCheck><Text style={styles.dqCheckMark}>✓</Text></PopCheck>}
                      </View>
                      <DoneAura active={done} color={SL.accent} />
                      <ClearSweep done={done} color={SL.accent} />
                    </TouchableOpacity>
                  );
                })
              ) : (
                <Text style={styles.emptyHint}>No daily quests yet.</Text>
              )}

            </View>
          </Animated.View>
      </>

      {loading && !profile && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={SL.accent} />
        </View>
      )}

      {/* Mission launcher — the SYSTEM's own alert window (see QuestGate). */}
      <QuestGate
        visible={!!activeMission}
        title={(activeMission?.title || '').toUpperCase()}
        purpose={activeMission?.purpose}
        tagLabel={categoryLabel(activeMission?.category)?.toUpperCase()}
        accent={accentFor(activeMission?.category)}
        live={missionLive}
        onEnter={() => startWorkoutMode(activeMission)}
        onClose={() => setActiveMission(null)}
      />

      {/* The guided tour itself renders at the app root — see PlayerTour in
          App.js and the note on `showOnboarding` above. */}

    </View>
    </View>
    </ScreenFrame>
  );
}

// Width-responsive overrides layered ON TOP of the static `styles` below. `s` is
// the card-width scale (0.55 on a phone … 1 on the wide desktop card). Display
// type + spacing scale with `s` so the Home card fits a phone; body text scales
// on a gentler curve (`rt`, floored at ~0.87) so mission/quest rows stay legible.
function makeDyn(s) {
  const r  = (n) => Math.round(n * s);
  const rt = (n) => Math.round(n * (0.74 + 0.26 * s));
  return {
    body:           { paddingHorizontal: r(20), paddingTop: r(18), paddingBottom: r(24) },
    hero:           { paddingVertical: r(28) },
    playerName:     { fontSize: r(76), textShadowRadius: r(24) },
    crestBlock:     { marginTop: r(22) },
    crest:          { gap: r(18) },
    medallionWrap:  { width: r(124), height: r(124) },
    medallion:      { width: r(98), height: r(98), borderRadius: r(14) },
    medallionInner: { width: r(70), height: r(70) },
    // No fontSize here — the numeral is sized by glyph count (see rankType) and
    // multiplied by this same card scale in the render.
    medallionRank:  { maxWidth: r(96) },
    crestKicker:    { fontSize: r(46), marginTop: r(18), letterSpacing: 9 * s, paddingLeft: r(9) },
    statsRow:       { marginBottom: r(20) },
    statCard:       { paddingHorizontal: r(22), paddingVertical: r(18) },
    levelKicker:    { fontSize: rt(22) },
    statNumber:     { fontSize: r(88), lineHeight: r(96) },
    sectionsRow:    { gap: r(18) },
    sectionPanel:   { minHeight: r(220), paddingHorizontal: r(16) },
    panelHeaderText:{ fontSize: r(32) },
    restDayText:    { fontSize: r(36) },
  };
}

const styles = StyleSheet.create({
  // No height of its own: ScreenFrame's card is already a constant full-screen
  // box, so `flexGrow: 1` just stretches this body to the bottom of it — short
  // days get dead space below instead of a shorter frame, and a day with more
  // missions than fit scrolls inside the card (the frame itself never moves).
  card: { width: '100%', flexGrow: 1 },
  // Content inside the card. The full layout ALWAYS renders — the load spinner is
  // overlaid, never swapped in — so the card never jumps size on load.
  body: {
    width: '100%',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 24,
  },
  // Centered spinner shown over the (already full-size) card on first load, so
  // the card keeps its real size instead of collapsing to a spinner.
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Top chrome row: HOW IT WORKS on the left, the power/sign-out pill on the right.
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  // Quiet ice-pill that reopens the walkthrough — help without stealing focus.
  // OUTLINE ONLY: no fill, and no `elevation` either — on Android elevation
  // paints a shaded plate behind the pill, which is what made these two read as
  // filled light-blue buttons next to the unfilled BACK pills everywhere else.
  helpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: SL.accent,
    backgroundColor: 'transparent',
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  helpLabel: {
    fontFamily: F.heading,
    fontSize: 11,
    letterSpacing: 1.5,
    color: SL.accent,
  },
  // Icon-only power pill — quiet chrome so the hero owns the top of the screen.
  // Outline only, same as helpBtn above.
  signOutBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: SL.accent,
    backgroundColor: 'transparent',
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  // Power symbol drawn from primitives (no icon font): a ring with a vertical
  // stem through its top center — the universal power/exit glyph.
  powerIcon: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  powerRing: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: SL.accent,
  },
  powerStem: {
    position: 'absolute',
    top: -1,
    width: 2.5,
    height: 9,
    borderRadius: 1.5,
    backgroundColor: SL.accent,
  },

  // ── Hero ──────────────────────────────────────────────────────────────────

  hero: {
    alignItems: 'center',
    paddingVertical: 28,
  },
  playerName: {
    fontFamily: F.heading,
    fontSize: 76,
    color: '#FFFFFF',
    letterSpacing: 4,
    textAlign: 'center',
    // Bright white glow halo behind the name.
    textShadowColor: 'rgba(255,255,255,0.75)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 24,
  },
  // ── Rank crest ────────────────────────────────────────────────────────────
  // A game-HUD style insignia: gold flourishes → diamond medallion (the rank
  // numeral) → "CLASS" kicker beneath.
  crestBlock: {
    // Span the full hero width so the flex:1 lines have room to actually extend
    // out to the card edges (without this the block shrinks to its content and
    // the lines collapse to stubs).
    alignSelf: 'stretch',
    width: '100%',
    alignItems: 'center',
    marginTop: 22,
  },
  crest: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    width: '100%',
  },
  // Fixed box the rotated gem + numeral are centered in. Sized larger so even
  // wider roman numerals (VIII, etc.) sit comfortably inside the diamond.
  medallionWrap: {
    width: 124,
    height: 124,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The gem — a rotated square with rounded corners, gold border + ice/gold glow,
  // faint gold-tinted fill.
  medallion: {
    position: 'absolute',
    width: 98,
    height: 98,
    borderRadius: 14,
    borderWidth: 3,
    borderColor: SL.gold,
    backgroundColor: 'rgba(255,215,0,0.06)',
    transform: [{ rotate: '45deg' }],
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 26,
    elevation: 8,
  },
  // Inner outline echoing the gem for depth.
  medallionInner: {
    position: 'absolute',
    width: 70,
    height: 70,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: SL.gold,
    opacity: 0.4,
    transform: [{ rotate: '45deg' }],
  },
  // The rank numeral, upright over the rotated gem — engraved roman (Cinzel Black).
  medallionRank: {
    fontFamily: F.displayHeavy,
    fontSize: 46,
    color: SL.gold,
    letterSpacing: 1,
    textShadowColor: 'rgba(255,215,0,0.9)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
  // The JOB name — the title of the whole card. It is set in the heaviest display
  // cut and large: at 30pt with 0.95 opacity it read as a caption next to the gem.
  crestKicker: {
    fontFamily: F.displayHeavy,
    fontWeight: '900',        // web fallback keeps the weight if Cinzel Black is late
    fontSize: 46,
    color: SL.gold,
    // Tighter than before — at this size the old tracking read thin and stretched.
    letterSpacing: 9,
    // Cinzel renders as all-caps roman capitals; pad the left by one tracking step
    // so the trailing space stays visually centered under the gem.
    paddingLeft: 9,
    marginTop: 18,
    textAlign: 'center',
    textShadowColor: 'rgba(255,215,0,0.55)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
  },
  // ── Stats row ─────────────────────────────────────────────────────────────

  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 12,
    paddingHorizontal: 22,
    paddingVertical: 18,
    alignItems: 'center',
    gap: 4,
    // Soft ice-glow so the headline stat feels like the page's centerpiece.
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
  },
  levelTopRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  levelKicker: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.text,
    letterSpacing: 4,
    textShadowColor: 'rgba(232,244,255,0.35)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  prestigePill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: SL.gold,
    backgroundColor: 'rgba(255,215,0,0.10)',
  },
  prestigePillText: {
    fontFamily: F.heading,
    fontSize: 14,
    color: SL.gold,
    letterSpacing: 1,
  },
  statNumber: {
    fontFamily: F.heading,
    fontSize: 88,
    color: SL.accent,
    letterSpacing: 2,
    lineHeight: 96,
    textShadowColor: 'rgba(74,158,191,0.85)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 30,
  },
  progressBg: {
    width: '100%',
    height: 7,
    backgroundColor: SL.border,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 10,
    // Glow the whole track so the fill reads as energized.
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
  },
  // Animated width wrapper (grows in on load); the fill itself just fills it.
  progressFillWrap: {
    height: '100%',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    width: '100%',
    backgroundColor: SL.accent,
    borderRadius: 4,
  },
  levelBottomRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  progressLabel: {
    fontFamily: F.bodyMed,
    fontSize: 17,
    color: SL.muted,
    letterSpacing: 1.5,
  },
  toNextLabel: {
    fontFamily: F.heading,
    fontSize: 16,
    color: SL.accent,
    letterSpacing: 2,
    textShadowColor: 'rgba(74,158,191,0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },

  

  // ── Today's Missions ──────────────────────────────────────────────────────

  // Today's Missions on top, Daily Quests below — stacked in one column,
  // each in a glowing ice-panel.
  sectionsRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 18,
  },
  sectionPanel: {
    minHeight: 220,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 18,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  panelHeaderBar: {
    width: 4,
    height: 26,
    borderRadius: 2,
    backgroundColor: SL.accent,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  // The title wraps to two lines (e.g. DAILY / QUESTS); flex:1 keeps it from
  // shoving the badge, and the size is tuned so the longest word ("MISSIONS")
  // still fits one line next to the inline badge.
  panelHeaderText: {
    flex: 1,
    fontFamily: F.heading,
    fontSize: 32,
    color: SL.accent,
    letterSpacing: 1,
  },
  // Live progress counter — shares the title row, vertically centered.
  // flexShrink:0 keeps it from being squeezed out past the panel edge.
  countChip: {
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: SL.border,
    backgroundColor: 'rgba(74,158,191,0.08)',
  },
  countChipDone: {
    borderColor: SL.accent,
    backgroundColor: 'rgba(74,158,191,0.18)',
  },
  countChipText: {
    fontFamily: F.heading,
    fontSize: 15,
    color: SL.accent,
    letterSpacing: 0.5,
  },
  countChipTextDone: {
    color: SL.accent,
  },
  panelDivider: {
    height: 1,
    backgroundColor: SL.border,
    opacity: 0.6,
    marginBottom: 16,
  },
  emptyHint: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 0.5,
    opacity: 0.7,
    paddingVertical: 8,
  },

  // Fills the panel below the header so REST DAY sits dead-center, both axes.
  restDay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  restDayText: {
    fontFamily: F.heading,
    fontSize: 36,
    color: SL.muted,
    letterSpacing: 6,
    textAlign: 'center',
  },

  missionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SL.bg,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 8,
    marginBottom: 12,
    overflow: 'hidden',
  },
  missionAccent: {
    width: 3,
    alignSelf: 'stretch',
    backgroundColor: SL.accent,
  },
  missionBody: {
    flex: 1,
    flexShrink: 1,
    paddingHorizontal: 10,
    paddingVertical: 14,
    gap: 5,
  },
  missionTitle: {
    fontFamily: F.heading,
    fontSize: 20,
    color: SL.text,
    letterSpacing: 0.2,
  },
  // Struck out and quieted — but still its own type colour, never repainted.
  missionTitleDone: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  missionCheckbox: {
    width: 20,
    height: 20,
    marginRight: 6,
    borderWidth: 1.5,
    borderColor: SL.muted,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Completed mission card — cool ice-glow instead of green.
  missionCardDone: {
    borderColor: SL.accent,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },
  missionCheckboxDone: {
    backgroundColor: SL.accent,
    borderColor: SL.accent,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
  },
  missionCheckMark: {
    fontFamily: F.heading,
    color: SL.bg,
    fontSize: 15,
  },

  // ── Live (in-progress) mission card ───────────────────────────────────────
  // The card you tap to RESUME a session you're mid-way through. Built to look
  // energized vs. the calm idle cards: animated glow + sweep + pulsing beacon.
  liveCard: {
    position: 'relative',
    backgroundColor: '#06101f',
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 8,
    marginBottom: 12,
    minHeight: 74,
    overflow: 'hidden',
  },
  // Breathing border + halo (opacity animated) sitting over the card edge.
  liveGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#8CE0FF',
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 16,
  },
  // Tall diagonal light bar that streaks across the card on a loop.
  liveSweep: {
    position: 'absolute',
    top: -24,
    bottom: -24,
    width: 46,
    backgroundColor: 'rgba(140,224,255,0.16)',
    shadowColor: '#8CE0FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 12,
  },
  // Energized left rail (the idle card's accent, but glowing + pulsing).
  liveRail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: '#8CE0FF',
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 8,
  },
  liveBody: {
    flex: 1,
    paddingLeft: 14,
    paddingRight: 12,
    paddingVertical: 12,
    gap: 5,
  },
  liveBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#7FE9FF',
    shadowColor: '#7FE9FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 8,
  },
  liveBadgeText: {
    fontFamily: F.heading,
    fontSize: 13,
    color: '#BFEFFF',
    letterSpacing: 3,
    textShadowColor: 'rgba(127,233,255,0.8)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  liveResume: {
    fontFamily: F.heading,
    fontSize: 13,
    color: SL.accent,
    letterSpacing: 2,
    textShadowColor: 'rgba(74,158,191,0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },

  // ── Daily Quests ──────────────────────────────────────────────────────────

  dqCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: SL.bg,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
    overflow: 'hidden',   // keeps the ClearSweep bar inside the card's corners
  },
  dqCardDone: {
    borderColor: SL.accent,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  // Matches missionCheckbox exactly — both boards tick the same way, on the right.
  dqCheckbox: {
    width: 20,
    height: 20,
    borderWidth: 1.5,
    borderColor: SL.muted,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dqCheckboxDone: {
    backgroundColor: SL.accent,
    borderColor: SL.accent,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
  },
  dqCheckMark: {
    fontFamily: F.heading,
    color: SL.bg,
    fontSize: 15,
  },
  dqTitle: {
    flex: 1,
    fontFamily: F.bodyMed,
    fontSize: 20,
    lineHeight: 22,
    color: SL.text,
    letterSpacing: 0.3,
  },
  dqTitleDone: {
    color: SL.muted,
    textDecorationLine: 'line-through',
  },

});
