import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator,
  Modal, ScrollView, Dimensions,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import PillButton from '../components/PillButton';
import { ShimmerFrame, BLUE } from '../components/Shimmer';
import { WORKOUT_CATEGORIES, updateWorkoutMeta, replaceWorkoutExercises } from '../lib/workouts';

// ─── Theme ──────────────────────────────────────────────────────────────────
// Matches the admin example-workout builder so the two editors look identical.

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

const MOVEMENT_TYPES = ['All', 'Pull', 'Push', 'Balance', 'Legs', 'Core', 'Mobility', 'Flexibility', 'Isolated'];

const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2)}`;

// Fixed picker-card height so the modal never resizes between filter steps.
const PICKER_H = Math.min(600, Math.max(420, Dimensions.get('window').height - 100));

// Assign a shared superset_group number to each maximal run of exercises linked
// by `linkedAbove`; runs of one get null (standalone).
function computeGroups(list) {
  const raw = [];
  let run = 0;
  for (let i = 0; i < list.length; i++) {
    if (i > 0 && list[i].linkedAbove) raw[i] = raw[i - 1];
    else { run += 1; raw[i] = run; }
  }
  const counts = {};
  raw.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  return raw.map(r => (counts[r] > 1 ? r : null));
}

// ─── Exercise row ─────────────────────────────────────────────────────────────

function ExerciseRow({ exercise, letter, showLink, onChange, onRemove, onToggleLink, onMove, canUp, canDown }) {
  const u = exercise._uid;
  return (
    <View style={styles.exRow}>
      {/* Letter badge */}
      <View style={styles.exLetterBox}>
        <Text style={styles.exLetter}>{letter}</Text>
      </View>

      {/* Fields */}
      <View style={styles.exFields}>
        {/* Superset link with the exercise above in this section (any order) */}
        {showLink && (
          <TouchableOpacity
            style={[styles.linkToggle, exercise.linkedAbove && styles.linkToggleOn]}
            onPress={() => onToggleLink(u)}
            activeOpacity={0.8}
          >
            <Text style={[styles.linkToggleText, exercise.linkedAbove && styles.linkToggleTextOn]}>
              {exercise.linkedAbove ? '⇄ SUPERSET WITH ABOVE' : '⇄ MAKE SUPERSET WITH ABOVE'}
            </Text>
          </TouchableOpacity>
        )}
        {/* Name — chosen from the library, not free text */}
        <View style={styles.exNameBox}>
          <Text style={styles.exNameText} numberOfLines={1}>{exercise.name}</Text>
        </View>
        {/* Variation — free-text per-exercise focus, editable any time and
            independent of the library exercise (changes cycle to cycle). */}
        <TextInput
          style={styles.exVariationInput}
          placeholder="variation / focus this cycle (optional)"
          placeholderTextColor={SL.muted}
          value={exercise.variation}
          onChangeText={v => onChange(u, 'variation', v)}
          multiline
        />
        {/* Sets × Reps */}
        <View style={styles.exFieldsRow}>
          <TextInput
            style={styles.exInputSets}
            placeholder="sets"
            placeholderTextColor={SL.muted}
            value={exercise.sets}
            onChangeText={v => onChange(u, 'sets', v)}
            keyboardType="numeric"
          />
          <Text style={styles.exMult}>×</Text>
          <TextInput
            style={styles.exInputReps}
            placeholder="reps"
            placeholderTextColor={SL.muted}
            value={exercise.reps}
            onChangeText={v => onChange(u, 'reps', v)}
          />
        </View>
      </View>

      {/* Reorder (within this section) + remove */}
      <View style={styles.exSideCol}>
        <TouchableOpacity
          style={[styles.moveBtn, !canUp && styles.moveBtnDisabled]}
          onPress={() => canUp && onMove(u, -1)}
          disabled={!canUp}
        >
          <Text style={styles.moveBtnText}>▲</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.moveBtn, !canDown && styles.moveBtnDisabled]}
          onPress={() => canDown && onMove(u, 1)}
          disabled={!canDown}
        >
          <Text style={styles.moveBtnText}>▼</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.exRemoveBtn} onPress={() => onRemove(u)}>
          <Text style={styles.exRemoveText}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function WorkoutEditScreen({ route, navigation }) {
  const { workout, exercises: initialExercises } = route.params;

  const [title,    setTitle]    = useState(workout.title    ?? '');
  const [purpose,  setPurpose]  = useState(workout.purpose  ?? '');
  const [category, setCategory] = useState(workout.category ?? 'main');
  const [exercises, setExercises] = useState(() => {
    const list = (initialExercises ?? []).map(ex => ({
      _uid:           uid(),
      name:           ex.name ?? '',
      gallery_id:     ex.gallery_id ?? null,   // catalog link (Workout Mode how-to card)
      variation:      ex.variation ?? '',
      sets:           String(ex.sets ?? ''),
      reps:           String(ex.reps ?? ''),
      notes:          ex.notes ?? '',          // preserved through save (no inline UI)
      superset_group: ex.superset_group ?? null,
      branch:         ex.branch ?? null,        // null = trunk, 'a'/'b' = path, 'merge' = ending
    }));
    // linkedAbove = same superset group as the previous exercise in the SAME branch.
    return list.map((ex, i) => ({
      ...ex,
      linkedAbove: i > 0
        && ex.superset_group != null
        && ex.superset_group === list[i - 1].superset_group
        && (ex.branch ?? null) === (list[i - 1].branch ?? null),
    }));
  });
  const [saving,   setSaving]   = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Fork (branch) authoring — seed from the workout row if it carries branches,
  // otherwise confirm via a lookup (the param may not include them).
  const initialBranches = Array.isArray(workout.branches) && workout.branches.length >= 2 ? workout.branches : null;
  const [forkEnabled, setForkEnabled] = useState(!!initialBranches);
  const [branchA,     setBranchA]     = useState(initialBranches?.[0]?.label ?? '');
  const [branchB,     setBranchB]     = useState(initialBranches?.[1]?.label ?? '');

  useEffect(() => {
    if (initialBranches) return;
    supabase.from('workouts').select('branches').eq('id', workout.id).maybeSingle()
      .then(({ data }) => {
        const b = data?.branches;
        if (Array.isArray(b) && b.length >= 2) {
          setForkEnabled(true);
          setBranchA(b[0]?.label ?? '');
          setBranchB(b[1]?.label ?? '');
        }
      });
  }, [workout.id]);

  // ── Library picker (gallery exercises) ──────────────────────────────────────
  const [galleryExercises, setGalleryExercises] = useState([]);
  const [pickerVisible,    setPickerVisible]    = useState(false);
  const [pickerStep,       setPickerStep]       = useState('category'); // 'category' | 'list'
  const [pickerCategory,   setPickerCategory]   = useState('All');      // movement type
  const [pickerSearch,     setPickerSearch]     = useState('');
  const [pickerAdded,      setPickerAdded]      = useState({});         // id → recently-added flash
  const [pickerTarget,     setPickerTarget]     = useState(null);       // which branch the picker adds to

  useEffect(() => {
    supabase
      .from('exercises_gallery')
      .select('id, name, movement_type')
      .order('name', { ascending: true })
      .then(({ data }) => setGalleryExercises(data ?? []));
  }, []);

  function updateExercise(u, field, value) {
    setExercises(prev => prev.map(ex => ex._uid === u ? { ...ex, [field]: value } : ex));
  }

  function removeExercise(u) {
    setExercises(prev => prev.filter(ex => ex._uid !== u));
  }

  function toggleLink(u) {
    setExercises(prev => prev.map(ex => ex._uid === u ? { ...ex, linkedAbove: !ex.linkedAbove } : ex));
  }

  // Move an exercise up/down WITHIN its own section (same branch), swapping it with
  // the neighbouring same-branch exercise so the other sections stay put.
  function moveExercise(u, dir) {
    setExercises(prev => {
      const i = prev.findIndex(e => e._uid === u);
      if (i < 0) return prev;
      const branch = prev[i].branch ?? null;
      const sameIdx = prev.reduce((acc, e, idx) => {
        if ((e.branch ?? null) === branch) acc.push(idx);
        return acc;
      }, []);
      const pos = sameIdx.indexOf(i);
      const target = pos + dir;
      if (target < 0 || target >= sameIdx.length) return prev;
      const a = sameIdx[pos], b = sameIdx[target];
      const next = [...prev];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
  }

  function addFork() { setForkEnabled(true); }
  function removeFork() {
    setForkEnabled(false);
    setBranchA('');
    setBranchB('');
    setExercises(prev => prev.map(ex => ({ ...ex, branch: null })));
  }

  // ── Library picker helpers ──────────────────────────────────────────────────
  const pickerList = useMemo(() => {
    let r = galleryExercises;
    if (pickerCategory !== 'All') r = r.filter(e => e.movement_type === pickerCategory);
    if (pickerSearch.trim())      r = r.filter(e => e.name.toLowerCase().includes(pickerSearch.toLowerCase()));
    return r;
  }, [galleryExercises, pickerCategory, pickerSearch]);

  function openPicker(target) {
    setPickerTarget(target ?? null);
    setPickerStep('category');
    setPickerCategory('All');
    setPickerSearch('');
    setPickerVisible(true);
  }
  function chooseCategory(cat) { setPickerCategory(cat); setPickerStep('list'); }
  function pickerBack() { if (pickerStep === 'list') setPickerStep('category'); }

  function pickExercise(item) {
    setExercises(prev => [
      ...prev,
      { _uid: uid(), name: item.name, gallery_id: item.id, variation: '', sets: '', reps: '', notes: '', superset_group: null, branch: pickerTarget, linkedAbove: false },
    ]);
    setPickerAdded(p => ({ ...p, [item.id]: true }));
    setTimeout(() => setPickerAdded(p => { const n = { ...p }; delete n[item.id]; return n; }), 1200);
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  const canSave = title.trim().length > 0 && !saving;

  async function handleSave() {
    setErrorMsg('');
    if (!title.trim()) { setErrorMsg('Workout title is required.'); return; }

    // Store in trunk → branch A → branch B → merge (common ending) order so the
    // letters and the workout-mode flow stay sensible.
    const ordered = forkEnabled
      ? [...exercises.filter(e => (e.branch ?? null) === null),
         ...exercises.filter(e => e.branch === 'a'),
         ...exercises.filter(e => e.branch === 'b'),
         ...exercises.filter(e => e.branch === 'merge')]
      : exercises;
    const valid = ordered.filter(e => e.name.trim());

    setSaving(true);

    // 1. Update workout metadata. `customized_at` rides along on the SAME write:
    // this edit is exactly what marks a library copy as diverged from its
    // template, so My Workouts can offer RETURN TO NORMAL.
    const branches = forkEnabled
      ? [{ key: 'a', label: branchA.trim() || 'OPTION A' }, { key: 'b', label: branchB.trim() || 'OPTION B' }]
      : null;
    const { error: workoutError } = await updateWorkoutMeta(workout.id, {
      title:         title.trim(),
      purpose:       purpose.trim(),
      branches,
      category,
      customized_at: new Date().toISOString(),
    });
    if (workoutError) { setErrorMsg('Save failed: ' + workoutError.message); setSaving(false); return; }

    // 2. Replace the exercise list (delete all, then insert fresh)
    const rows = valid.length ? (() => {
      const groups = computeGroups(valid);
      return valid.map((e, i) => ({
        workout_id:     workout.id,
        letter:         String.fromCharCode(65 + i),
        name:           e.name.trim(),
        gallery_id:     e.gallery_id ?? null,   // catalog link (Workout Mode how-to card)
        variation:      e.variation?.trim() || null,
        sets:           String(e.sets ?? '').trim(),
        reps:           e.reps,
        notes:          e.notes,
        superset_group: groups[i],
        branch:         forkEnabled ? (e.branch ?? null) : null,
      }));
    })() : [];

    const { error: exError, stage } = await replaceWorkoutExercises(workout.id, rows);
    if (exError) {
      setErrorMsg((stage === 'delete' ? 'Delete failed: ' : 'Insert failed: ') + exError.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    navigation.goBack();
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const trunkEx = exercises.filter(e => (e.branch ?? null) === null);
  const aEx     = exercises.filter(e => e.branch === 'a');
  const bEx     = exercises.filter(e => e.branch === 'b');
  const mergeEx = exercises.filter(e => e.branch === 'merge');

  // Each section is its own list — letters restart at A, link toggle only within it.
  const renderRows = (items) => items.map((ex, i) => (
    <ExerciseRow
      key={ex._uid}
      exercise={ex}
      letter={String.fromCharCode(65 + i)}
      showLink={i > 0}
      onChange={updateExercise}
      onRemove={removeExercise}
      onToggleLink={toggleLink}
      onMove={moveExercise}
      canUp={i > 0}
      canDown={i < items.length - 1}
    />
  ));

  return (
    <ScreenFrame>
      <ScreenHeader title="EDIT WORKOUT" onBack={() => navigation.goBack()} />

      <View style={styles.form}>
        {/* ── Title ── */}
        <Text style={styles.label}>WORKOUT TITLE</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. PULL DAY A"
          placeholderTextColor={SL.muted}
          value={title}
          onChangeText={setTitle}
        />

        {/* ── Purpose ── */}
        <Text style={styles.label}>
          GOAL / PURPOSE <Text style={styles.optional}>(optional)</Text>
        </Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. BUILD PULLING STRENGTH"
          placeholderTextColor={SL.muted}
          value={purpose}
          onChangeText={setPurpose}
        />

        {/* ── Category ── */}
        <Text style={styles.label}>TYPE</Text>
        <View style={styles.chipRow}>
          {WORKOUT_CATEGORIES.map(c => {
            const on = category === c.k;
            return (
              <TouchableOpacity
                key={c.k}
                style={[styles.chip, on && styles.chipActive]}
                onPress={() => setCategory(c.k)}
              >
                <Text style={[styles.chipText, on && styles.chipTextActive]}>{c.l}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Exercises ── */}
        <View style={styles.exercisesHeader}>
          <Text style={[styles.label, { marginTop: 0, marginBottom: 0 }]}>
            {forkEnabled ? 'COMMON EXERCISES' : 'EXERCISES'}
          </Text>
          <Text style={styles.exerciseHint}>{exercises.length} added</Text>
        </View>
        {forkEnabled && (
          <Text style={styles.sectionSub}>Everyone does these first, before the split.</Text>
        )}

        {trunkEx.length === 0 ? (
          <View style={styles.exEmpty}>
            <Text style={styles.exEmptyText}>NO EXERCISES YET</Text>
            <Text style={styles.exEmptySub}>Add exercises from your library below.</Text>
          </View>
        ) : renderRows(trunkEx)}

        <TouchableOpacity style={styles.addRowBtn} onPress={() => openPicker(null)} activeOpacity={0.8}>
          <Text style={styles.addRowBtnText}>＋ ADD FROM LIBRARY</Text>
        </TouchableOpacity>

        {/* ── Fork ── */}
        {!forkEnabled ? (
          <TouchableOpacity style={styles.addForkBtn} onPress={addFork} activeOpacity={0.8}>
            <Text style={styles.addForkText}>⑂ ADD A FORK — SPLIT INTO TWO PATHS</Text>
          </TouchableOpacity>
        ) : (
          <>
            {/* Split graphic */}
            <View style={styles.split}>
              <Text style={styles.splitStem}>│</Text>
              <View style={styles.splitHead}>
                <Text style={styles.splitTitle}>⑂ FORK · PICK ONE PATH</Text>
                <TouchableOpacity onPress={removeFork} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.splitRemove}>✕ REMOVE</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.splitArrows}>
                <Text style={styles.splitArrow}>↙</Text>
                <Text style={styles.splitArrow}>↘</Text>
              </View>
            </View>

            {/* Two parallel paths, side by side */}
            <View style={styles.branchRow}>
              {/* Branch A */}
              <View style={styles.branchPanel}>
                <TextInput
                  style={styles.branchLabelInput}
                  value={branchA}
                  onChangeText={setBranchA}
                  placeholder="PATH A NAME"
                  placeholderTextColor={SL.muted}
                />
                {aEx.length === 0
                  ? <Text style={styles.branchEmptyHint}>No exercises — this path just ends the workout.</Text>
                  : renderRows(aEx)}
                <TouchableOpacity style={styles.addBranchBtn} onPress={() => openPicker('a')} activeOpacity={0.8}>
                  <Text style={styles.addBranchText}>＋ ADD TO THIS PATH</Text>
                </TouchableOpacity>
              </View>

              {/* Branch B */}
              <View style={styles.branchPanel}>
                <TextInput
                  style={styles.branchLabelInput}
                  value={branchB}
                  onChangeText={setBranchB}
                  placeholder="PATH B NAME"
                  placeholderTextColor={SL.muted}
                />
                {bEx.length === 0
                  ? <Text style={styles.branchEmptyHint}>No exercises — this path just ends the workout.</Text>
                  : renderRows(bEx)}
                <TouchableOpacity style={styles.addBranchBtn} onPress={() => openPicker('b')} activeOpacity={0.8}>
                  <Text style={styles.addBranchText}>＋ ADD TO THIS PATH</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Merge — both paths rejoin into a shared ending (optional). */}
            <View style={styles.split}>
              <View style={styles.splitArrows}>
                <Text style={styles.splitArrow}>↘</Text>
                <Text style={styles.splitArrow}>↙</Text>
              </View>
              <View style={styles.splitHead}>
                <Text style={styles.splitTitle}>⑃ MERGE · COMMON ENDING (BOTH PATHS)</Text>
              </View>
              <Text style={styles.splitStem}>│</Text>
            </View>
            <Text style={styles.sectionSub}>
              Everyone does these after their path — build a shared ending once instead of in both.
            </Text>
            {mergeEx.length === 0
              ? <Text style={styles.branchEmptyHint}>No ending — each path just finishes on its own.</Text>
              : renderRows(mergeEx)}
            <TouchableOpacity style={styles.addRowBtn} onPress={() => openPicker('merge')} activeOpacity={0.8}>
              <Text style={styles.addRowBtnText}>＋ ADD TO COMMON ENDING</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Error ── */}
        {!!errorMsg && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠ {errorMsg}</Text>
          </View>
        )}

        {/* ── Save ── */}
        <PillButton
          label="SAVE CHANGES"
          variant="solid"
          size="lg"
          onPress={handleSave}
          disabled={!canSave}
          loading={saving}
          style={{ marginTop: 28 }}
        />

        <View style={{ height: 40 }} />
      </View>

      {/* ── Library picker ── */}
      <Modal
        visible={pickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.pickerBox}>
            {/* Header: back (on the names step) + title */}
            <View style={styles.pickerHeader}>
              {pickerStep === 'list' ? (
                <TouchableOpacity style={styles.pickerBackBtn} onPress={pickerBack} activeOpacity={0.8}>
                  <Text style={styles.pickerBackText}>←</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.pickerHeaderSpacer} />
              )}
              <Text style={styles.pickerTitle}>ADD FROM LIBRARY</Text>
              <View style={styles.pickerHeaderSpacer} />
            </View>

            <View style={styles.pickerBody}>
              {/* STEP 1 — movement category */}
              {pickerStep === 'category' && (
                <>
                  <Text style={styles.pickerStepLabel}>SELECT CATEGORY</Text>
                  <View style={styles.pickerChips}>
                    {MOVEMENT_TYPES.map(cat => (
                      <TouchableOpacity key={cat} style={styles.chip} onPress={() => chooseCategory(cat)} activeOpacity={0.8}>
                        <Text style={styles.chipText}>{cat.toUpperCase()}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              {/* STEP 2 — names */}
              {pickerStep === 'list' && (
                <>
                  <Text style={styles.pickerCrumb}>{pickerCategory.toUpperCase()}</Text>
                  <TextInput
                    style={styles.pickerSearch}
                    placeholder="Search exercises..."
                    placeholderTextColor={SL.muted}
                    value={pickerSearch}
                    onChangeText={setPickerSearch}
                  />
                  <ScrollView style={styles.pickerList} showsVerticalScrollIndicator={false}>
                    {pickerList.map(item => {
                      const added = !!pickerAdded[item.id];
                      return (
                        <TouchableOpacity
                          key={item.id}
                          style={styles.pickerRow}
                          onPress={() => pickExercise(item)}
                          activeOpacity={0.8}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.pickerName}>{item.name}</Text>
                            {!!item.movement_type && (
                              <Text style={styles.pickerType}>{item.movement_type.toUpperCase()}</Text>
                            )}
                          </View>
                          <View style={[styles.pickerAdd, added && styles.pickerAddDone]}>
                            <Text style={[styles.pickerAddText, added && styles.pickerAddTextDone]}>
                              {added ? '✓ ADDED' : '+ ADD'}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                    {pickerList.length === 0 && (
                      <Text style={styles.pickerEmpty}>No exercises match this filter.</Text>
                    )}
                  </ScrollView>
                </>
              )}
            </View>

            <TouchableOpacity
              style={styles.pickerDone}
              onPress={() => { setPickerVisible(false); setPickerSearch(''); }}
              activeOpacity={0.85}
            >
              <Text style={styles.pickerDoneText}>DONE</Text>
            </TouchableOpacity>

            <ShimmerFrame style={styles.pickerBorder} colors={BLUE} radius={18} thickness={3} duration={4200} active />
          </View>
        </View>
      </Modal>
    </ScreenFrame>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  form: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28 },

  label: {
    fontFamily: F.bodyMed, fontSize: 18, color: SL.text,
    letterSpacing: 2, textTransform: 'uppercase', marginTop: 30, marginBottom: 12,
  },
  optional: {
    fontFamily: F.body, fontSize: 15, color: SL.muted,
    textTransform: 'none', letterSpacing: 0.5,
  },

  input: {
    backgroundColor: SL.panel, borderWidth: 1.5, borderColor: SL.border, borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 18, fontFamily: F.body, fontSize: 21, color: SL.text,
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, minHeight: 55 },
  chip: {
    paddingHorizontal: 26, paddingVertical: 15,
    borderRadius: 999, borderWidth: 1.5, borderColor: SL.border, backgroundColor: SL.panel,
  },
  chipActive: {
    backgroundColor: 'rgba(74,158,191,0.16)', borderColor: SL.accent,
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 10,
  },
  chipText: { fontFamily: F.bodyMed, fontSize: 17, color: SL.muted, letterSpacing: 1 },
  chipTextActive: { color: SL.accent, fontFamily: F.heading },

  // ── Exercise list ─────────────────────────────────────────────────────────────

  exercisesHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginTop: 30, marginBottom: 12,
  },
  exerciseHint: { fontFamily: F.body, fontSize: 14, color: SL.muted, letterSpacing: 1 },

  // ── Exercise row ──────────────────────────────────────────────────────────────

  exRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 12 },
  exLetterBox: {
    width: 36, height: 46,
    backgroundColor: 'rgba(74,158,191,0.12)',
    borderWidth: 1.5, borderColor: SL.accent, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center', marginTop: 1,
  },
  exLetter: { fontFamily: F.heading, fontSize: 18, color: SL.accent, letterSpacing: 1 },
  exFields: { flex: 1, gap: 8 },

  linkToggle: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1.5, borderColor: SL.border, borderRadius: 999,
    backgroundColor: 'rgba(74,158,191,0.04)',
  },
  linkToggleOn: {
    borderColor: SL.accent, backgroundColor: 'rgba(74,158,191,0.16)',
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 8,
  },
  linkToggleText: { fontFamily: F.bodyMed, fontSize: 13, color: SL.muted, letterSpacing: 1.5 },
  linkToggleTextOn: { fontFamily: F.heading, color: SL.accent },

  sectionSub: {
    fontFamily: F.bodyMed, fontSize: 14, color: SL.muted, letterSpacing: 0.5, marginBottom: 10, marginTop: -4,
  },

  exNameBox: {
    height: 46, justifyContent: 'center',
    backgroundColor: 'rgba(74,158,191,0.08)',
    borderWidth: 1.5, borderColor: SL.accent, borderRadius: 8,
    paddingHorizontal: 14,
  },
  exNameText: {
    fontFamily: F.heading, fontSize: 16, color: SL.text,
    letterSpacing: 1, textTransform: 'uppercase',
  },
  exVariationInput: {
    marginTop: 6, minHeight: 38,
    backgroundColor: SL.panel,
    borderWidth: 1.5, borderColor: SL.border, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    fontFamily: F.body, fontSize: 14, color: SL.text,
    textAlignVertical: 'top',
  },
  exFieldsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  exInputSets: {
    width: 72, height: 42,
    backgroundColor: SL.panel,
    borderWidth: 1.5, borderColor: SL.border, borderRadius: 8,
    paddingHorizontal: 8, textAlign: 'center',
    fontFamily: F.body, fontSize: 16, color: SL.text,
  },
  exMult: { fontFamily: F.heading, fontSize: 16, color: SL.muted },
  exInputReps: {
    width: 130, height: 42,
    backgroundColor: SL.panel,
    borderWidth: 1.5, borderColor: SL.border, borderRadius: 8,
    paddingHorizontal: 12, textAlign: 'center',
    fontFamily: F.body, fontSize: 16, color: SL.text,
  },
  // Right-side controls: reorder up/down within the section + remove.
  exSideCol: { alignItems: 'center', justifyContent: 'flex-start', gap: 2, marginLeft: 2 },
  moveBtn: {
    width: 36, height: 30, borderRadius: 8,
    borderWidth: 1.5, borderColor: SL.border, backgroundColor: SL.panel,
    justifyContent: 'center', alignItems: 'center',
  },
  moveBtnDisabled: { opacity: 0.3 },
  moveBtnText: { fontFamily: F.body, fontSize: 14, color: SL.accent },
  exRemoveBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', marginTop: 2 },
  exRemoveText: { fontFamily: F.body, fontSize: 18, color: SL.danger },

  exEmpty: {
    borderWidth: 1.5, borderColor: SL.border, borderStyle: 'dashed', borderRadius: 12,
    paddingVertical: 28, alignItems: 'center', gap: 6,
  },
  exEmptyText: { fontFamily: F.heading, fontSize: 17, color: SL.muted, letterSpacing: 2 },
  exEmptySub: { fontFamily: F.bodyMed, fontSize: 14, color: SL.muted, letterSpacing: 0.5, textAlign: 'center' },

  addRowBtn: {
    marginTop: 14, height: 60,
    borderWidth: 1.5, borderColor: SL.accent, borderRadius: 12, borderStyle: 'dashed',
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(74,158,191,0.08)',
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.25, shadowRadius: 8,
  },
  addRowBtnText: {
    fontFamily: F.heading, fontSize: 17, color: SL.accent, letterSpacing: 3, textTransform: 'uppercase',
  },

  addForkBtn: {
    marginTop: 12, height: 56, borderRadius: 12,
    borderWidth: 1.5, borderColor: SL.border, borderStyle: 'dashed',
    justifyContent: 'center', alignItems: 'center',
  },
  addForkText: { fontFamily: F.heading, fontSize: 16, color: SL.muted, letterSpacing: 2, textTransform: 'uppercase' },

  split: { alignItems: 'center', marginTop: 18, gap: 4 },
  splitStem: { fontFamily: F.heading, fontSize: 20, color: SL.accent, lineHeight: 22 },
  splitHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    alignSelf: 'stretch', borderWidth: 1.5, borderColor: SL.accent, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, backgroundColor: 'rgba(74,158,191,0.08)',
  },
  splitTitle: { fontFamily: F.heading, fontSize: 15, color: SL.accent, letterSpacing: 1.5 },
  splitRemove: { fontFamily: F.bodyMed, fontSize: 13, color: SL.danger, letterSpacing: 1 },
  splitArrows: { flexDirection: 'row', justifyContent: 'space-around', alignSelf: 'stretch', paddingHorizontal: 40 },
  splitArrow: { fontFamily: F.heading, fontSize: 26, color: SL.accent },

  branchRow: { flexDirection: 'row', gap: 12, marginTop: 10, alignItems: 'flex-start' },
  branchPanel: {
    flex: 1, padding: 14, borderRadius: 12,
    borderWidth: 1.5, borderColor: SL.border, borderTopWidth: 4, borderTopColor: SL.accent,
    backgroundColor: SL.panel, gap: 10,
  },
  branchLabelInput: {
    height: 48, backgroundColor: SL.bg, borderWidth: 1.5, borderColor: SL.accent, borderRadius: 10,
    paddingHorizontal: 14, fontFamily: F.heading, fontSize: 16, color: SL.text, letterSpacing: 1,
  },
  branchEmptyHint: {
    fontFamily: F.bodyMed, fontSize: 14, color: SL.muted, letterSpacing: 0.5,
    fontStyle: 'italic', textAlign: 'center', paddingVertical: 8,
  },
  addBranchBtn: {
    height: 48, borderRadius: 10, borderWidth: 1.5, borderColor: SL.accent, borderStyle: 'dashed',
    justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(74,158,191,0.06)',
  },
  addBranchText: { fontFamily: F.heading, fontSize: 15, color: SL.accent, letterSpacing: 2 },

  // ── Library picker modal ────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center', alignItems: 'center', padding: 16,
  },
  pickerBox: {
    width: '100%', maxWidth: 640, height: PICKER_H,
    backgroundColor: SL.bg, borderRadius: 18, overflow: 'hidden', padding: 24,
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.35, shadowRadius: 20,
  },
  pickerBorder: { ...StyleSheet.absoluteFillObject, borderRadius: 18 },

  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  pickerBackBtn: {
    width: 46, height: 40, borderRadius: 20,
    borderWidth: 1.5, borderColor: SL.accent, backgroundColor: 'rgba(74,158,191,0.10)',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 8,
  },
  pickerBackText: { fontFamily: F.heading, fontSize: 22, color: SL.accent },
  pickerHeaderSpacer: { width: 46 },
  pickerTitle: {
    flex: 1, fontFamily: F.heading, fontSize: 22, color: SL.accent,
    letterSpacing: 3, textTransform: 'uppercase', textAlign: 'center',
  },

  pickerBody: { flex: 1 },
  pickerStepLabel: {
    fontFamily: F.heading, fontSize: 16, color: SL.text,
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: 14,
  },
  pickerCrumb: {
    fontFamily: F.bodyMed, fontSize: 14, color: SL.accent,
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12,
  },
  pickerChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },

  pickerSearch: {
    height: 52, backgroundColor: SL.panel, borderWidth: 1.5, borderColor: SL.border, borderRadius: 12,
    paddingHorizontal: 18, fontFamily: F.body, fontSize: 18, color: SL.text, marginBottom: 12,
  },
  pickerList: { flex: 1 },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: SL.border,
  },
  pickerName: { fontFamily: F.bodyMed, fontSize: 19, color: SL.text, letterSpacing: 0.5, textTransform: 'uppercase' },
  pickerType: { fontFamily: F.bodyMed, fontSize: 13, color: SL.muted, letterSpacing: 1.5, marginTop: 3 },
  pickerAdd: {
    paddingHorizontal: 16, paddingVertical: 9,
    borderWidth: 1.5, borderColor: SL.accent, borderRadius: 999,
    backgroundColor: 'rgba(74,158,191,0.10)', minWidth: 92, alignItems: 'center',
  },
  pickerAddDone: { borderColor: SL.gold, backgroundColor: 'rgba(255,215,0,0.10)' },
  pickerAddText: { fontFamily: F.heading, fontSize: 15, color: SL.accent, letterSpacing: 1.5 },
  pickerAddTextDone: { color: SL.gold },
  pickerEmpty: {
    fontFamily: F.bodyMed, fontSize: 16, color: SL.muted,
    textAlign: 'center', marginVertical: 28, letterSpacing: 0.5,
  },
  pickerDone: {
    marginTop: 16, height: 56, backgroundColor: SL.accent, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 14,
  },
  pickerDoneText: { fontFamily: F.heading, fontSize: 20, color: SL.bg, letterSpacing: 3, textTransform: 'uppercase' },

  // ── Error ─────────────────────────────────────────────────────────────────────
  errorBox: {
    marginTop: 20,
    backgroundColor: 'rgba(255,60,60,0.12)',
    borderWidth: 1.5, borderColor: '#FF4444', borderRadius: 6, padding: 14,
  },
  errorText: { fontFamily: F.bodyMed, fontSize: 14, color: '#FF6B6B', letterSpacing: 0.5, lineHeight: 20 },
});
