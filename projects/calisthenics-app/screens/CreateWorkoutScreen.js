import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useCoach } from '../context/CoachContext';
import { F } from '../constants/fonts';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import PillButton from '../components/PillButton';
import { CARD_H, CARD_W } from '../constants/layout';
import { WORKOUT_CATEGORIES, insertExercises } from '../lib/workouts';

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

// Assign a shared superset_group number to each maximal run of exercises linked
// by `linkedAbove`; runs of one get null (standalone).
function computeGroups(links) {
  const raw = [];
  let run = 0;
  for (let i = 0; i < links.length; i++) {
    if (i > 0 && links[i]) raw[i] = raw[i - 1];
    else { run += 1; raw[i] = run; }
  }
  const counts = {};
  raw.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  return raw.map(r => (counts[r] > 1 ? r : null));
}

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
  const [category,        setCategory]        = useState('main'); // workout type bucket
  // Keyed by ex._uid for stability when exercises are removed mid-list
  const [exerciseDetails, setExerciseDetails] = useState({});
  const [saving,          setSaving]          = useState(false);

  // Fork (branch) authoring
  const [forkEnabled, setForkEnabled] = useState(false);
  const [branchA,     setBranchA]     = useState('');
  const [branchB,     setBranchB]     = useState('');

  // Clear any leftover exercises from a previous session
  useEffect(() => { clearExercises(); }, []);

  function updateDetail(uid, field, value) {
    setExerciseDetails(prev => ({
      ...prev,
      [uid]: { ...prev[uid], [field]: value },
    }));
  }

  function toggleLink(uid) {
    setExerciseDetails(prev => ({
      ...prev,
      [uid]: { ...prev[uid], linkedAbove: !prev[uid]?.linkedAbove },
    }));
  }

  function setBranch(uid, branch) {
    setExerciseDetails(prev => ({
      ...prev,
      [uid]: { ...prev[uid], branch },
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

      const branches = forkEnabled
        ? [{ key: 'a', label: branchA.trim() || 'OPTION A' }, { key: 'b', label: branchB.trim() || 'OPTION B' }]
        : null;
      const { data: workout, error: workoutError } = await supabase
        .from('workouts')
        .insert({
          title:       title.trim(),
          purpose:     purpose.trim(),
          assigned_to: selectedStudent.id,
          created_by:  user.id,
          branches,
          category,
        })
        .select()
        .single();

      if (workoutError) throw workoutError;

      if (selectedDay?.dateStr) {
        // Specific date → per-date override row.
        const { error: assignError } = await supabase
          .from('workout_override_workouts')
          .insert({
            student_id:    selectedStudent.id,
            coach_id:      user.id,
            specific_date: selectedDay.dateStr,
            workout_id:    workout.id,
          });
        if (assignError) throw assignError;
      } else if (selectedDay?.dayOfWeek != null) {
        // Weekday (from the skeleton editor) → recurring weekly_workout_template row.
        const { error: tmplError } = await supabase
          .from('weekly_workout_template')
          .insert({
            student_id:  selectedStudent.id,
            coach_id:    user.id,
            day_of_week: selectedDay.dayOfWeek,
            workout_id:  workout.id,
          });
        if (tmplError) throw tmplError;
      }

      const groups = computeGroups(
        pendingExercises.map(ex => !!exerciseDetails[ex._uid]?.linkedAbove)
      );
      const exRows = pendingExercises.map((ex, i) => {
        const details = exerciseDetails[ex._uid] ?? {};
        return {
          workout_id:     workout.id,
          letter:         String.fromCharCode(65 + i),
          name:           ex.name,
          // Stable link to the catalog exercise this was picked from — lets Workout
          // Mode open the right how-to card regardless of later name drift.
          gallery_id:     ex.id ?? null,
          variation:      details.variation?.trim() || null,
          sets:           String(details.sets ?? '').trim(),
          reps:           details.reps  ?? '',
          notes:          details.notes ?? '',
          superset_group: groups[i],
          branch:         forkEnabled ? (details.branch ?? null) : null,
        };
      });
      if (exRows.length) {
        const { error: exError } = await insertExercises(exRows);
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
    <ScreenFrame maxWidth={CARD_W}>
      <View style={styles.card}>
      <ScreenHeader
        title="CREATE WORKOUT"
        titleStyle={styles.bigTitle}
        onBack={() => navigation.goBack()}
      />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">

        {/* Workout Title + Goal — side by side */}
        <View style={styles.fieldRow}>
          <View style={styles.fieldCol}>
            <Text style={styles.inputLabel}>WORKOUT TITLE</Text>
            <TextInput
              style={styles.input}
              placeholder=""
              placeholderTextColor={SL.muted}
              value={title}
              onChangeText={setTitle}
            />
          </View>
          <View style={styles.fieldCol}>
            <Text style={styles.inputLabel}>GOAL / PURPOSE</Text>
            <TextInput
              style={styles.input}
              placeholder=""
              placeholderTextColor={SL.muted}
              value={purpose}
              onChangeText={setPurpose}
            />
          </View>
        </View>

        {/* Workout type — labels the card in My Workouts */}
        <Text style={styles.inputLabel}>TYPE</Text>
        <View style={styles.typeRow}>
          {WORKOUT_CATEGORIES.map(c => {
            const on = category === c.k;
            return (
              <TouchableOpacity
                key={c.k}
                style={[styles.typeChip, on && styles.typeChipOn]}
                onPress={() => setCategory(c.k)}
                activeOpacity={0.8}
              >
                <Text style={[styles.typeChipText, on && styles.typeChipTextOn]}>{c.l}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Exercise count header — only once exercises exist (the empty node
            stands on its own without a label above it) */}
        {pendingExercises.length > 0 && (
          <View style={styles.exercisesHeader}>
            <Text style={styles.exercisesLabel}>EXERCISES</Text>
            <View style={styles.exCountBadge}>
              <Text style={styles.exCountText}>
                {pendingExercises.length} ADDED
              </Text>
            </View>
          </View>
        )}

        {/* Exercise cards */}
        {pendingExercises.map((ex, i) => {
          const uid = ex._uid;
          return (
            <View key={uid} style={styles.exCard}>

              {/* Superset link with the exercise above (parallel, any order) */}
              {i > 0 && (
                <TouchableOpacity
                  style={[styles.linkToggle, exerciseDetails[uid]?.linkedAbove && styles.linkToggleOn]}
                  onPress={() => toggleLink(uid)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.linkToggleText, exerciseDetails[uid]?.linkedAbove && styles.linkToggleTextOn]}>
                    {exerciseDetails[uid]?.linkedAbove ? '⇄ SUPERSET WITH ABOVE' : '⇄ MAKE SUPERSET WITH ABOVE'}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Branch tag (only when the workout is forked) */}
              {forkEnabled && (
                <View style={styles.branchRow}>
                  {[
                    { k: null,    l: 'COMMON' },
                    { k: 'a',     l: branchA.trim() ? branchA.trim().toUpperCase() : 'OPTION A' },
                    { k: 'b',     l: branchB.trim() ? branchB.trim().toUpperCase() : 'OPTION B' },
                    { k: 'merge', l: 'ENDING' },
                  ].map(opt => {
                    const on = (exerciseDetails[uid]?.branch ?? null) === opt.k;
                    return (
                      <TouchableOpacity
                        key={String(opt.k)}
                        style={[styles.branchChip, on && styles.branchChipOn]}
                        onPress={() => setBranch(uid, opt.k)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.branchChipText, on && styles.branchChipTextOn]} numberOfLines={1}>
                          {opt.l}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Card header: letter badge + name + remove */}
              <View style={styles.exCardHead}>
                <View style={styles.letterBadge}>
                  <Text style={styles.letterText}>{String.fromCharCode(65 + i)}</Text>
                </View>
                <Text style={styles.exName} numberOfLines={2}>{ex.name?.toUpperCase()}</Text>
                <PillButton label="✕" tone="danger" size="sm" onPress={() => handleRemove(i, uid)} />
              </View>

              {/* Variation — free-text per-exercise focus, editable any time and
                  independent of the library exercise (changes cycle to cycle). */}
              <Text style={styles.fieldLabel}>VARIATION</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                placeholder="Focus / variation this cycle (optional)"
                placeholderTextColor={SL.muted}
                multiline
                value={exerciseDetails[uid]?.variation ?? ''}
                onChangeText={v => updateDetail(uid, 'variation', v)}
              />

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
              <Text style={styles.fieldLabel}>NOTES</Text>
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
        <PillButton
          label="+ ADD EXERCISE"
          onPress={() => navigation.navigate('ExerciseGallery', { selectionMode: true })}
          style={{ marginTop: 16, alignSelf: 'center', paddingHorizontal: 40 }}
        />

        {/* Fork / branch the workout */}
        <TouchableOpacity
          style={[styles.forkToggle, forkEnabled && styles.forkToggleOn]}
          onPress={() => setForkEnabled(v => !v)}
          activeOpacity={0.8}
        >
          <View style={[styles.forkCheckbox, forkEnabled && styles.forkCheckboxOn]}>
            {forkEnabled && <Text style={styles.forkCheckMark}>✓</Text>}
          </View>
          <Text style={[styles.forkGlyph, forkEnabled && styles.forkToggleTextOn]}>⑂</Text>
          <View style={styles.forkTextWrap}>
            <Text style={[styles.forkToggleText, forkEnabled && styles.forkToggleTextOn]}>
              FORK THE PATH
            </Text>
            <Text style={styles.forkToggleSub}>Let the player choose their route</Text>
          </View>
        </TouchableOpacity>

        {forkEnabled && (
          <View style={styles.forkBox}>
            <Text style={styles.fieldLabel}>OPTION A LABEL</Text>
            <TextInput
              style={styles.input}
              value={branchA}
              onChangeText={setBranchA}
              placeholder="e.g. FEELING STRONG"
              placeholderTextColor={SL.muted}
            />
            <View style={{ height: 10 }} />
            <Text style={styles.fieldLabel}>OPTION B LABEL</Text>
            <TextInput
              style={styles.input}
              value={branchB}
              onChangeText={setBranchB}
              placeholder="e.g. FATIGUED / END HERE"
              placeholderTextColor={SL.muted}
            />
            <Text style={styles.forkHint}>
              Tag each exercise: COMMON first, then the chosen path (A or B), then ENDING —
              done by everyone after their path. An empty path just ends the workout.
            </Text>
          </View>
        )}

        {/* Save Workout */}
        <PillButton
          label="SAVE WORKOUT"
          variant="solid"
          size="lg"
          onPress={handleSave}
          disabled={!canSave}
          loading={saving}
          style={{ marginTop: 20, alignSelf: 'center', paddingHorizontal: 56 }}
        />

        <View style={{ height: 40 }} />
      </ScrollView>
      </View>
    </ScreenFrame>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Fixed card height so the frame matches the other workout cards.
  card: { height: CARD_H },

  // CREATE WORKOUT title — sized to clear the BACK pill on either side.
  bigTitle: {
    fontSize: 30,
    letterSpacing: 4,
  },

  // ── Form ── inner padding; the ScreenFrame provides the glowing outer frame.
  form: {
    padding: 20,
    gap: 0,
    paddingBottom: 24,
  },

  // Workout title + goal share one row.
  fieldRow: {
    flexDirection: 'row',
    gap: 14,
  },
  fieldCol: { flex: 1 },

  inputLabel: {
    fontFamily: F.bodyMed,
    fontSize: 15,
    color: SL.muted,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 6,
  },
  // ── Workout type chips ──────────────────────────────────────────────────────
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: SL.border,
    backgroundColor: SL.panel,
  },
  typeChipOn: {
    borderColor: SL.accent,
    backgroundColor: 'rgba(74,158,191,0.16)',
  },
  typeChipText: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.muted,
    letterSpacing: 1.5,
  },
  typeChipTextOn: { color: SL.accent },

  input: {
    height: 52,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontFamily: F.body,
    fontSize: 18,
    color: SL.text,
  },
  inputMultiline: {
    height: 86,
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
    fontSize: 15,
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
    fontSize: 14,
    color: SL.accent,
    letterSpacing: 1.5,
  },

  // ── Exercise card ────────────────────────────────────────────────────────────

  exCard: {
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 12,
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
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(74,158,191,0.08)',
    flexShrink: 0,
  },
  letterText: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.accent,
  },
  exName: {
    fontFamily: F.heading,
    fontSize: 24,
    color: SL.text,
    letterSpacing: 1,
    flex: 1,
  },
  linkToggle: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1.5, borderColor: SL.border, borderRadius: 999,
    backgroundColor: 'rgba(74,158,191,0.04)',
    marginBottom: 4,
  },
  linkToggleOn: {
    borderColor: SL.accent, backgroundColor: 'rgba(74,158,191,0.16)',
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 8,
  },
  linkToggleText: { fontFamily: F.bodyMed, fontSize: 15, color: SL.muted, letterSpacing: 1.5 },
  linkToggleTextOn: { fontFamily: F.heading, color: SL.accent },

  // Branch tag chips on each card
  branchRow: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  branchChip: {
    flex: 1, paddingVertical: 7, borderRadius: 6,
    borderWidth: 1.5, borderColor: SL.border, backgroundColor: 'rgba(74,158,191,0.04)',
    alignItems: 'center',
  },
  branchChipOn: { borderColor: SL.accent, backgroundColor: 'rgba(74,158,191,0.16)' },
  branchChipText: { fontFamily: F.bodyMed, fontSize: 14, color: SL.muted, letterSpacing: 1 },
  branchChipTextOn: { fontFamily: F.heading, color: SL.accent },

  // Fork toggle + label box
  forkToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 16,
    paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10,
    borderWidth: 1.5, borderColor: SL.border, borderStyle: 'dashed',
  },
  forkToggleOn: { borderColor: SL.accent, borderStyle: 'solid', backgroundColor: 'rgba(74,158,191,0.06)' },
  forkCheckbox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: SL.muted,
    justifyContent: 'center', alignItems: 'center',
  },
  forkCheckboxOn: { borderColor: SL.accent, backgroundColor: 'rgba(74,158,191,0.2)' },
  forkCheckMark: { fontFamily: F.heading, fontSize: 17, color: SL.accent },
  forkGlyph: { fontFamily: F.heading, fontSize: 26, color: SL.muted, marginTop: -2 },
  forkTextWrap: { flex: 1 },
  forkToggleText: { fontFamily: F.heading, fontSize: 18, color: SL.muted, letterSpacing: 3 },
  forkToggleTextOn: { color: SL.accent },
  forkToggleSub: {
    fontFamily: F.bodyMed, fontSize: 13, color: SL.muted, opacity: 0.7,
    letterSpacing: 0.5, marginTop: 2,
  },
  forkBox: {
    marginTop: 12, padding: 14, borderRadius: 6,
    borderWidth: 1.5, borderColor: SL.border, backgroundColor: SL.panel,
  },
  forkHint: {
    fontFamily: F.bodyMed, fontSize: 15, color: SL.muted, letterSpacing: 0.5,
    lineHeight: 22, marginTop: 12,
  },

  exRow: { flexDirection: 'row', gap: 12 },
  exField: { flex: 1, gap: 6 },

  fieldLabel: {
    fontFamily: F.bodyMed,
    fontSize: 15,
    color: SL.muted,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },

});
