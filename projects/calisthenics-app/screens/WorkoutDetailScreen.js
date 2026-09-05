import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Linking,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useCoach } from '../context/CoachContext';
import { F } from '../constants/fonts';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import PillButton from '../components/PillButton';
import CoachText, { parseCoachText } from '../components/CoachText';
import { buildGalleryIndex, resolveGuide } from '../lib/exerciseGuide';
import { categoryLabel } from '../lib/workouts';


// Session-lifetime cache of everything the screen fetches, keyed by workout id.
// A revisit renders the cached content INSTANTLY (no spinner) and then refetches
// silently in the background, so "View Workout" feels immediate after the first
// open. Module-level: survives unmount/remount, cleared on full app reload.
const detailCache = new Map();

const SL = {
  bg:     '#050912',
  panel:  '#070d1a',
  border: '#1a3a5c',
  accent: '#4A9EBF',
  blue:   '#3A6E9E',
  text:   '#E8F4FF',
  muted:  '#4a6a8a',
  danger: '#FF4444',
  green:  '#4CAF50',
  gold:   '#FFD700',
};

// NOTE: this screen deliberately does NOT wear the workout's type colour. The
// type glow marks a workout in a LIST — which of the day's sessions this is — and
// carries through the live session. Reading the workout is the app's own chrome:
// it stays ice, like every other detail/reading screen.
export default function WorkoutDetailScreen({ route, navigation }) {
  const { workout, studentView } = route.params;

  // Who may EDIT is decided by the navigator, not by the caller's params:
  // `isAdmin` is true only under the coach-side CoachProvider (AdminNavigator).
  // The player's Workouts stack also holds WorkoutDetail — and AllWorkouts, which
  // opens it WITHOUT `studentView` — so the old param-only gate leaked the edit
  // CTA into a player's account. The coach context can't be reached from there.
  const { isAdmin: isCoach = false } = useCoach() ?? {};

  // Seed everything from the cache when this workout was opened before — the
  // full content paints on the very first frame, no spinner.
  const cached = detailCache.get(workout.id);

  const [exercises,      setExercises]      = useState(cached?.exercises ?? []);
  const [loading,        setLoading]        = useState(!cached);
  const [workoutTitle,    setWorkoutTitle]    = useState(cached?.workoutTitle   ?? workout.title   ?? '');
  const [workoutPurpose,  setWorkoutPurpose]  = useState(cached?.workoutPurpose ?? workout.purpose ?? '');
  const [coachFeedback,   setCoachFeedback]   = useState(cached?.coachFeedback  ?? workout.coachFeedback  ?? null);
  const [feedbackIsRead,  setFeedbackIsRead]  = useState(cached?.feedbackIsRead ?? workout.feedbackIsRead ?? false);
  // Fork paths: workouts.branches = [{key,label},{key,label}] (or empty/null).
  const [branches,        setBranches]        = useState(cached?.branches ?? workout.branches ?? []);
  // Shared exercise catalog, keyed both ways so tapping a name can open its
  // how-to card: exact `gallery_id` link first, normalized-name match as fallback.
  const [galleryById,     setGalleryById]     = useState(cached?.galleryById   ?? {});
  const [galleryByName,   setGalleryByName]   = useState(cached?.galleryByName ?? {});

  // Only the FIRST load shows the spinner; focus refetches (e.g. coming back
  // from an exercise card) are silent so the card never collapses and reloads.
  const loadedRef = useRef(!!cached);

  const fetchExercises = useCallback(async () => {
    if (!loadedRef.current) setLoading(true);
    try {
      const queries = [
        supabase
          .from('exercises')
          .select('*')
          .eq('workout_id', workout.id)
          .order('letter', { ascending: true }),
        supabase
          .from('workouts')
          .select('title, purpose, branches')
          .eq('id', workout.id)
          .single(),
        supabase
          .from('exercises_gallery')
          .select('*'),
      ];
      if (workout.overrideId) {
        queries.push(
          supabase
            .from('workout_override_workouts')
            .select('coach_feedback, feedback_is_read')
            .eq('id', workout.overrideId)
            .maybeSingle()
        );
      }
      const [exercisesRes, workoutRes, galleryRes, overrideRes] = await Promise.all(queries);
      if (exercisesRes.error) console.error('[WorkoutDetail] exercises fetch error:', exercisesRes.error);
      const next = {};
      if (workoutRes.data) {
        next.workoutTitle   = workoutRes.data.title ?? '';
        next.workoutPurpose = workoutRes.data.purpose ?? '';
        next.branches       = workoutRes.data.branches ?? [];
        setWorkoutTitle(next.workoutTitle);
        setWorkoutPurpose(next.workoutPurpose);
        setBranches(next.branches);
      }
      if (overrideRes?.data) {
        next.coachFeedback  = overrideRes.data.coach_feedback ?? null;
        next.feedbackIsRead = overrideRes.data.feedback_is_read ?? false;
        setCoachFeedback(next.coachFeedback);
        setFeedbackIsRead(next.feedbackIsRead);
      }
      const { byId: gById, byName: gByName } = buildGalleryIndex(galleryRes.data);
      setGalleryById(gById);
      setGalleryByName(gByName);

      const exercisesWithVideo = (exercisesRes.data ?? []).map(ex => ({
        ...ex,
        youtube_url: resolveGuide(ex, gById, gByName).youtube_url ?? null,
      }));
      setExercises(exercisesWithVideo);

      detailCache.set(workout.id, {
        ...detailCache.get(workout.id),
        ...next,
        exercises: exercisesWithVideo,
        galleryById: gById,
        galleryByName: gByName,
      });
    } catch (e) {
      console.error('[WorkoutDetail] fetchExercises exception:', e);
    }
    loadedRef.current = true;
    setLoading(false);
  }, [workout.id, workout.overrideId]);

  useFocusEffect(useCallback(() => { fetchExercises(); }, [fetchExercises]));

  async function handleToggleFeedbackRead() {
    if (!workout.overrideId) return;
    const newVal = !feedbackIsRead;
    setFeedbackIsRead(newVal);
    const c = detailCache.get(workout.id);
    if (c) detailCache.set(workout.id, { ...c, feedbackIsRead: newVal });
    const { error } = await supabase
      .from('workout_override_workouts')
      .update({ feedback_is_read: newVal })
      .eq('id', workout.overrideId);
    if (error) {
      setFeedbackIsRead(!newVal);
      alert('Failed to update: ' + error.message);
    }
  }

  // Tapping an exercise name opens its how-to card (video + coaching cues).
  // `resolveGuide` always returns something — a name-only placeholder when the
  // movement has no catalog entry — so every title stays tappable.
  const openExercise = (ex) => {
    navigation.navigate('ExerciseDetail', {
      exercise: resolveGuide(ex, galleryById, galleryByName, categoryLabel(workout?.category)),
      hideEdit: true,
    });
  };

  // One exercise card. `compact` shrinks it so two fit side by side in a fork path.
  const renderExercise = (ex, compact = false) => (
    <View key={ex.id} style={[styles.exCard, compact && styles.exCardCompact]}>
      <View style={[styles.letterBadge, compact && styles.letterBadgeSm]}>
        <Text style={[styles.letterText, compact && styles.letterTextSm]}>{ex.letter}</Text>
      </View>
      <View style={styles.exBody}>
        <TouchableOpacity
          onPress={() => openExercise(ex)}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          activeOpacity={0.7}
        >
          <Text style={[styles.exName, styles.exNameLink, compact && styles.exNameSm]}>
            {ex.name?.toUpperCase()}
          </Text>
        </TouchableOpacity>
        {ex.variation ? <CoachText text={ex.variation} style={styles.exVariation} prefix="※ " /> : null}
        <View style={styles.metaRow}>
          {ex.superset_group != null ? (
            <View style={[styles.metaChip, { borderColor: SL.accent }]}>
              <Text style={styles.metaChipText}>⇄ SUPERSET</Text>
            </View>
          ) : null}
          {ex.sets ? (
            <View style={styles.metaChip}><Text style={styles.metaChipText}>{ex.sets} SETS</Text></View>
          ) : null}
          {ex.reps ? (
            <View style={styles.metaChip}><Text style={styles.metaChipText}>{ex.reps} REPS</Text></View>
          ) : null}
        </View>
        {ex.notes ? <CoachText text={ex.notes} style={styles.exNotes} /> : null}
        {ex.youtube_url ? (
          <PillButton
            label="▶ WATCH VIDEO"
            size="sm"
            onPress={() => Linking.openURL(ex.youtube_url)}
            style={{ alignSelf: 'flex-start', marginTop: 8 }}
          />
        ) : null}
      </View>
    </View>
  );

  // Split exercises into the common trunk (branch = null), each fork path, and the
  // merge (post-fork common "ending").
  const trunk   = exercises.filter(e => !e.branch);
  const mergeEx = exercises.filter(e => e.branch === 'merge');
  const hasFork = Array.isArray(branches) && branches.length > 0;
  const branchExercises = (key) => exercises.filter(e => e.branch === key);

  return (
    // fill mode: the frame spans the whole viewport from the first frame — its
    // size comes from the phone, never from the data, so loading can't shrink it.
    <ScreenFrame fill ready={!loading}>
      <ScreenHeader title={workoutTitle} onBack={() => navigation.goBack()} />
      {workoutPurpose ? (
        <View style={styles.purposeRow}>
          {parseCoachText(workoutPurpose).some(p => p.label) ? null : <View style={styles.purposeAccent} />}
          <CoachText text={workoutPurpose} style={styles.purposeText} containerStyle={styles.purposeFlex} />
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={SL.accent} size="large" />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        >
          {/* Common (trunk) exercises — done by everyone, single column */}
          {trunk.map(ex => renderExercise(ex))}

          {exercises.length === 0 && (
            <Text style={styles.emptyText}>NO EXERCISES ADDED YET</Text>
          )}

          {/* Fork — the two paths the player chooses between, side by side */}
          {hasFork && (
            <>
              <View style={styles.forkDivider}>
                <View style={styles.forkLine} />
                <Text style={styles.forkLabel}>⑂ FORK · CHOOSE ONE PATH</Text>
                <View style={styles.forkLine} />
              </View>
              <View style={styles.branchColumns}>
                {branches.map(branch => {
                  const list = branchExercises(branch.key);
                  return (
                    <View key={branch.key} style={styles.branchColumn}>
                      <View style={styles.branchHeader}>
                        <Text style={styles.branchHeaderText} numberOfLines={2}>
                          {(branch.label || `PATH ${branch.key?.toUpperCase()}`).toUpperCase()}
                        </Text>
                      </View>
                      {list.length > 0
                        ? list.map(ex => renderExercise(ex, true))
                        : <Text style={styles.branchEmpty}>END HERE</Text>}
                    </View>
                  );
                })}
              </View>

              {/* Merge — the shared ending both paths rejoin into */}
              {mergeEx.length > 0 && (
                <>
                  <View style={styles.forkDivider}>
                    <View style={styles.forkLine} />
                    <Text style={styles.forkLabel}>⑃ COMMON ENDING</Text>
                    <View style={styles.forkLine} />
                  </View>
                  {mergeEx.map(ex => renderExercise(ex))}
                </>
              )}
            </>
          )}

          <View style={{ height: 16 }} />

          {/* ── Coach Feedback ── */}
          {studentView && coachFeedback?.trim()?.length > 0 ? (
            <View style={[
              styles.feedbackCard,
              feedbackIsRead
                ? { borderColor: SL.border }
                : { borderColor: SL.gold, shadowColor: SL.gold, shadowOpacity: 0.15, shadowRadius: 8 },
            ]}>
              <View style={styles.feedbackHeader}>
                <Text style={styles.feedbackLabel}>FEEDBACK</Text>
                <PillButton
                  label={feedbackIsRead ? 'MARK AS UNREAD' : 'MARK AS READ'}
                  tone={feedbackIsRead ? 'gold' : 'muted'}
                  size="sm"
                  onPress={handleToggleFeedbackRead}
                />
              </View>
              <Text style={[
                styles.feedbackText,
                { color: feedbackIsRead ? SL.muted : SL.gold },
              ]}>
                {coachFeedback}
              </Text>
            </View>
          ) : null}

          {/* CTA — the player's view is READ-ONLY and says nothing about state:
              completion happens on HomeScreen's missions (the checkbox) or by
              finishing a Workout Mode session, and it's reported there and on the
              day board. This screen is just the workout. The coach gets the one
              action there is. */}
          {isCoach ? (
            <PillButton
              label="EDIT WORKOUT"
              size="lg"
              onPress={() => navigation.navigate('WorkoutEdit', { workout, exercises })}
              style={{ marginTop: 8, alignSelf: 'center' }}
            />
          ) : null}

          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  purposeRow: {
    flexDirection: 'row',
    // flex-start + a stretched rail: the bar runs the WHOLE height of the
    // coach's note (Workout Mode's does the same), instead of a 18px stub
    // floating beside a five-line paragraph.
    alignItems: 'stretch',
    gap: 10,
    marginTop: -4,
    marginBottom: 6,
    paddingHorizontal: 22,
    justifyContent: 'center',
  },
  purposeFlex: { flex: 1 },
  purposeAccent: {
    width: 3,
    alignSelf: 'stretch',
    minHeight: 18,
    backgroundColor: SL.accent,
    borderRadius: 2,
  },
  purposeText: {
    fontFamily: F.body,
    fontSize: 20,
    color: SL.muted,
    letterSpacing: 0.5,
  },

  // Centers the first-load spinner in the fixed full-height frame.
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Inner content padding — the ScreenFrame provides the glowing outer frame.
  list: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 12,
  },

  exCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    padding: 16,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderLeftWidth: 4,
    borderLeftColor: SL.accent,
    borderRadius: 12,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
  },
  letterBadge: {
    width: 46,
    height: 46,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(74,158,191,0.1)',
    flexShrink: 0,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  letterText: {
    fontFamily: F.heading,
    fontSize: 24,
    color: SL.accent,
    letterSpacing: 1,
  },

  // ── Compact card + fork columns ───────────────────────────────────────────
  exCardCompact: { padding: 12, gap: 12, borderLeftWidth: 3 },
  letterBadgeSm: { width: 34, height: 34, borderRadius: 8 },
  letterTextSm: { fontSize: 18 },
  exNameSm: { fontSize: 19, letterSpacing: 1 },

  forkDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    marginBottom: 4,
  },
  forkLine: {
    flex: 1,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: SL.accent,
    opacity: 0.4,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
  },
  forkLabel: {
    fontFamily: F.heading,
    fontSize: 16,
    color: SL.accent,
    letterSpacing: 2,
  },
  branchColumns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  branchColumn: { flex: 1, gap: 10 },
  branchHeader: {
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(74,158,191,0.12)',
    alignItems: 'center',
    marginBottom: 2,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
  branchHeaderText: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.accent,
    letterSpacing: 1,
    textAlign: 'center',
  },
  branchEmpty: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 1,
    textAlign: 'center',
    paddingVertical: 16,
    fontStyle: 'italic',
  },
  exBody: { flex: 1, gap: 8 },
  exName: {
    fontFamily: F.heading,
    fontSize: 26,
    color: SL.text,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  // The name is a button into the how-to card — the ice glow marks it tappable.
  exNameLink: {
    color: SL.accent,
    textShadowColor: 'rgba(74,158,191,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  metaChip: {
    borderWidth: 1,
    borderColor: SL.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: 'rgba(74,158,191,0.08)',
  },
  metaChipText: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.accent,
    letterSpacing: 1,
  },
  exNotes: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    lineHeight: 25,
    color: SL.text,
    opacity: 0.75,
    letterSpacing: 0.5,
    fontStyle: 'italic',
    marginTop: 4,
  },
  // Matches the in-session card: the description is what explains the exercise.
  exVariation: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    lineHeight: 25,
    color: SL.accent,
    letterSpacing: 0.5,
    marginTop: 4,
    marginBottom: 4,
  },

  emptyText: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.muted,
    letterSpacing: 3,
    textAlign: 'center',
    marginTop: 32,
  },

  // ── Coach Feedback card ───────────────────────────────────────────────────

  feedbackCard: {
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  feedbackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  feedbackLabel: {
    fontFamily: F.bodyMed,
    fontSize: 13,
    color: SL.muted,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  feedbackText: {
    fontFamily: F.body,
    fontSize: 17,
    color: SL.accent,
    letterSpacing: 0.5,
    lineHeight: 25,
  },
});
