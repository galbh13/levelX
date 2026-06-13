import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Linking,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';

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
          .select('title, purpose')
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

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.workoutTitle}>{workoutTitle?.toUpperCase()}</Text>
        {workoutPurpose ? (
          <View style={styles.purposeRow}>
            <View style={styles.purposeAccent} />
            <Text style={styles.purposeText}>{workoutPurpose}</Text>
          </View>
        ) : null}
        <View style={styles.divider} />
      </View>

      {loading ? (
        <ActivityIndicator color={SL.accent} style={{ marginTop: 48 }} size="large" />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {/* Exercise list */}
          {exercises.map((ex) => (
            <View key={ex.id} style={styles.exCard}>
              <View style={styles.letterBadge}>
                <Text style={styles.letterText}>{ex.letter}</Text>
              </View>
              <View style={styles.exBody}>
                <Text style={styles.exName}>{ex.name?.toUpperCase()}</Text>
                <View style={styles.metaRow}>
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
                  <TouchableOpacity
                    style={styles.videoBtn}
                    onPress={() => Linking.openURL(ex.youtube_url)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.videoBtnText}>▶ WATCH VIDEO</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ))}

          {exercises.length === 0 && (
            <Text style={styles.emptyText}>NO EXERCISES ADDED YET</Text>
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
                <TouchableOpacity
                  style={[
                    styles.feedbackReadBtn,
                    { borderColor: feedbackIsRead ? SL.gold : SL.muted },
                  ]}
                  onPress={handleToggleFeedbackRead}
                  activeOpacity={0.8}
                >
                  <Text style={[
                    styles.feedbackReadBtnText,
                    { color: feedbackIsRead ? SL.gold : SL.muted },
                  ]}>
                    {feedbackIsRead ? '👁 MARK AS UNREAD' : '👁 MARK AS READ'}
                  </Text>
                </TouchableOpacity>
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
              <TouchableOpacity
                style={[styles.primaryBtn, completing && { opacity: 0.6 }]}
                onPress={handleMarkComplete}
                disabled={completing}
                activeOpacity={0.85}
              >
                {completing
                  ? <ActivityIndicator color={SL.bg} />
                  : <Text style={styles.primaryBtnText}>MARK AS COMPLETE</Text>
                }
              </TouchableOpacity>
            )
          ) : (
            <TouchableOpacity
              style={styles.secondaryBtn}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('WorkoutEdit', { workout, exercises })}
            >
              <Text style={styles.secondaryBtnText}>EDIT WORKOUT</Text>
            </TouchableOpacity>
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg },

  header: {
    width: '100%',
    maxWidth: 1440,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: SL.border,
  },
  backText: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.accent,
    letterSpacing: 2,
    marginBottom: 20,
  },
  workoutTitle: {
    fontFamily: F.heading,
    fontSize: 44,
    color: SL.accent,
    letterSpacing: 4,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  purposeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
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
  divider: {
    height: 2,
    backgroundColor: SL.accent,
    opacity: 0.4,
    marginTop: 20,
    borderRadius: 1,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
  },

  // Cool ice-glow frame wrapping the body, matching the Skills page.
  list: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 20,
    gap: 12,
    width: '100%',
    maxWidth: 1440,
    alignSelf: 'center',
    marginTop: 16,
    marginBottom: 28,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 18,
    backgroundColor: SL.bg,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
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
    borderRadius: 10,
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
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    backgroundColor: 'rgba(74,158,191,0.06)',
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

  videoBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    height: 38,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(74,158,191,0.08)',
  },
  videoBtnText: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.accent,
    letterSpacing: 2,
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
    borderRadius: 4,
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
  feedbackReadBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1.5,
    borderColor: SL.muted,
    borderRadius: 4,
  },
  feedbackReadBtnRead: {
    borderColor: SL.gold,
  },
  feedbackReadBtnText: {
    fontFamily: F.bodyMed,
    fontSize: 13,
    color: SL.muted,
    letterSpacing: 1.5,
  },
  feedbackReadBtnTextRead: {
    color: SL.gold,
  },
  feedbackText: {
    fontFamily: F.body,
    fontSize: 17,
    color: SL.accent,
    letterSpacing: 0.5,
    lineHeight: 25,
  },

  // Buttons
  primaryBtn: {
    height: 54,
    marginTop: 8,
    backgroundColor: SL.accent,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
  },
  primaryBtnText: {
    fontFamily: F.heading,
    fontSize: 24,
    color: SL.bg,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  secondaryBtn: {
    height: 48,
    marginTop: 8,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 10,
    paddingHorizontal: 24,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(74,158,191,0.06)',
  },
  secondaryBtnText: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.accent,
    letterSpacing: 3,
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
