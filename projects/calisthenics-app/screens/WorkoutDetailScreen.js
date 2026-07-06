import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Linking,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import PillButton from '../components/PillButton';

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

export default function WorkoutDetailScreen({ route, navigation }) {
  const { workout, studentView } = route.params;

  const [exercises,      setExercises]      = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [completed,       setCompleted]       = useState(workout.completed    ?? false);
  const [completing,      setCompleting]      = useState(false);
  const [workoutTitle,    setWorkoutTitle]    = useState(workout.title        ?? '');
  const [workoutPurpose,  setWorkoutPurpose]  = useState(workout.purpose      ?? '');
  const [coachFeedback,   setCoachFeedback]   = useState(workout.coachFeedback  ?? null);
  const [feedbackIsRead,  setFeedbackIsRead]  = useState(workout.feedbackIsRead ?? false);
  // Fork paths: workouts.branches = [{key,label},{key,label}] (or empty/null).
  const [branches,        setBranches]        = useState(workout.branches ?? []);

  const fetchExercises = useCallback(async () => {
    setLoading(true);
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
          .select('name, youtube_url'),
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
      if (workoutRes.data) {
        setWorkoutTitle(workoutRes.data.title ?? '');
        setWorkoutPurpose(workoutRes.data.purpose ?? '');
        setBranches(workoutRes.data.branches ?? []);
      }
      if (overrideRes?.data) {
        setCoachFeedback(overrideRes.data.coach_feedback ?? null);
        setFeedbackIsRead(overrideRes.data.feedback_is_read ?? false);
      }
      const galleryMap = Object.fromEntries(
        (galleryRes.data ?? []).map(g => [g.name.toLowerCase(), g.youtube_url])
      );
      const exercisesWithVideo = (exercisesRes.data ?? []).map(ex => ({
        ...ex,
        youtube_url: galleryMap[ex.name?.toLowerCase()] ?? null,
      }));
      setExercises(exercisesWithVideo);
    } catch (e) {
      console.error('[WorkoutDetail] fetchExercises exception:', e);
    }
    setLoading(false);
  }, [workout.id, workout.overrideId]);

  useFocusEffect(useCallback(() => { fetchExercises(); }, [fetchExercises]));

  async function handleToggleFeedbackRead() {
    if (!workout.overrideId) return;
    const newVal = !feedbackIsRead;
    setFeedbackIsRead(newVal);
    const { error } = await supabase
      .from('workout_override_workouts')
      .update({ feedback_is_read: newVal })
      .eq('id', workout.overrideId);
    if (error) {
      setFeedbackIsRead(!newVal);
      alert('Failed to update: ' + error.message);
    }
  }

  async function handleMarkComplete() {
    setCompleting(true);
    try {
      const { error } = await supabase
        .from('workouts')
        .update({ completed: true })
        .eq('id', workout.id);
      if (!error) setCompleted(true);
      else        alert('Could not mark workout as complete.');
    } catch {
      alert('Something went wrong.');
    }
    setCompleting(false);
  }

  // One exercise card. `compact` shrinks it so two fit side by side in a fork path.
  const renderExercise = (ex, compact = false) => (
    <View key={ex.id} style={[styles.exCard, compact && styles.exCardCompact]}>
      <View style={[styles.letterBadge, compact && styles.letterBadgeSm]}>
        <Text style={[styles.letterText, compact && styles.letterTextSm]}>{ex.letter}</Text>
      </View>
      <View style={styles.exBody}>
        <Text style={[styles.exName, compact && styles.exNameSm]}>{ex.name?.toUpperCase()}</Text>
        {ex.variation ? <Text style={styles.exVariation}>※ {ex.variation}</Text> : null}
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
        {ex.notes ? (
          <Text style={styles.exNotes}>{ex.notes}</Text>
        ) : null}
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
    <ScreenFrame maxWidth={900} ready={!loading}>
      <ScreenHeader title={workoutTitle} onBack={() => navigation.goBack()} />
      {workoutPurpose ? (
        <View style={styles.purposeRow}>
          <View style={styles.purposeAccent} />
          <Text style={styles.purposeText}>{workoutPurpose}</Text>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator color={SL.accent} style={{ marginTop: 48 }} size="large" />
      ) : (
        <View style={styles.list}>
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
                <Text style={styles.feedbackLabel}>COACH FEEDBACK</Text>
                <PillButton
                  label={feedbackIsRead ? '👁 MARK AS UNREAD' : '👁 MARK AS READ'}
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

          {/* CTA */}
          {studentView ? (
            completed ? (
              <View style={styles.completedBanner}>
                <Text style={styles.completedText}>✅ MISSION COMPLETE</Text>
              </View>
            ) : (
              <PillButton
                label="MARK AS COMPLETE"
                variant="solid"
                size="lg"
                onPress={handleMarkComplete}
                disabled={completing}
                loading={completing}
                style={{ marginTop: 8 }}
              />
            )
          ) : (
            <PillButton
              label="EDIT WORKOUT"
              size="lg"
              onPress={() => navigation.navigate('WorkoutEdit', { workout, exercises })}
              style={{ marginTop: 8, alignSelf: 'center' }}
            />
          )}

          <View style={{ height: 32 }} />
        </View>
      )}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg },

  purposeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: -4,
    marginBottom: 6,
    paddingHorizontal: 22,
    justifyContent: 'center',
  },
  purposeAccent: {
    width: 3,
    height: 18,
    backgroundColor: SL.accent,
    borderRadius: 2,
  },
  purposeText: {
    fontFamily: F.body,
    fontSize: 20,
    color: SL.muted,
    letterSpacing: 0.5,
  },

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
    color: SL.muted,
    letterSpacing: 0.5,
    fontStyle: 'italic',
    marginTop: 2,
  },
  exVariation: {
    fontFamily: F.bodyMed,
    fontSize: 15,
    color: SL.accent,
    letterSpacing: 0.5,
    marginTop: 2,
    marginBottom: 2,
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

  completedBanner: {
    height: 54,
    marginTop: 8,
    borderWidth: 1.5,
    borderColor: '#4CAF50',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(76,175,80,0.08)',
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  completedText: {
    fontFamily: F.heading,
    fontSize: 24,
    color: '#4CAF50',
    letterSpacing: 3,
  },
});
