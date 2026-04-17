import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useCoach } from '../context/CoachContext';
import { F } from '../constants/fonts';

// ─── Theme ────────────────────────────────────────────────────────────────────

const SL = {
  bg:     '#050912',
  panel:  '#070d1a',
  border: '#1a3a5c',
  accent: '#4A9EBF',
  text:   '#E8F4FF',
  muted:  '#4a6a8a',
  danger: '#FF4444',
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CreateWorkoutScreen({ navigation }) {
  const {
    selectedStudent,
    selectedDay,
    pendingExercises,
    removeExercise,
    clearExercises,
  } = useCoach();

  const [title,           setTitle]           = useState('');
  const [purpose,         setPurpose]         = useState('');
  // Keyed by ex._uid for stability when exercises are removed mid-list
  const [exerciseDetails, setExerciseDetails] = useState({});
  const [saving,          setSaving]          = useState(false);

  // Clear any leftover exercises from a previous session
  useEffect(() => { clearExercises(); }, []);

  function updateDetail(uid, field, value) {
    setExerciseDetails(prev => ({
      ...prev,
      [uid]: { ...prev[uid], [field]: value },
    }));
  }

  function handleRemove(index, uid) {
    removeExercise(index);
    // Drop the details entry for this exercise
    setExerciseDetails(prev => {
      const next = { ...prev };
      delete next[uid];
      return next;
    });
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  const canSave = title.trim().length > 0 && pendingExercises.length > 0 && !saving;

  const handleSave = async () => {
    if (!title.trim())                { alert('Please enter a workout title.');      return; }
    if (pendingExercises.length === 0){ alert('Please add at least one exercise.'); return; }
    if (!selectedStudent)             { alert('No student selected.');               return; }

    setSaving(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;

      const { data: workout, error: workoutError } = await supabase
        .from('workouts')
        .insert({
          title:       title.trim(),
          purpose:     purpose.trim(),
          assigned_to: selectedStudent.id,
          created_by:  user.id,
        })
        .select()
        .single();

      if (workoutError) throw workoutError;

      if (selectedDay?.dateStr) {
        const { error: assignError } = await supabase
          .from('workout_override_workouts')
          .insert({
            student_id:    selectedStudent.id,
            coach_id:      user.id,
            specific_date: selectedDay.dateStr,
            workout_id:    workout.id,
          });
        if (assignError) throw assignError;
      }

      for (let i = 0; i < pendingExercises.length; i++) {
        const ex      = pendingExercises[i];
        const details = exerciseDetails[ex._uid] ?? {};
        const { error: exError } = await supabase.from('exercises').insert({
          workout_id: workout.id,
          letter:     String.fromCharCode(65 + i),
          name:       ex.name,
          sets:       parseInt(details.sets) || 0,
          reps:       details.reps  ?? '',
          notes:      details.notes ?? '',
        });
        if (exError) throw exError;
      }

      clearExercises();
      alert('Workout saved successfully!');
      navigation.goBack();
    } catch (err) {
      alert('Failed to save: ' + (err.message ?? 'Unknown error'));
    }
    setSaving(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.title}>CREATE WORKOUT</Text>
        {selectedStudent && (
          <Text style={styles.studentCtx}>
            FOR: <Text style={styles.studentCtxName}>{selectedStudent.full_name?.toUpperCase()}</Text>
          </Text>
        )}
        {selectedDay && (
          <Text style={styles.dayCtx}>{selectedDay.label} · {selectedDay.dateStr}</Text>
        )}
        <View style={styles.divider} />
      </View>

      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">

        {/* Workout Title */}
        <Text style={styles.inputLabel}>WORKOUT TITLE</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. PULL DAY A"
          placeholderTextColor={SL.muted}
          value={title}
          onChangeText={setTitle}
        />

        {/* Purpose */}
        <Text style={styles.inputLabel}>
          GOAL / PURPOSE{'  '}
          <Text style={styles.optional}>(OPTIONAL)</Text>
        </Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. BUILD PULLING STRENGTH"
          placeholderTextColor={SL.muted}
          value={purpose}
          onChangeText={setPurpose}
        />

        {/* Exercise count header */}
        <View style={styles.exercisesHeader}>
          <Text style={styles.inputLabel} style={styles.exercisesLabel}>EXERCISES</Text>
          {pendingExercises.length > 0 && (
            <View style={styles.exCountBadge}>
              <Text style={styles.exCountText}>
                {pendingExercises.length} ADDED
              </Text>
            </View>
          )}
        </View>

        {/* Empty state */}
        {pendingExercises.length === 0 && (
          <View style={styles.emptyExWrap}>
            <Text style={styles.emptyExText}>NO EXERCISES YET</Text>
            <Text style={styles.emptyExSub}>Tap + ADD EXERCISE below to build your workout</Text>
          </View>
        )}

        {/* Exercise cards */}
        {pendingExercises.map((ex, i) => {
          const uid = ex._uid;
          return (
            <View key={uid} style={styles.exCard}>

              {/* Card header: letter badge + name + remove */}
              <View style={styles.exCardHead}>
                <View style={styles.letterBadge}>
                  <Text style={styles.letterText}>{String.fromCharCode(65 + i)}</Text>
                </View>
                <Text style={styles.exName} numberOfLines={2}>{ex.name?.toUpperCase()}</Text>
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={() => handleRemove(i, uid)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Sets + Reps row */}
              <View style={styles.exRow}>
                <View style={styles.exField}>
                  <Text style={styles.fieldLabel}>SETS</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="4"
                    placeholderTextColor={SL.muted}
                    keyboardType="numeric"
                    value={exerciseDetails[uid]?.sets ?? ''}
                    onChangeText={v => updateDetail(uid, 'sets', v)}
                  />
                </View>
                <View style={styles.exField}>
                  <Text style={styles.fieldLabel}>REPS</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="8-10"
                    placeholderTextColor={SL.muted}
                    value={exerciseDetails[uid]?.reps ?? ''}
                    onChangeText={v => updateDetail(uid, 'reps', v)}
                  />
                </View>
              </View>

              {/* Notes */}
              <Text style={styles.fieldLabel}>COACHING NOTES</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                placeholder="Focus cues, technique notes..."
                placeholderTextColor={SL.muted}
                multiline
                value={exerciseDetails[uid]?.notes ?? ''}
                onChangeText={v => updateDetail(uid, 'notes', v)}
              />
            </View>
          );
        })}

        {/* Add Exercise */}
        <TouchableOpacity
          style={styles.addExBtn}
          onPress={() => navigation.navigate('ExerciseGallery', { selectionMode: true })}
          activeOpacity={0.8}
        >
          <Text style={styles.addExBtnText}>+ ADD EXERCISE</Text>
        </TouchableOpacity>

        {/* Save Workout */}
        <TouchableOpacity
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!canSave}
          activeOpacity={0.85}
        >
          {saving
            ? <ActivityIndicator color={SL.bg} />
            : <Text style={[styles.saveBtnText, !canSave && styles.saveBtnTextDisabled]}>
                SAVE WORKOUT
              </Text>
          }
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg },

  // ── Header ──────────────────────────────────────────────────────────────────

  header: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: SL.border,
  },
  backText: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.accent,
    letterSpacing: 2,
    marginBottom: 14,
  },
  title: {
    fontFamily: F.heading,
    fontSize: 32,
    color: SL.accent,
    letterSpacing: 4,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  studentCtx: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: 8,
  },
  studentCtxName: { color: SL.text },
  dayCtx: {
    fontFamily: F.bodyMed,
    fontSize: 15,
    color: SL.muted,
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: SL.accent,
    opacity: 0.3,
    marginTop: 18,
  },

  // ── Form ────────────────────────────────────────────────────────────────────

  form: { padding: 20, gap: 0, paddingBottom: 24 },

  inputLabel: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: SL.muted,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 6,
  },
  optional: {
    fontSize: 11,
    color: SL.muted,
    opacity: 0.7,
  },

  input: {
    height: 46,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    paddingHorizontal: 14,
    fontFamily: F.body,
    fontSize: 16,
    color: SL.text,
  },
  inputMultiline: {
    height: 76,
    paddingTop: 12,
    textAlignVertical: 'top',
  },

  // ── Exercises section ────────────────────────────────────────────────────────

  exercisesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 6,
  },
  exercisesLabel: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: SL.muted,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 0,
    marginBottom: 0,
  },
  exCountBadge: {
    backgroundColor: 'rgba(74,158,191,0.15)',
    borderWidth: 1,
    borderColor: SL.accent,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  exCountText: {
    fontFamily: F.body,
    fontSize: 12,
    color: SL.accent,
    letterSpacing: 1.5,
  },

  emptyExWrap: {
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    borderStyle: 'dashed',
    paddingVertical: 28,
    alignItems: 'center',
    gap: 8,
  },
  emptyExText: {
    fontFamily: F.heading,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 2,
  },
  emptyExSub: {
    fontFamily: F.bodyMed,
    fontSize: 13,
    color: SL.muted,
    letterSpacing: 0.5,
    textAlign: 'center',
    paddingHorizontal: 20,
    opacity: 0.7,
  },

  // ── Exercise card ────────────────────────────────────────────────────────────

  exCard: {
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    padding: 16,
    marginTop: 12,
    gap: 10,
  },
  exCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  letterBadge: {
    width: 36,
    height: 36,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(74,158,191,0.08)',
    flexShrink: 0,
  },
  letterText: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.accent,
  },
  exName: {
    fontFamily: F.heading,
    fontSize: 20,
    color: SL.text,
    letterSpacing: 1,
    flex: 1,
  },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: SL.danger,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  removeBtnText: {
    fontFamily: F.body,
    fontSize: 13,
    color: SL.danger,
  },

  exRow: { flexDirection: 'row', gap: 12 },
  exField: { flex: 1, gap: 6 },

  fieldLabel: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: SL.muted,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },

  // ── Buttons ──────────────────────────────────────────────────────────────────

  addExBtn: {
    height: 40,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
  },
  addExBtnText: {
    fontFamily: F.heading,
    fontSize: 16,
    color: SL.accent,
    letterSpacing: 3,
  },

  saveBtn: {
    height: 48,
    backgroundColor: SL.accent,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 14,
  },
  saveBtnDisabled: {
    backgroundColor: SL.border,
  },
  saveBtnText: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.bg,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  saveBtnTextDisabled: {
    color: SL.muted,
  },
});
