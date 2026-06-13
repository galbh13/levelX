import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';

const SL = {
  bg:      '#050912',
  panel:   '#0d1e35',
  border:  '#2a5070',
  accent:  '#4A9EBF',
  text:    '#E8F4FF',
  muted:   '#8ab0cc',
  gold:    '#FFD700',
  danger:  '#FF4444',
};

// ─── Exercise row ─────────────────────────────────────────────────────────────

function ExerciseRow({ exercise, index, onChange, onRemove, canRemove }) {
  const letter = String.fromCharCode(65 + index);
  return (
    <View style={styles.exRow}>
      {/* Letter badge */}
      <View style={styles.exLetterBox}>
        <Text style={styles.exLetter}>{letter}</Text>
      </View>

      {/* Fields */}
      <View style={styles.exFields}>
        {/* Name */}
        <TextInput
          style={styles.exInputName}
          placeholder="Exercise name"
          placeholderTextColor={SL.muted}
          value={exercise.name}
          onChangeText={v => onChange(index, 'name', v)}
        />
        {/* Sets × Reps · Notes */}
        <View style={styles.exFieldsRow}>
          <TextInput
            style={styles.exInputSets}
            placeholder="3"
            placeholderTextColor={SL.muted}
            value={exercise.sets}
            onChangeText={v => onChange(index, 'sets', v)}
            keyboardType="numeric"
          />
          <Text style={styles.exMult}>×</Text>
          <TextInput
            style={styles.exInputReps}
            placeholder="8-12"
            placeholderTextColor={SL.muted}
            value={exercise.reps}
            onChangeText={v => onChange(index, 'reps', v)}
          />
          <TextInput
            style={styles.exInputNotes}
            placeholder="Coaching note (optional)"
            placeholderTextColor={SL.muted}
            value={exercise.notes}
            onChangeText={v => onChange(index, 'notes', v)}
          />
        </View>
      </View>

      {/* Remove button */}
      {canRemove && (
        <TouchableOpacity style={styles.exRemoveBtn} onPress={() => onRemove(index)}>
          <Text style={styles.exRemoveText}>✕</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AddExampleWorkoutScreen({ route, navigation }) {
  const defaultClassOrder = route.params?.defaultClassOrder ?? 0;

  const [title,      setTitle]      = useState('');
  const [description,setDescription]= useState('');
  const [classOrder, setClassOrder] = useState(defaultClassOrder);
  const [classes,    setClasses]    = useState([]);
  const [exercises,  setExercises]  = useState([
    { name: '', sets: '3', reps: '', notes: '' },
  ]);
  const [saving,   setSaving]   = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    supabase
      .from('classes')
      .select('id, name, order_index')
      .order('order_index')
      .then(({ data }) => setClasses(data ?? []));
  }, []);

  function updateExercise(i, field, value) {
    setExercises(prev => prev.map((ex, idx) => idx === i ? { ...ex, [field]: value } : ex));
  }

  function addExerciseRow() {
    setExercises(prev => [...prev, { name: '', sets: '3', reps: '', notes: '' }]);
  }

  function removeExerciseRow(i) {
    setExercises(prev => prev.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    setErrorMsg('');
    if (!title.trim()) { setErrorMsg('Workout title is required.'); return; }
    const validExercises = exercises.filter(e => e.name.trim());
    if (validExercises.length === 0) { setErrorMsg('Add at least one exercise.'); return; }

    setSaving(true);
    const { error } = await supabase.from('gallery_example_workouts').insert({
      title:       title.trim().toUpperCase(),
      description: description.trim() || null,
      class_order: classOrder,
      exercises:   validExercises.map(e => ({
        name:  e.name.trim(),
        sets:  e.sets.trim() || '3',
        reps:  e.reps.trim() || '—',
        notes: e.notes.trim() || null,
      })),
    });

    if (error) {
      setErrorMsg(error.message ?? 'Failed to save. Please try again.');
      setSaving(false);
      return;
    }
    navigation.goBack();
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.title}>NEW WORKOUT</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">

        {/* ── Title ── */}
        <Text style={styles.label}>WORKOUT TITLE</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. PUSH DAY A"
          placeholderTextColor={SL.muted}
          value={title}
          onChangeText={setTitle}
          autoCapitalize="characters"
        />

        {/* ── Class ── */}
        <Text style={styles.label}>TARGET CLASS</Text>
        <View style={styles.chipRow}>
          {classes.map(c => (
            <TouchableOpacity
              key={c.id}
              style={[styles.chip, classOrder === c.order_index && styles.chipActive]}
              onPress={() => setClassOrder(c.order_index)}
            >
              <Text style={[styles.chipText, classOrder === c.order_index && styles.chipTextActive]}>
                {c.name.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Description ── */}
        <Text style={styles.label}>
          DESCRIPTION <Text style={styles.optional}>(optional)</Text>
        </Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          placeholder="What this workout develops..."
          placeholderTextColor={SL.muted}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={2}
          textAlignVertical="top"
        />

        {/* ── Exercises ── */}
        <View style={styles.exercisesHeader}>
          <Text style={styles.label}>EXERCISES</Text>
          <Text style={styles.exerciseHint}>{exercises.length} added</Text>
        </View>

        {/* Column headers */}
        <View style={styles.columnHeaders}>
          <View style={{ width: 36 }} />
          <Text style={[styles.colHeader, { flex: 1 }]}>NAME</Text>
          <Text style={[styles.colHeader, { width: 36 }]}>SETS</Text>
          <Text style={[styles.colHeader, { width: 60 }]}>REPS</Text>
          <Text style={[styles.colHeader, { flex: 1 }]}>NOTE</Text>
          <View style={{ width: 32 }} />
        </View>

        {exercises.map((ex, i) => (
          <ExerciseRow
            key={i}
            exercise={ex}
            index={i}
            onChange={updateExercise}
            onRemove={removeExerciseRow}
            canRemove={exercises.length > 1}
          />
        ))}

        <TouchableOpacity style={styles.addRowBtn} onPress={addExerciseRow} activeOpacity={0.8}>
          <Text style={styles.addRowBtnText}>+ ADD EXERCISE</Text>
        </TouchableOpacity>

        {/* ── Error ── */}
        {!!errorMsg && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠ {errorMsg}</Text>
          </View>
        )}

        {/* ── Save ── */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color={SL.bg} />
            : <Text style={styles.saveBtnText}>SAVE WORKOUT</Text>
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

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 16,
    borderBottomWidth: 1.5,
    borderBottomColor: SL.border,
  },
  back: { width: 60 },
  backText: { fontFamily: F.bodyMed, color: SL.accent, fontSize: 14, letterSpacing: 1.5 },
  title: {
    flex: 1,
    fontFamily: F.heading, fontSize: 20, color: SL.text,
    letterSpacing: 4, textTransform: 'uppercase', textAlign: 'center',
  },

  form: { paddingHorizontal: 20, paddingTop: 8 },

  label: {
    fontFamily: F.bodyMed, fontSize: 12, color: SL.text,
    letterSpacing: 2, textTransform: 'uppercase',
    marginTop: 22, marginBottom: 8,
  },
  optional: {
    fontFamily: F.body, fontSize: 11, color: SL.muted,
    textTransform: 'none', letterSpacing: 0.5,
  },

  input: {
    backgroundColor: SL.panel,
    borderWidth: 1.5, borderColor: SL.border, borderRadius: 6,
    paddingHorizontal: 16, paddingVertical: 13,
    fontFamily: F.body, fontSize: 15, color: SL.text,
  },
  multiline: { minHeight: 70, paddingTop: 13, lineHeight: 22 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: {
    paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: 4, borderWidth: 1.5,
    borderColor: SL.border, backgroundColor: SL.panel,
  },
  chipActive: { backgroundColor: SL.accent, borderColor: SL.accent },
  chipText: { fontFamily: F.bodyMed, fontSize: 13, color: SL.muted, letterSpacing: 1 },
  chipTextActive: { color: SL.bg, fontFamily: F.heading },

  // ── Exercise list ─────────────────────────────────────────────────────────────

  exercisesHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginTop: 22, marginBottom: 8,
  },
  exerciseHint: {
    fontFamily: F.body, fontSize: 12, color: SL.muted, letterSpacing: 1,
  },

  columnHeaders: {
    flexDirection: 'row', alignItems: 'center',
    gap: 6, marginBottom: 6, paddingHorizontal: 2,
  },
  colHeader: {
    fontFamily: F.bodyMed, fontSize: 10, color: SL.muted,
    letterSpacing: 1.5, textTransform: 'uppercase',
  },

  // ── Exercise row ──────────────────────────────────────────────────────────────

  exRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 8,
  },
  exLetterBox: {
    width: 30,
    height: 36,
    backgroundColor: 'rgba(74,158,191,0.12)',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 1,
  },
  exLetter: {
    fontFamily: F.heading, fontSize: 14, color: SL.accent, letterSpacing: 1,
  },
  exFields: { flex: 1, gap: 5 },
  exInputName: {
    height: 36,
    backgroundColor: SL.panel,
    borderWidth: 1.5, borderColor: SL.border, borderRadius: 4,
    paddingHorizontal: 10,
    fontFamily: F.body, fontSize: 14, color: SL.text,
  },
  exFieldsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  exInputSets: {
    width: 36, height: 30,
    backgroundColor: SL.panel,
    borderWidth: 1.5, borderColor: SL.border, borderRadius: 4,
    paddingHorizontal: 6, textAlign: 'center',
    fontFamily: F.body, fontSize: 13, color: SL.text,
  },
  exMult: {
    fontFamily: F.heading, fontSize: 13, color: SL.muted,
  },
  exInputReps: {
    width: 60, height: 30,
    backgroundColor: SL.panel,
    borderWidth: 1.5, borderColor: SL.border, borderRadius: 4,
    paddingHorizontal: 6,
    fontFamily: F.body, fontSize: 13, color: SL.text,
  },
  exInputNotes: {
    flex: 1, height: 30,
    backgroundColor: SL.panel,
    borderWidth: 1.5, borderColor: SL.border, borderRadius: 4,
    paddingHorizontal: 8,
    fontFamily: F.body, fontSize: 12, color: SL.text,
  },
  exRemoveBtn: {
    width: 30, height: 36,
    justifyContent: 'center', alignItems: 'center',
    marginTop: 1,
  },
  exRemoveText: {
    fontFamily: F.body, fontSize: 14, color: SL.danger,
  },

  addRowBtn: {
    marginTop: 10,
    height: 40,
    borderWidth: 1.5, borderColor: SL.border, borderRadius: 4,
    borderStyle: 'dashed',
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'transparent',
  },
  addRowBtnText: {
    fontFamily: F.bodyMed, fontSize: 13, color: SL.muted,
    letterSpacing: 2, textTransform: 'uppercase',
  },

  // ── Error & save ─────────────────────────────────────────────────────────────

  errorBox: {
    marginTop: 20,
    backgroundColor: 'rgba(255,60,60,0.12)',
    borderWidth: 1.5, borderColor: '#FF4444',
    borderRadius: 6, padding: 14,
  },
  errorText: {
    fontFamily: F.bodyMed, fontSize: 14, color: '#FF6B6B', letterSpacing: 0.5, lineHeight: 20,
  },

  saveBtn: {
    marginTop: 28, height: 56,
    backgroundColor: SL.accent, borderRadius: 6,
    justifyContent: 'center', alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: {
    fontFamily: F.heading, fontSize: 15, color: SL.bg,
    letterSpacing: 4, textTransform: 'uppercase',
  },
});
