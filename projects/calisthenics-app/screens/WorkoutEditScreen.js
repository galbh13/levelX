import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { supabase } from '../lib/supabase';
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

// ─── Corner accent component ──────────────────────────────────────────────────

function Corner({ pos }) {
  const s = pos === 'TL'
    ? { top: -1, left: -1, borderTopWidth: 1.5, borderLeftWidth: 1.5 }
    : { bottom: -1, right: -1, borderBottomWidth: 1.5, borderRightWidth: 1.5 };
  return <View style={[styles.corner, s]} pointerEvents="none" />;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function WorkoutEditScreen({ route, navigation }) {
  const { workout, exercises: initialExercises } = route.params;

  const [title,     setTitle]     = useState(workout.title   ?? '');
  const [purpose,   setPurpose]   = useState(workout.purpose ?? '');
  const [exercises, setExercises] = useState(
    (initialExercises ?? []).map(ex => ({
      _uid:  ex.id,
      name:  ex.name  ?? '',
      sets:  ex.sets  ?? '',
      reps:  ex.reps  ?? '',
      notes: ex.notes ?? '',
    }))
  );
  const [saving, setSaving] = useState(false);

  // ── Gallery picker state ───────────────────────────────────────────────────

  const [showGallery,    setShowGallery]    = useState(false);
  const [gallery,        setGallery]        = useState([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [gallerySearch,  setGallerySearch]  = useState('');

  async function fetchGallery() {
    setGalleryLoading(true);
    const { data } = await supabase
      .from('exercises_gallery')
      .select('id, name, movement_type, youtube_url')
      .order('name', { ascending: true });
    setGallery(data ?? []);
    setGalleryLoading(false);
  }

  function addExercise() {
    setGallerySearch('');
    setShowGallery(true);
    fetchGallery();
  }

  function selectFromGallery(galleryItem) {
    setExercises(prev => [
      ...prev,
      {
        _uid:  `new_${Date.now()}`,
        name:  galleryItem.name,
        sets:  '',
        reps:  '',
        notes: '',
      },
    ]);
    setShowGallery(false);
  }

  // ── Exercise helpers ───────────────────────────────────────────────────────

  function updateExercise(uid, field, value) {
    setExercises(prev =>
      prev.map(ex => ex._uid === uid ? { ...ex, [field]: value } : ex)
    );
  }

  function removeExercise(uid) {
    setExercises(prev => prev.filter(ex => ex._uid !== uid));
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  const canSave = title.trim().length > 0 && !saving;

  async function handleSave() {
    if (!title.trim()) { alert('Please enter a workout title.'); return; }
    setSaving(true);
    console.log('[WorkoutEdit] handleSave start — workout.id:', workout.id, 'title:', title.trim(), 'exercises:', exercises.length);

    // 1. Update workout metadata
    console.log('[WorkoutEdit] 1. Updating workout metadata...');
    const { error: workoutError, data: workoutData } = await supabase
      .from('workouts')
      .update({ title: title.trim(), purpose: purpose.trim() })
      .eq('id', workout.id);
    console.log('[WorkoutEdit] 1. Update result — error:', workoutError, 'data:', workoutData);
    if (workoutError) { alert('Save failed: ' + workoutError.message); setSaving(false); return; }

    // 2. Delete ALL existing exercises for this workout before inserting
    console.log('[WorkoutEdit] 2. Deleting exercises for workout_id:', workout.id);
    const { error: delError, count } = await supabase
      .from('exercises')
      .delete({ count: 'exact' })
      .eq('workout_id', workout.id);
    console.log('[WorkoutEdit] 2. Delete result — error:', delError, 'count:', count);
    if (delError) { alert('Delete failed: ' + JSON.stringify(delError)); setSaving(false); return; }
    console.log('[WorkoutEdit] deleted', count, 'exercises for workout', workout.id);

    // Small delay to ensure delete commits before insert
    console.log('[WorkoutEdit] waiting 300ms before insert...');
    await new Promise(r => setTimeout(r, 300));

    // 3. Insert fresh exercise list with correct letters
    if (exercises.length > 0) {
      const rows = exercises.map((ex, i) => ({
        workout_id: workout.id,
        letter:     String.fromCharCode(65 + i),
        name:       ex.name.trim(),
        sets:       ex.sets,
        reps:       ex.reps,
        notes:      ex.notes,
      }));
      console.log('[WorkoutEdit] 3. Inserting', rows.length, 'exercises:', JSON.stringify(rows));
      const { error: insertError, data: insertData } = await supabase
        .from('exercises')
        .insert(rows);
      console.log('[WorkoutEdit] 3. Insert result — error:', insertError, 'data:', insertData);
      if (insertError) { alert('Insert failed: ' + insertError.message); setSaving(false); return; }
    } else {
      console.log('[WorkoutEdit] 3. No exercises to insert — skipping insert step');
    }

    // 4. Done — WorkoutDetailScreen re-fetches via useFocusEffect
    console.log('[WorkoutEdit] handleSave complete — navigating back');
    setSaving(false);
    navigation.goBack();
  }

  // ── Gallery filtered list ──────────────────────────────────────────────────

  const filteredGallery = gallerySearch.trim()
    ? gallery.filter(item =>
        item.name.toLowerCase().includes(gallerySearch.toLowerCase())
      )
    : gallery;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.screenTitle}>EDIT WORKOUT</Text>
        <View style={styles.divider} />
      </View>

      <ScrollView
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
      >
        {/* Workout title */}
        <Text style={styles.inputLabel}>WORKOUT TITLE</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. PULL DAY A"
          placeholderTextColor={SL.muted}
        />

        {/* Purpose */}
        <Text style={styles.inputLabel}>
          GOAL / PURPOSE{'  '}
          <Text style={styles.optional}>(OPTIONAL)</Text>
        </Text>
        <TextInput
          style={styles.input}
          value={purpose}
          onChangeText={setPurpose}
          placeholder="e.g. BUILD PULLING STRENGTH"
          placeholderTextColor={SL.muted}
        />

        {/* Exercises header */}
        <View style={styles.exercisesHeader}>
          <Text style={styles.exercisesLabel}>EXERCISES</Text>
          {exercises.length > 0 && (
            <View style={styles.exCountBadge}>
              <Text style={styles.exCountText}>{exercises.length}</Text>
            </View>
          )}
        </View>

        {/* Empty state */}
        {exercises.length === 0 && (
          <View style={styles.emptyExWrap}>
            <Text style={styles.emptyExText}>NO EXERCISES</Text>
            <Text style={styles.emptyExSub}>Tap + ADD EXERCISE below</Text>
          </View>
        )}

        {/* Exercise cards */}
        {exercises.map((ex, i) => (
          <View key={ex._uid} style={styles.exCard}>
            <Corner pos="TL" />
            <Corner pos="BR" />

            {/* Card header: letter + name (non-editable) + remove */}
            <View style={styles.exCardHead}>
              <View style={styles.letterBadge}>
                <Text style={styles.letterText}>{String.fromCharCode(65 + i)}</Text>
              </View>
              <Text style={styles.exName} numberOfLines={2}>{ex.name?.toUpperCase()}</Text>
              <TouchableOpacity
                style={styles.removeBtn}
                onPress={() => removeExercise(ex._uid)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.removeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Sets + Reps */}
            <View style={styles.exRow}>
              <View style={styles.exField}>
                <Text style={styles.fieldLabel}>SETS</Text>
                <TextInput
                  style={styles.input}
                  value={ex.sets}
                  onChangeText={v => updateExercise(ex._uid, 'sets', v)}
                  placeholder="4"
                  placeholderTextColor={SL.muted}
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.exField}>
                <Text style={styles.fieldLabel}>REPS</Text>
                <TextInput
                  style={styles.input}
                  value={ex.reps}
                  onChangeText={v => updateExercise(ex._uid, 'reps', v)}
                  placeholder="8-10"
                  placeholderTextColor={SL.muted}
                />
              </View>
            </View>

            {/* Notes */}
            <Text style={styles.fieldLabel}>COACHING NOTES</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={ex.notes}
              onChangeText={v => updateExercise(ex._uid, 'notes', v)}
              placeholder="Focus cues, technique notes..."
              placeholderTextColor={SL.muted}
              multiline
            />
          </View>
        ))}

        {/* Add exercise — opens gallery modal */}
        <TouchableOpacity style={styles.addExBtn} onPress={addExercise} activeOpacity={0.8}>
          <Text style={styles.addExBtnText}>+ ADD EXERCISE</Text>
        </TouchableOpacity>

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!canSave}
          activeOpacity={0.85}
        >
          {saving
            ? <ActivityIndicator color={SL.bg} />
            : <Text style={[styles.saveBtnText, !canSave && styles.saveBtnTextDisabled]}>
                SAVE CHANGES
              </Text>
          }
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Gallery picker modal ── */}
      <Modal
        visible={showGallery}
        transparent
        animationType="slide"
        onRequestClose={() => setShowGallery(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>

            {/* Modal header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>SELECT EXERCISE</Text>
              <TouchableOpacity
                onPress={() => setShowGallery(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Search bar */}
            <View style={styles.modalSearchWrap}>
              <TextInput
                style={styles.modalSearch}
                value={gallerySearch}
                onChangeText={setGallerySearch}
                placeholder="Search exercises..."
                placeholderTextColor={SL.muted}
                autoCorrect={false}
              />
            </View>

            {/* List */}
            {galleryLoading ? (
              <ActivityIndicator color={SL.accent} style={{ marginTop: 40 }} size="large" />
            ) : (
              <ScrollView
                contentContainerStyle={styles.modalList}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {filteredGallery.length === 0 ? (
                  <Text style={styles.modalEmpty}>NO EXERCISES FOUND</Text>
                ) : (
                  filteredGallery.map(item => (
                    <TouchableOpacity
                      key={item.id}
                      style={styles.galleryItem}
                      onPress={() => selectFromGallery(item)}
                      activeOpacity={0.75}
                    >
                      <View style={styles.galleryItemBody}>
                        <Text style={styles.galleryItemName}>{item.name?.toUpperCase()}</Text>
                        {item.movement_type ? (
                          <View style={styles.galleryTypeBadge}>
                            <Text style={styles.galleryTypeText}>
                              {item.movement_type.toUpperCase()}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      {item.youtube_url ? (
                        <Text style={styles.galleryVideoLabel}>▶ VIDEO</Text>
                      ) : null}
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg },

  corner: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderColor: SL.accent,
    zIndex: 2,
  },

  // ── Header ──────────────────────────────────────────────────────────────────

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
    fontSize: 18,
    color: SL.accent,
    letterSpacing: 2,
    marginBottom: 14,
  },
  screenTitle: {
    fontFamily: F.heading,
    fontSize: 32,
    color: SL.accent,
    letterSpacing: 4,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  divider: {
    height: 1,
    backgroundColor: SL.accent,
    opacity: 0.3,
    marginTop: 18,
  },

  // ── Form ────────────────────────────────────────────────────────────────────

  // Cool ice-glow frame wrapping the whole form, matching the Skills page.
  form: {
    padding: 20,
    paddingBottom: 24,
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

  inputLabel: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: SL.muted,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 6,
  },
  optional: { fontSize: 11, color: SL.muted, opacity: 0.7 },

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
    marginBottom: 8,
  },
  exercisesLabel: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: SL.muted,
    letterSpacing: 2,
    textTransform: 'uppercase',
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
    overflow: 'visible',
    position: 'relative',
  },
  exCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
    fontSize: 18,
    color: SL.text,
    letterSpacing: 1,
    flex: 1,
    textTransform: 'uppercase',
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

  exRow:   { flexDirection: 'row', gap: 12 },
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
  saveBtnDisabled: { backgroundColor: SL.border },
  saveBtnText: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.bg,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  saveBtnTextDisabled: { color: SL.muted },

  // ── Gallery modal ─────────────────────────────────────────────────────────────

  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  modalSheet: {
    height: '75%',
    backgroundColor: SL.panel,
    borderTopWidth: 2,
    borderTopColor: SL.accent,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  modalTitle: {
    fontFamily: F.heading,
    fontSize: 20,
    color: SL.accent,
    letterSpacing: 4,
    textTransform: 'uppercase',
  },
  modalClose: {
    fontFamily: F.body,
    fontSize: 18,
    color: SL.muted,
  },
  modalSearchWrap: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  modalSearch: {
    height: 44,
    backgroundColor: SL.bg,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    paddingHorizontal: 14,
    fontFamily: F.body,
    fontSize: 16,
    color: SL.text,
  },
  modalList: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 8,
  },
  modalEmpty: {
    fontFamily: F.heading,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: 40,
  },
  galleryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SL.bg,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  galleryItemBody: {
    flex: 1,
    gap: 6,
  },
  galleryItemName: {
    fontFamily: F.body,
    fontSize: 16,
    color: SL.text,
    letterSpacing: 1,
  },
  galleryTypeBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: SL.border,
    borderRadius: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    backgroundColor: 'rgba(74,158,191,0.06)',
  },
  galleryTypeText: {
    fontFamily: F.bodyMed,
    fontSize: 10,
    color: SL.muted,
    letterSpacing: 1,
  },
  galleryVideoLabel: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: SL.accent,
    letterSpacing: 1,
    marginLeft: 10,
  },
});
