import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';

export default function WorkoutDetailScreen({ route, navigation }) {
  const { workout } = route.params;

  const [exercises, setExercises] = useState(workout.exercises ?? []);
  const [loading, setLoading]     = useState(!workout.exercises);

  useEffect(() => {
    if (!workout.exercises) fetchExercises();
  }, []);

  async function fetchExercises() {
    try {
      const { data, error } = await supabase
        .from('exercises')
        .select('id, letter, name, sets, reps, notes')
        .eq('workout_id', workout.id)
        .order('letter', { ascending: true });
      if (!error && data) setExercises(data);
    } catch { /* silent */ }
    setLoading(false);
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{workout.title}</Text>
        {workout.purpose ? (
          <Text style={styles.purpose}>{workout.purpose}</Text>
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator color={C.iceGlow} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {exercises.map((ex) => (
            <View key={ex.id} style={styles.exerciseCard}>
              <View style={styles.letterBadge}>
                <Text style={styles.letterText}>{ex.letter}</Text>
              </View>
              <View style={styles.exerciseBody}>
                <Text style={styles.exerciseName}>{ex.name}</Text>
                <View style={styles.metaRow}>
                  <Text style={styles.metaItem}>{ex.sets} sets</Text>
                  <Text style={styles.metaDivider}>·</Text>
                  <Text style={styles.metaItem}>{ex.reps} reps</Text>
                  {ex.notes ? (
                    <>
                      <Text style={styles.metaDivider}>·</Text>
                      <Text style={[styles.metaItem, styles.notes]}>{ex.notes}</Text>
                    </>
                  ) : null}
                </View>
              </View>
            </View>
          ))}

          {exercises.length === 0 && (
            <Text style={styles.empty}>No exercises added yet.</Text>
          )}

          {/* Edit placeholder */}
          <TouchableOpacity style={styles.editBtn} activeOpacity={0.8}>
            <Text style={styles.editBtnText}>Edit Workout</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  header: {
    paddingHorizontal: 24,
    paddingTop: 56,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: C.cardBorder,
  },
  back:     { marginBottom: 12 },
  backText: { fontFamily: F.bodyMed, color: C.iceGlow, fontSize: 13, letterSpacing: 2 },
  title: {
    fontFamily: F.heading,
    fontSize: 22,
    color: C.text,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  purpose: {
    fontFamily: F.body,
    fontSize: 12,
    color: C.textMuted,
    letterSpacing: 0.5,
    marginTop: 6,
  },

  list: {
    padding: 16,
    gap: 12,
  },

  exerciseCard: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 10,
    padding: 16,
    gap: 14,
    alignItems: 'flex-start',
  },
  letterBadge: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: C.lockedBg,
    borderWidth: 1,
    borderColor: C.deepBlue,
    justifyContent: 'center',
    alignItems: 'center',
  },
  letterText: {
    fontFamily: F.heading,
    fontSize: 14,
    color: C.iceGlow,
    letterSpacing: 1,
  },
  exerciseBody: { flex: 1, gap: 6 },
  exerciseName: {
    fontFamily: F.heading,
    fontSize: 13,
    color: C.text,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
  },
  metaItem: {
    fontFamily: F.body,
    fontSize: 11,
    color: C.textMuted,
    letterSpacing: 0.5,
  },
  metaDivider: {
    color: C.textMuted,
    fontSize: 11,
  },
  notes: {
    fontStyle: 'italic',
  },

  empty: {
    fontFamily: F.body,
    fontSize: 13,
    color: C.textMuted,
    textAlign: 'center',
    marginTop: 32,
  },

  editBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  editBtnText: {
    fontFamily: F.heading,
    fontSize: 12,
    color: C.textMuted,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});
