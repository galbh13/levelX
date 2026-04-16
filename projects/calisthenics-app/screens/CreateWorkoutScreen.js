import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export default function CreateWorkoutScreen({ route, navigation }) {
  const { student, day } = route.params;

  const [title,     setTitle]     = useState('');
  const [purpose,   setPurpose]   = useState('');
  const [date,      setDate]      = useState(day?.dateStr ?? '');
  const [exercises, setExercises] = useState([]);
  const [saving,    setSaving]    = useState(false);

  // Receive a selected exercise from ExerciseGallery
  useEffect(() => {
    if (route.params?.selectedExercise) {
      const ex = route.params.selectedExercise;
      setExercises(prev => [
        ...prev,
        { tempId: Date.now().toString(), exercise: ex, sets: '', reps: '', notes: '' },
      ]);
      // Clear the param so re-renders don't re-add
      navigation.setParams({ selectedExercise: undefined });
    }
  }, [route.params?.selectedExercise]);

  function updateExercise(tempId, field, value) {
    setExercises(prev =>
      prev.map(e => e.tempId === tempId ? { ...e, [field]: value } : e)
    );
  }

  function removeExercise(tempId) {
    setExercises(prev => prev.filter(e => e.tempId !== tempId));
  }

  async function handleSave() {
    if (!title.trim()) { Alert.alert('Required', 'Please enter a workout title.'); return; }
    if (!date.trim())  { Alert.alert('Required', 'Please enter a scheduled date.'); return; }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { data: workout, error: workoutError } = await supabase
        .from('workouts')
        .insert({
          title:          title.trim(),
          purpose:        purpose.trim() || null,
          assigned_to:    student.id,
          created_by:     user.id,
          scheduled_date: date.trim(),
        })
        .select('id')
        .single();

      if (workoutError) throw workoutError;

      if (exercises.length > 0) {
        const rows = exercises.map((e, idx) => ({
          workout_id: workout.id,
          letter:     LETTERS[idx] ?? String(idx + 1),
          name:       e.exercise.name,
          sets:       parseInt(e.sets) || null,
          reps:       e.reps.trim() || null,
          notes:      e.notes.trim() || null,
        }));
        const { error: exError } = await supabase.from('exercises').insert(rows);
        if (exError) throw exError;
      }

      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.message ?? 'Failed to save workout.');
    }
    setSaving(false);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.title}>New Workout</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.studentLabel}>For: <Text style={styles.studentName}>{student.full_name}</Text></Text>

        {/* Title */}
        <Text style={styles.label}>Workout Title</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Pull Day A"
          placeholderTextColor={C.textMuted}
          value={title}
          onChangeText={setTitle}
        />

        {/* Purpose */}
        <Text style={styles.label}>Goal / Purpose <Text style={styles.optional}>(optional)</Text></Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Build pulling strength"
          placeholderTextColor={C.textMuted}
          value={purpose}
          onChangeText={setPurpose}
        />

        {/* Date */}
        <Text style={styles.label}>Scheduled Date</Text>
        <TextInput
          style={styles.input}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={C.textMuted}
          value={date}
          onChangeText={setDate}
        />

        {/* Exercises */}
        <View style={styles.exercisesHeader}>
          <Text style={styles.label}>Exercises</Text>
          <TouchableOpacity
            style={styles.addExBtn}
            onPress={() => navigation.navigate('ExerciseGallery', {
              selectionMode: true,
              returnTo: 'CreateWorkout',
            })}
          >
            <Text style={styles.addExBtnText}>+ Add Exercise</Text>
          </TouchableOpacity>
        </View>

        {exercises.map((item, idx) => (
          <View key={item.tempId} style={styles.exerciseRow}>
            <View style={styles.letterBadge}>
              <Text style={styles.letterText}>{LETTERS[idx]}</Text>
            </View>
            <View style={styles.exerciseFields}>
              <Text style={styles.exerciseTitle}>{item.exercise.name}</Text>
              <View style={styles.inlineRow}>
                <TextInput
                  style={[styles.input, styles.inputSmall]}
                  placeholder="Sets"
                  placeholderTextColor={C.textMuted}
                  value={item.sets}
                  onChangeText={v => updateExercise(item.tempId, 'sets', v)}
                  keyboardType="numeric"
                />
                <TextInput
                  style={[styles.input, styles.inputSmall]}
                  placeholder="Reps"
                  placeholderTextColor={C.textMuted}
                  value={item.reps}
                  onChangeText={v => updateExercise(item.tempId, 'reps', v)}
                />
              </View>
              <TextInput
                style={[styles.input, styles.inputNotes]}
                placeholder="Coaching notes..."
                placeholderTextColor={C.textMuted}
                value={item.notes}
                onChangeText={v => updateExercise(item.tempId, 'notes', v)}
                multiline
              />
            </View>
            <TouchableOpacity onPress={() => removeExercise(item.tempId)} style={styles.removeBtn}>
              <Text style={styles.removeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}

        {exercises.length === 0 && (
          <Text style={styles.emptyExercises}>No exercises added yet.</Text>
        )}

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveBtnText}>Save Workout</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.cardBorder,
  },
  back: { width: 60 },
  backText: { fontFamily: F.bodyMed, color: C.iceGlow, fontSize: 13, letterSpacing: 2 },
  title: {
    flex: 1,
    fontFamily: F.heading,
    fontSize: 18,
    color: C.text,
    letterSpacing: 3,
    textTransform: 'uppercase',
    textAlign: 'center',
  },

  form: { padding: 20, gap: 6, paddingBottom: 60 },

  studentLabel: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: C.textMuted,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  studentName: { color: C.iceGlow },

  label: {
    fontFamily: F.bodyMed,
    fontSize: 11,
    color: C.textMuted,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 4,
  },
  optional: { fontSize: 10 },

  input: {
    height: 50,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 8,
    paddingHorizontal: 14,
    fontFamily: F.body,
    fontSize: 14,
    color: C.text,
  },

  exercisesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  addExBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: C.iceGlow,
    borderRadius: 6,
  },
  addExBtnText: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: C.iceGlow,
    letterSpacing: 1,
  },

  exerciseRow: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 10,
    padding: 12,
    gap: 10,
    marginTop: 10,
    alignItems: 'flex-start',
  },
  letterBadge: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: C.lockedBg,
    borderWidth: 1,
    borderColor: C.deepBlue,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  letterText: { fontFamily: F.heading, fontSize: 14, color: C.iceGlow },
  exerciseFields: { flex: 1, gap: 6 },
  exerciseTitle: {
    fontFamily: F.heading,
    fontSize: 12,
    color: C.text,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  inlineRow: { flexDirection: 'row', gap: 8 },
  inputSmall: { flex: 1, height: 42, fontSize: 13 },
  inputNotes: { height: 60, paddingTop: 10, fontSize: 12, textAlignVertical: 'top' },

  removeBtn: { padding: 4, marginTop: 2 },
  removeBtnText: { color: C.textMuted, fontSize: 16 },

  emptyExercises: {
    fontFamily: F.body,
    fontSize: 12,
    color: C.textMuted,
    textAlign: 'center',
    marginTop: 12,
    letterSpacing: 1,
  },

  saveBtn: {
    marginTop: 28,
    height: 52,
    backgroundColor: C.iceGlow,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: {
    fontFamily: F.heading,
    fontSize: 13,
    color: '#fff',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
});
