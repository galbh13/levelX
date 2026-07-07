import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, TextInput, Animated, Easing,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { materializeDay } from '../lib/schedule';
import { F } from '../constants/fonts';
import {
  sessionKey, loadSession, saveSession, clearSession,
} from '../lib/workoutSession';
import ScreenFrame from '../components/ScreenFrame';
import PillButton from '../components/PillButton';
import PopCheck from '../components/PopCheck';
import { ShimmerFill, BLUE } from '../components/Shimmer';
import { hapticTap, hapticSuccess } from '../lib/haptics';

const SL = {
  bg:     '#050912',
  panel:  '#070d1a',
  border: '#1a3a5c',
  accent: '#4A9EBF',
  text:   '#E8F4FF',
  muted:  '#4a6a8a',
  green:  '#4CAF50',
  gold:   '#FFD700',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

// `sets` may be a single count ("3") or a RANGE ("1-2"): `required` is the must-do
// count (lower bound), `total` is how many set rows to show (upper bound). Sets
// beyond `required` are optional/bonus.
function parseSets(sets) {
  const s = String(sets ?? '').trim();
  const m = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (a >= 1 && b >= a) return { required: a, total: b };
  }
  const n = parseInt(s, 10);
  const c = Number.isFinite(n) && n > 0 ? n : 1;
  return { required: c, total: c };
}
// Normalize an exercise name for catalog matching — lowercased, punctuation and
// extra whitespace stripped — so minor spacing/formatting differences between the
// workout row and the gallery catalog still match.
function normName(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function setsCountFor(ex) { return parseSets(ex.sets).total; }
function requiredFor(ex)  { return parseSets(ex.sets).required; }

// An exercise is "complete" once its REQUIRED sets are checked done — optional
// (range) sets are bonus and never block completion. A SKIPPED exercise (player
// bailed on it today) counts as complete too, so the NOW marker / flow move on
// past it without it ever blocking the session.
function exComplete(ex, log, skipped) {
  if (skipped?.[ex.id]) return true;
  const done = (log[ex.id] ?? []).filter(s => s.done).length;
  return done >= requiredFor(ex);
}

// Build a fresh per-set log, re-using any saved values for the same exercise.
function buildLog(exercises, saved) {
  const log = {};
  for (const ex of exercises) {
    const n = setsCountFor(ex);
    const savedSets = saved?.log?.[ex.id] ?? [];
    log[ex.id] = Array.from({ length: n }, (_, i) => ({
      done: savedSets[i]?.done ?? false,
      reps: savedSets[i]?.reps ?? '',
    }));
  }
  return log;
}

function withOpenSegment(session) {
  const segs = session.segments ?? [];
  const last = segs[segs.length - 1];
  if (!last || last.end) {
    return { ...session, segments: [...segs, { start: new Date().toISOString(), end: null }] };
  }
  return session;
}

function withClosedSegment(session) {
  const segs = session.segments ?? [];
  const last = segs[segs.length - 1];
  if (last && !last.end) {
    return {
      ...session,
      segments: segs.map((s, i) =>
        i === segs.length - 1 ? { ...s, end: new Date().toISOString() } : s),
    };
  }
  return session;
}

function activeMs(segments, now) {
  return (segments ?? []).reduce((sum, s) => {
    const start = new Date(s.start).getTime();
    const end   = s.end ? new Date(s.end).getTime() : now;
    return sum + Math.max(0, end - start);
  }, 0);
}

function fmtDur(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Index of the exercise the player is currently on = first one whose required
// sets aren't yet done (optional sets don't keep it "current").
function currentIndex(exercises, log, skipped) {
  const idx = exercises.findIndex(ex => !exComplete(ex, log, skipped));
  return idx === -1 ? Math.max(0, exercises.length - 1) : idx;
}

// Group consecutive exercises that share a non-null superset_group into one
// parallel block. Standalone exercises become single-item groups.
function buildGroups(exercises) {
  const groups = [];
  for (const ex of exercises) {
    const last = groups[groups.length - 1];
    if (ex.superset_group != null && last && last.group != null && last.group === ex.superset_group) {
      last.items.push(ex);
    } else {
      groups.push({ group: ex.superset_group ?? null, items: [ex] });
    }
  }
  return groups;
}

// True when every exercise in the group has its REQUIRED sets done (or skipped).
function groupComplete(group, log, skipped) {
  return group.items.every(ex => exComplete(ex, log, skipped));
}

// A set row that flashes a soft green wash when its `done` flips true — the
// most-repeated tap in the app gets a moment of feedback. The overlay is
// absolute (doesn't disturb the flex row) and native-driver opacity only.
function SetFlashRow({ done, style, children }) {
  const flash = useRef(new Animated.Value(0)).current;
  const prev  = useRef(done);
  useEffect(() => {
    if (done && !prev.current) {
      flash.setValue(1);
      Animated.timing(flash, {
        toValue: 0, duration: 650, easing: Easing.out(Easing.quad), useNativeDriver: true,
      }).start();
    }
    prev.current = done;
  }, [done, flash]);
  return (
    <View style={style}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, styles.setFlash, { opacity: flash }]}
      />
      {children}
    </View>
  );
}

// Gentle breathing scale while `active` — used to pull the eye to FINISH once
// the progress bar hits 100%. Sits at rest (scale 1) when inactive.
function Breathe({ active, children }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) { v.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 850, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [active, v]);
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] });
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      {children}
    </Animated.View>
  );
}

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function WorkoutModeScreen({ route, navigation }) {
  const { workout, gallery = false } = route.params;
  // Gallery example workouts aren't scheduled on a date and store their exercises
  // inline (JSONB) rather than in the `exercises` table. They run as a one-off
  // preview: no completion is written and the session key is dateless.
  const isGallery = gallery === true;
  const dateStr = workout.specific_date ?? null;
  const title   = workout.title ?? '';
  const key     = sessionKey(isGallery ? `gallery:${workout.id}` : dateStr, workout.id);

  const [exercises, setExercises] = useState([]);
  const [galleryById,   setGalleryById]   = useState({}); // gallery id → row (how-to card, exact link)
  const [galleryByName, setGalleryByName] = useState({}); // normName → row (fallback for legacy/free-text)
  const [branches,  setBranches]  = useState(null);   // workout fork definitions
  const [session,   setSession]   = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [nowTick,   setNowTick]   = useState(Date.now());
  // Lets the player jump to the fork early (e.g. feeling off) without finishing
  // every trunk set.
  const [forceFork, setForceFork] = useState(false);

  const sessionRef  = useRef(null);
  const finishedRef = useRef(false);
  useEffect(() => { sessionRef.current = session; }, [session]);

  // Live clock for the running timer.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Load exercises + resume (or start) the session, then open a work segment.
  useEffect(() => {
    let alive = true;
    (async () => {
      let exs, br;
      if (isGallery) {
        // Inline exercises from the gallery workout JSONB — synthesize the stable
        // id + letter that the table-backed path would have provided.
        exs = (workout.exercises ?? []).map((e, i) => ({
          id:             `g${i}`,
          letter:         String.fromCharCode(65 + i),
          name:           e.name,
          variation:      e.variation ?? null,
          sets:           e.sets,
          reps:           e.reps,
          notes:          e.notes ?? null,
          superset_group: e.superset_group ?? null,
          branch:         e.branch ?? null,
        }));
        br = workout.branches;
      } else {
        const [{ data, error }, { data: wData }] = await Promise.all([
          supabase
            .from('exercises')
            .select('id, letter, name, variation, sets, reps, notes, superset_group, branch, gallery_id')
            .eq('workout_id', workout.id)
            .order('letter', { ascending: true }),
          supabase.from('workouts').select('branches').eq('id', workout.id).maybeSingle(),
        ]);
        if (error) console.error('[WorkoutMode] exercises:', error);
        exs = data ?? [];
        br  = wData?.branches;
      }

      // The rich "how to perform" card lives in the shared `exercises_gallery`
      // catalog. Exercises picked in the builder carry a `gallery_id` (exact link);
      // legacy/free-text rows fall back to a normalized-name match.
      const { data: galleryRows } = await supabase.from('exercises_gallery').select('*');
      const gById = {};
      const gByName = {};
      for (const g of galleryRows ?? []) {
        gById[g.id] = g;
        if (g.name) gByName[normName(g.name)] = g;
      }

      const saved = await loadSession(key);
      let next = saved
        ? { ...saved, log: buildLog(exs, saved) }
        : { workoutId: workout.id, dateStr, title, startedAt: new Date().toISOString(), segments: [], log: buildLog(exs, null) };
      next = withOpenSegment(next);

      if (!alive) return;
      setExercises(exs);
      setGalleryById(gById);
      setGalleryByName(gByName);
      setBranches(Array.isArray(br) && br.length >= 2 ? br : null);
      setSession(next);
      setLoading(false);
      saveSession(key, next);
    })();
    return () => { alive = false; };
  }, [workout.id, key, dateStr, title, isGallery]);

  // On exit (unmount) without finishing, close the open segment so the time away
  // counts as a break and the session resumes cleanly next time.
  useEffect(() => {
    return () => {
      if (finishedRef.current || !sessionRef.current) return;
      saveSession(key, withClosedSegment(sessionRef.current));
    };
  }, [key]);

  // ── Set logging ────────────────────────────────────────────────────────────

  const updateSet = useCallback((exId, setIdx, patch) => {
    setSession(prev => {
      if (!prev) return prev;
      const sets = (prev.log[exId] ?? []).map((s, i) => i === setIdx ? { ...s, ...patch } : s);
      const next = { ...prev, log: { ...prev.log, [exId]: sets } };
      saveSession(key, next);
      return next;
    });
  }, [key]);

  // Skip (or un-skip) an exercise the player can't / won't do today. A skipped
  // exercise is treated as complete for flow + progress, but its sets are never
  // counted as done. Persisted in the local session so it survives exit/resume.
  const toggleSkip = useCallback((exId) => {
    setSession(prev => {
      if (!prev) return prev;
      const skipped = { ...(prev.skipped ?? {}) };
      if (skipped[exId]) delete skipped[exId]; else skipped[exId] = true;
      const next = { ...prev, skipped };
      saveSession(key, next);
      return next;
    });
  }, [key]);

  // Pick (or change) the fork branch for the rest of the session.
  const chooseBranch = useCallback((branchKey) => {
    setSession(prev => {
      if (!prev) return prev;
      const next = { ...prev, chosenBranch: branchKey };
      saveSession(key, next);
      return next;
    });
  }, [key]);

  // ── Finish ───────────────────────────────────────────────────────────────

  async function markWorkoutDone() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    if (workout.overrideId) {
      await supabase.from('workout_override_workouts')
        .update({ completed: true }).eq('id', workout.overrideId);
      return;
    }
    // Template-derived day: materialize the weekday's skeleton first so siblings
    // are preserved, then complete this workout for the date.
    const { data: existing } = await supabase
      .from('workout_override_workouts')
      .select('id').eq('student_id', user.id).eq('specific_date', dateStr).limit(1);
    if (!existing?.length) {
      const dow = new Date(dateStr + 'T00:00:00').getDay();
      const { data: tmpl } = await supabase
        .from('weekly_workout_template')
        .select('workout_id, day_of_week').eq('student_id', user.id);
      const ids = (tmpl ?? []).filter(t => t.day_of_week === dow).map(t => t.workout_id);
      await materializeDay({ studentId: user.id, coachId: user.id, dateStr, templateWorkoutIds: ids });
    }
    await supabase.from('workout_override_workouts')
      .update({ completed: true })
      .eq('student_id', user.id).eq('specific_date', dateStr).eq('workout_id', workout.id);
  }

  function buildSummary(closed) {
    const now = Date.now();
    const segs = (closed.segments ?? []).map(s => ({ start: s.start, end: s.end ?? new Date(now).toISOString() }));
    const breaks = [];
    for (let i = 1; i < segs.length; i++) {
      const ms = new Date(segs[i].start).getTime() - new Date(segs[i - 1].end).getTime();
      breaks.push({ start: segs[i - 1].end, end: segs[i].start, ms: Math.max(0, ms) });
    }
    // Recap counts the trunk (pre-fork common), the branch actually taken, and the
    // merge (post-fork common ending done by everyone regardless of path).
    const active = exercises.filter(ex =>
      ex.branch == null || ex.branch === closed.chosenBranch || ex.branch === 'merge');
    const chosenLabel = branches?.find(b => b.key === closed.chosenBranch)?.label ?? null;
    const exSummaries = active.map(ex => {
      const sets = closed.log[ex.id] ?? [];
      return {
        letter:    ex.letter,
        name:      ex.name,
        target:    ex.reps,
        skipped:   !!(closed.skipped ?? {})[ex.id],
        totalSets: sets.length,
        doneCount: sets.filter(s => s.done).length,
        reps:      sets.map(s => (s.done ? (String(s.reps).trim() || '✓') : '–')),
      };
    });
    return {
      title,
      dateStr,
      totalActiveMs: activeMs(segs, now),
      spanStart:     segs[0]?.start ?? closed.startedAt,
      spanEnd:       segs[segs.length - 1]?.end ?? new Date(now).toISOString(),
      segments:      segs,
      breaks,
      pathLabel:     chosenLabel,
      exercises:     exSummaries,
      totalSetsDone: exSummaries.reduce((a, e) => a + e.doneCount, 0),
      // A skipped exercise only drops out of the set total if NOTHING was done on
      // it. If the player logged a set or two before skipping, it counts for real.
      totalSets:     exSummaries.reduce((a, e) => a + (e.skipped && e.doneCount === 0 ? 0 : e.totalSets), 0),
      totalReps:     active.reduce((a, ex) =>
        a + (closed.log[ex.id] ?? []).reduce((b, s) => b + (s.done ? (parseInt(s.reps, 10) || 0) : 0), 0), 0),
    };
  }

  async function handleFinish() {
    hapticSuccess();
    finishedRef.current = true;
    const closed = withClosedSegment(sessionRef.current);
    const summary = buildSummary(closed);
    await clearSession(key);
    // Gallery previews aren't scheduled, so there's nothing to mark complete.
    if (!isGallery) {
      try { await markWorkoutDone(); } catch (e) { console.error('[WorkoutMode] markDone:', e); }
    }
    navigation.replace('WorkoutSummary', { summary });
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading || !session) {
    return (
      <ScreenFrame maxWidth={900} ready={false}>
        <View style={{ paddingVertical: 120, alignItems: 'center' }}>
          <ActivityIndicator size="large" color={SL.accent} />
        </View>
      </ScreenFrame>
    );
  }

  // Fork: trunk (pre-fork common), the chosen branch, then merge (post-fork common
  // "ending" everyone does once the paths rejoin).
  const hasFork    = (branches?.length ?? 0) >= 2;
  const chosen     = session.chosenBranch ?? null;
  const skipped    = session.skipped ?? {};
  const trunk      = exercises.filter(ex => ex.branch == null);
  const branchExs  = chosen ? exercises.filter(ex => ex.branch === chosen) : [];
  const mergeExs   = exercises.filter(ex => ex.branch === 'merge');
  // Merge only becomes part of the active run once a path is chosen (it follows it).
  const activeList = [...trunk, ...branchExs, ...(chosen ? mergeExs : [])];
  // Empty trunk → the fork is at the very start, so treat it as already "done".
  const trunkDone  = trunk.every(ex => exComplete(ex, session.log, skipped));

  const trunkGroups  = buildGroups(trunk);
  const branchGroups = buildGroups(branchExs);
  const mergeGroups  = buildGroups(mergeExs);
  const trunkCur     = trunkGroups.findIndex(g => !groupComplete(g, session.log, skipped));
  const branchCur    = branchGroups.findIndex(g => !groupComplete(g, session.log, skipped));
  // The merge highlight only activates after the chosen branch is fully done, so the
  // "NOW" marker flows branch → ending rather than highlighting both at once.
  const branchAllDone = branchGroups.every(g => groupComplete(g, session.log, skipped));
  const mergeCur      = branchAllDone ? mergeGroups.findIndex(g => !groupComplete(g, session.log, skipped)) : -1;

  const curIdx        = currentIndex(activeList, session.log, skipped);
  // Progress counts REQUIRED sets only, so 100% is reachable without the optional
  // (range) bonus sets; done is capped at required so extras don't overshoot.
  // Skipped exercises drop out of the denominator entirely — progress is measured
  // against what the player is actually doing today.
  const allSets       = activeList.reduce((a, ex) => a + (skipped[ex.id] ? 0 : requiredFor(ex)), 0);
  const doneSets      = activeList.reduce((a, ex) => skipped[ex.id] ? a :
    a + Math.min(session.log[ex.id]?.filter(s => s.done).length ?? 0, requiredFor(ex)), 0);
  const elapsed       = activeMs(session.segments, nowTick);
  const breakCount    = Math.max(0, (session.segments?.length ?? 1) - 1);
  const progressPct   = allSets > 0 ? Math.round((doneSets / allSets) * 100) : 0;

  // One exercise card. `current` = it belongs to the active group; `showNow`
  // controls the NOW tag (suppressed inside a superset — the block shows it).
  const renderCard = (ex, { current, showNow }) => {
    const sets    = session.log[ex.id] ?? [];
    const { required, total } = parseSets(ex.sets);
    const isSkip  = !!skipped[ex.id];
    const exDone  = exComplete(ex, session.log, skipped);
    const realDone = !isSkip && exDone;   // actually finished (not just skipped)
    const hot     = current && !exDone;
    return (
      <View
        key={ex.id}
        style={[
          styles.exCard,
          hot && styles.exCardCurrent,
          realDone && styles.exCardDone,
          isSkip && styles.exCardSkipped,
        ]}
      >
        <View style={styles.exHead}>
          <View style={[styles.letterBadge, hot && styles.letterBadgeCurrent]}>
            <Text style={styles.letterText}>{ex.letter}</Text>
          </View>
          <View style={{ flex: 1 }}>
            {(() => {
              // Forgot how to perform this? Tap the name to open its how-to card
              // (video + coaching cues). Resolve the catalog row by the exact
              // `gallery_id` link first, then a normalized-name match for
              // legacy/free-text rows; if nothing matches, fall back to a name-only
              // card ("no video added yet") so every title stays tappable.
              const guide = galleryById[ex.gallery_id]
                ?? galleryByName[normName(ex.name)]
                ?? { name: ex.name, movement_type: ex.variation ?? null };
              return (
                <TouchableOpacity
                  onPress={() => navigation.navigate('ExerciseDetail', { exercise: guide })}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.exName, styles.exNameLink]}>
                    {ex.name?.toUpperCase()} <Text style={styles.exNameHint}>ⓘ</Text>
                  </Text>
                </TouchableOpacity>
              );
            })()}
            <Text style={styles.exTarget}>
              {required === total ? `${total} SETS` : `${required}–${total} SETS`}
              {ex.reps ? ` · ${ex.reps} REPS` : ''}
            </Text>
          </View>
          {showNow && hot && <Text style={styles.nowTag}>NOW</Text>}
          {isSkip ? <Text style={styles.skipTag}>SKIPPED</Text> : realDone && <Text style={styles.doneTag}>✓</Text>}
        </View>

        {ex.variation ? <Text style={styles.exVariation}>※ {ex.variation}</Text> : null}
        {ex.notes ? <Text style={styles.exNotes}>{ex.notes}</Text> : null}

        {/* Sets — rows past the required count are OPTIONAL (range upper bound):
            rendered muted so the mandatory sets read as the real target. */}
        {sets.map((set, si) => {
          const optional = si >= required;
          return (
          <SetFlashRow key={si} done={set.done} style={[styles.setRow, optional && styles.setRowOptional]}>
            <TouchableOpacity
              style={[styles.checkbox, optional && styles.checkboxOptional, set.done && styles.checkboxDone]}
              onPress={() => { if (!set.done) hapticTap(); updateSet(ex.id, si, { done: !set.done }); }}
              activeOpacity={0.8}
            >
              {set.done && <PopCheck><Text style={styles.checkboxMark}>✓</Text></PopCheck>}
            </TouchableOpacity>
            <Text style={[
              styles.setLabel,
              optional && styles.setLabelOptional,
              set.done && { color: SL.green },
            ]}>
              SET {si + 1}{optional ? ' · OPTIONAL' : ''}
            </Text>
            <TextInput
              style={[styles.repsInput, set.done && styles.repsInputDone]}
              value={set.reps}
              onChangeText={(t) => updateSet(ex.id, si, { reps: t.replace(/[^0-9]/g, '') })}
              keyboardType="numeric"
              placeholder={ex.reps ? String(ex.reps) : '—'}
              placeholderTextColor={SL.muted}
              maxLength={4}
            />
            <Text style={styles.repsUnit}>REPS</Text>
          </SetFlashRow>
          );
        })}

        {/* Skip control — bail on this exercise today (can't do it / failing it).
            Only on the live (current) card, or as an UNDO once skipped. */}
        {hot && (
          <PillButton
            label="⏭ SKIP TODAY"
            tone="muted"
            size="sm"
            onPress={() => toggleSkip(ex.id)}
            style={{ alignSelf: 'flex-start', marginTop: 4 }}
          />
        )}
        {isSkip && (
          <PillButton
            label="↺ UNDO SKIP"
            tone="muted"
            size="sm"
            onPress={() => toggleSkip(ex.id)}
            style={{ alignSelf: 'flex-start', marginTop: 4 }}
          />
        )}
      </View>
    );
  };

  // One group: a standalone card, or a superset bracket around its members.
  const renderGroup = (g, keyPrefix, gi, current) => {
    if (g.items.length < 2) return renderCard(g.items[0], { current, showNow: current });
    const done = groupComplete(g, session.log, skipped);
    return (
      <View
        key={`${keyPrefix}${gi}`}
        style={[styles.groupWrap, current && styles.groupWrapCurrent, done && styles.groupWrapDone]}
      >
        <View style={styles.groupHeader}>
          <Text style={styles.groupHeaderText}>⇄ SUPERSET · ANY ORDER</Text>
          {current && !done && <Text style={styles.nowTag}>NOW</Text>}
          {done && <Text style={styles.doneTag}>✓</Text>}
        </View>
        {g.items.map(ex => renderCard(ex, { current, showNow: false }))}
      </View>
    );
  };

  return (
    <ScreenFrame maxWidth={900} ready={!loading}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <PillButton label="← EXIT" size="sm" onPress={() => navigation.goBack()} />
          <View style={styles.timerPill}>
            <View style={styles.liveDot} />
            <Text style={styles.timerText}>{fmtDur(elapsed)}</Text>
          </View>
        </View>
        <Text style={styles.title}>{title?.toUpperCase()}</Text>

        {/* Progress */}
        <View style={styles.progressMetaRow}>
          <Text style={styles.progressMeta}>
            EXERCISE {activeList.length ? curIdx + 1 : 0}/{activeList.length}
          </Text>
          <Text style={styles.progressMeta}>{doneSets}/{allSets} SETS</Text>
          {breakCount > 0 && <Text style={styles.progressMeta}>{breakCount} BREAK{breakCount > 1 ? 'S' : ''}</Text>}
        </View>
        <View style={styles.progressTrack}>
          <ShimmerFill style={[styles.progressFill, { width: `${progressPct}%` }]} colors={BLUE} active />
        </View>
      </View>

      <View style={styles.list}>
        {/* Trunk — the common exercises everyone does */}
        {trunkGroups.map((g, gi) => renderGroup(g, 't', gi, gi === trunkCur))}

        {/* Fork prompt — unlocked once the trunk is done, or early via SKIP AHEAD */}
        {hasFork && !chosen && (() => {
          const forkOpen = trunkDone || forceFork;
          return (
          <View style={[styles.forkCard, forkOpen && styles.forkCardActive]}>
            <Text style={styles.forkTitle}>CHOOSE YOUR PATH</Text>
            <Text style={styles.forkSub}>Pick what fits your body today.</Text>
            {branches.map(b => (
              <PillButton
                key={b.key}
                label={(b.label || b.key).toUpperCase()}
                variant="solid"
                size="lg"
                disabled={!forkOpen}
                onPress={() => chooseBranch(b.key)}
                style={{ alignSelf: 'stretch', marginTop: 4 }}
              />
            ))}
            {!forkOpen && (
              <PillButton
                label="⏭ SKIP AHEAD TO PATH"
                tone="muted"
                onPress={() => setForceFork(true)}
                style={{ alignSelf: 'stretch', marginTop: 4 }}
              />
            )}
          </View>
          );
        })()}

        {/* Chosen branch — the rest of the workout */}
        {hasFork && chosen && (
          <>
            <View style={styles.pathBanner}>
              <Text style={styles.pathBannerText}>
                PATH · {(branches.find(b => b.key === chosen)?.label || chosen).toUpperCase()}
              </Text>
              <TouchableOpacity onPress={() => chooseBranch(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.pathChange}>↺ CHANGE</Text>
              </TouchableOpacity>
            </View>
            {branchGroups.length === 0
              ? (mergeGroups.length === 0
                  ? <Text style={styles.branchEmpty}>This path ends the workout — hit FINISH below.</Text>
                  : null)
              : branchGroups.map((g, gi) => renderGroup(g, 'b', gi, gi === branchCur))}

            {/* Merge — the common ending both paths rejoin into */}
            {mergeGroups.length > 0 && (
              <>
                <View style={styles.mergeBanner}>
                  <Text style={styles.mergeBannerText}>⑃ COMMON ENDING</Text>
                </View>
                {mergeGroups.map((g, gi) => renderGroup(g, 'm', gi, gi === mergeCur))}
              </>
            )}
          </>
        )}

        {exercises.length === 0 && (
          <Text style={styles.emptyText}>NO EXERCISES IN THIS WORKOUT</Text>
        )}

        {/* Breathes once every required set is done — the eye lands on the exit. */}
        <Breathe active={allSets > 0 && doneSets >= allSets}>
          <PillButton
            label="FINISH WORKOUT"
            variant="solid"
            size="lg"
            onPress={handleFinish}
            style={{ marginTop: 8 }}
          />
        </Breathe>
        <Text style={styles.finishHint}>Exit anytime — your progress is saved and you can resume.</Text>

        <View style={{ height: 32 }} />
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  // Header
  header: {
    width: '100%', maxWidth: 1440, alignSelf: 'center',
    paddingHorizontal: 24, paddingTop: 56, paddingBottom: 18,
    borderBottomWidth: 1, borderBottomColor: SL.border,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timerPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 6,
    borderWidth: 1.5, borderColor: SL.accent, borderRadius: 20,
    backgroundColor: 'rgba(74,158,191,0.08)',
  },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: SL.green },
  timerText: { fontFamily: F.heading, fontSize: 20, color: SL.accent, letterSpacing: 1 },
  title: {
    fontFamily: F.heading, fontSize: 34, color: SL.accent,
    letterSpacing: 3, textTransform: 'uppercase', marginTop: 14,
  },
  progressMetaRow: { flexDirection: 'row', gap: 16, marginTop: 14, flexWrap: 'wrap' },
  progressMeta: { fontFamily: F.body, fontSize: 15, color: SL.muted, letterSpacing: 1.5 },
  progressTrack: {
    height: 6, borderRadius: 3, marginTop: 10,
    backgroundColor: SL.panel, borderWidth: 1, borderColor: SL.border, overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: SL.accent, borderRadius: 3 },

  // List
  list: { paddingHorizontal: 16, paddingTop: 16, gap: 12, width: '100%', maxWidth: 1440, alignSelf: 'center' },

  exCard: {
    backgroundColor: SL.panel, borderWidth: 1.5, borderColor: SL.border,
    borderLeftWidth: 4, borderLeftColor: SL.border, borderRadius: 10, padding: 16, gap: 10,
  },
  exCardCurrent: {
    borderColor: SL.accent, borderLeftColor: SL.accent,
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.35, shadowRadius: 14,
  },
  exCardDone: { borderLeftColor: SL.green, opacity: 0.85 },
  exCardSkipped: { borderLeftColor: SL.muted, opacity: 0.6 },

  // Parallel-superset bracket wrapping its member cards.
  groupWrap: {
    borderWidth: 1.5, borderColor: SL.border, borderStyle: 'dashed',
    borderRadius: 12, padding: 10, gap: 10,
    backgroundColor: 'rgba(74,158,191,0.04)',
  },
  groupWrapCurrent: {
    borderColor: SL.accent,
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 12,
  },
  groupWrapDone: { borderColor: SL.green, opacity: 0.9 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  groupHeaderText: {
    flex: 1, fontFamily: F.heading, fontSize: 14, color: SL.accent,
    letterSpacing: 1.5, textTransform: 'uppercase',
  },

  // ── Fork (branch choice) ──────────────────────────────────────────────────
  forkCard: {
    borderWidth: 1.5, borderColor: SL.border, borderStyle: 'dashed', borderRadius: 12,
    padding: 18, gap: 10, alignItems: 'center', backgroundColor: SL.panel, opacity: 0.7,
  },
  forkCardActive: {
    opacity: 1, borderStyle: 'solid', borderColor: SL.accent,
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.35, shadowRadius: 16,
  },
  forkTitle: {
    fontFamily: F.heading, fontSize: 22, color: SL.accent, letterSpacing: 2,
    textTransform: 'uppercase', textAlign: 'center',
  },
  forkSub: {
    fontFamily: F.bodyMed, fontSize: 16, color: SL.muted, letterSpacing: 0.5, textAlign: 'center',
  },
  pathBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderColor: SL.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: 'rgba(74,158,191,0.08)',
  },
  pathBannerText: {
    flex: 1, fontFamily: F.heading, fontSize: 18, color: SL.accent, letterSpacing: 1.5, textTransform: 'uppercase',
  },
  pathChange: { fontFamily: F.bodyMed, fontSize: 15, color: SL.muted, letterSpacing: 1 },
  mergeBanner: {
    alignItems: 'center', borderWidth: 1.5, borderColor: SL.accent, borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 10, backgroundColor: 'rgba(74,158,191,0.08)',
    marginTop: 4,
  },
  mergeBannerText: {
    fontFamily: F.heading, fontSize: 16, color: SL.accent, letterSpacing: 1.5, textTransform: 'uppercase',
  },
  branchEmpty: {
    fontFamily: F.bodyMed, fontSize: 16, color: SL.muted, letterSpacing: 0.5,
    textAlign: 'center', paddingVertical: 20,
  },

  exHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  letterBadge: {
    width: 44, height: 44, borderWidth: 1.5, borderColor: SL.border, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(74,158,191,0.06)',
  },
  letterBadgeCurrent: { borderColor: SL.accent, backgroundColor: 'rgba(74,158,191,0.12)' },
  letterText: { fontFamily: F.heading, fontSize: 22, color: SL.accent },
  exName: { fontFamily: F.heading, fontSize: 23, color: SL.text, letterSpacing: 1.5, textTransform: 'uppercase' },
  // Tappable name → opens the exercise's how-to card. Ice-glow to read as a link.
  exNameLink: {
    color: SL.accent,
    textShadowColor: 'rgba(74,158,191,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
  },
  exNameHint: { fontFamily: F.heading, fontSize: 17, color: SL.accent },
  exTarget: { fontFamily: F.bodyMed, fontSize: 16, color: SL.muted, letterSpacing: 1, marginTop: 2 },
  nowTag: {
    fontFamily: F.heading, fontSize: 14, color: SL.bg, letterSpacing: 1.5,
    backgroundColor: SL.accent, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, overflow: 'hidden',
  },
  doneTag: { fontFamily: F.heading, fontSize: 24, color: SL.green },
  skipTag: {
    fontFamily: F.heading, fontSize: 13, color: SL.muted, letterSpacing: 1.5,
    borderWidth: 1, borderColor: SL.muted, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 4, overflow: 'hidden',
  },
  exVariation: { fontFamily: F.bodyMed, fontSize: 15, color: SL.accent, letterSpacing: 0.5, marginBottom: 2 },
  exNotes: { fontFamily: F.bodyMed, fontSize: 16, color: SL.muted, fontStyle: 'italic', letterSpacing: 0.5 },

  setRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(26,58,92,0.5)',
  },
  // The one-shot green wash SetFlashRow fades out after a set is checked.
  setFlash: { backgroundColor: 'rgba(76,175,80,0.16)', borderRadius: 8 },
  checkbox: {
    width: 34, height: 34, borderWidth: 2, borderColor: SL.muted, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center',
  },
  checkboxDone: { borderColor: SL.green, backgroundColor: 'rgba(76,175,80,0.15)' },
  checkboxMark: { fontFamily: F.heading, fontSize: 20, color: SL.green },
  setLabel: { fontFamily: F.body, fontSize: 17, color: SL.text, letterSpacing: 1.5, width: 64 },
  // Optional (range-bonus) sets read muted so the required sets stand out.
  setRowOptional: { opacity: 0.55 },
  checkboxOptional: { borderColor: SL.border, borderStyle: 'dashed' },
  setLabelOptional: { color: SL.muted, fontSize: 13, letterSpacing: 1, width: 'auto' },
  repsInput: {
    width: 120, height: 42, borderWidth: 1.5, borderColor: SL.border, borderRadius: 8,
    textAlign: 'center', fontFamily: F.heading, fontSize: 20, color: SL.text,
    backgroundColor: SL.bg, marginLeft: 'auto', paddingHorizontal: 8,
  },
  repsInputDone: { borderColor: SL.green, color: SL.green },
  repsUnit: { fontFamily: F.bodyMed, fontSize: 14, color: SL.muted, letterSpacing: 1.5, width: 42 },

  emptyText: {
    fontFamily: F.heading, fontSize: 20, color: SL.muted, letterSpacing: 2,
    textAlign: 'center', marginVertical: 32,
  },

  finishHint: { fontFamily: F.bodyMed, fontSize: 14, color: SL.muted, textAlign: 'center', marginTop: 10, letterSpacing: 0.5 },
});
