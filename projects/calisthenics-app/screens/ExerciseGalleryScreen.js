import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, Image, ActivityIndicator, ScrollView, Platform, Alert, Dimensions,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useCoach } from '../context/CoachContext';
import { F } from '../constants/fonts';
import ScreenFrame, { FRAME_PAD } from '../components/ScreenFrame';

// ─── Responsive browse grid ─────────────────────────────────────────────────────
// Fixed-width cards (no flex:1) so a lone card never stretches full-width, and the
// column count adapts to the viewport (2 on phones, more on wide web layouts).
const WIN_W     = Dimensions.get('window').width;
const GRID_PAD  = 20;
const GRID_GAP  = 18;
// The screen is wrapped in a centered ScreenFrame (max-width), so the grid sizes
// off the FRAMED width, not the raw window — otherwise columns overflow the frame
// on wide screens. ~300px target → bigger, classic-looking cards.
const FRAME_MAX = 1200;
const FRAME_W   = Math.min(WIN_W - FRAME_PAD * 2, FRAME_MAX);
const GRID_COLS = Math.max(2, Math.min(4, Math.floor((FRAME_W - GRID_PAD * 2) / 300)));
const CARD_W    = Math.floor((FRAME_W - GRID_PAD * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS);

// ─── Theme ────────────────────────────────────────────────────────────────────

const SL = {
  bg:      '#050912',
  panel:   '#070d1a',
  panelAlt:'#0a1424',
  border:  '#1a3a5c',
  accent:  '#4A9EBF',
  text:    '#E8F4FF',
  muted:   '#4a6a8a',
  gold:    '#FFD700',
  green:   '#4CAF50',
  danger:  '#FF4444',
};

const MOVEMENT_TYPES = ['All', 'Pull', 'Push', 'Balance', 'Legs', 'Mobility', 'Flexibility'];

// ─── Cross-platform confirm ───────────────────────────────────────────────────

function confirmAction(message, onConfirm) {
  if (Platform.OS === 'web') {
    if (window.confirm(message)) onConfirm();
  } else {
    Alert.alert('Confirm', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onConfirm },
    ]);
  }
}

// ─── Class chips ──────────────────────────────────────────────────────────────

function ClassChips({ classes, selectedId, onSelect, showAll = true }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
      {showAll && (
        <TouchableOpacity
          style={[styles.chip, selectedId === null && styles.chipActive]}
          onPress={() => onSelect(null)}
        >
          <Text style={[styles.chipText, selectedId === null && styles.chipTextActive]}>ALL</Text>
        </TouchableOpacity>
      )}
      {classes.map(c => (
        <TouchableOpacity
          key={c.id}
          style={[styles.chip, selectedId === c.id && styles.chipActive]}
          onPress={() => onSelect(c.id)}
        >
          <Text style={[styles.chipText, selectedId === c.id && styles.chipTextActive]}>
            {c.name.toUpperCase()}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// ─── Workout card ─────────────────────────────────────────────────────────────

function WorkoutCard({ workout, expanded, onToggle, onDelete }) {
  return (
    <View style={styles.workoutCard}>
      <TouchableOpacity style={styles.workoutCardHeader} onPress={onToggle} activeOpacity={0.8}>
        <View style={styles.workoutCardLeft}>
          <Text style={styles.workoutTitle}>{workout.title}</Text>
          {!!workout.description && (
            <Text style={styles.workoutDesc} numberOfLines={expanded ? undefined : 1}>
              {workout.description}
            </Text>
          )}
        </View>
        <View style={styles.workoutCardActions}>
          {!!onDelete && (
            <TouchableOpacity
              style={styles.cardDeleteBtn}
              onPress={() => confirmAction(`Delete "${workout.title}"?`, onDelete)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.cardDeleteText}>✕</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.workoutChevron}>{expanded ? '▲' : '▼'}</Text>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.workoutExercises}>
          {(workout.exercises ?? []).map((ex, i) => (
            <View key={i} style={styles.exerciseRow}>
              <View style={styles.exerciseRowLeft}>
                <Text style={styles.exerciseLetter}>{String.fromCharCode(65 + i)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.exerciseName}>{ex.name}</Text>
                  {!!ex.notes && (
                    <Text style={styles.exerciseNotes}>{ex.notes}</Text>
                  )}
                </View>
              </View>
              <Text style={styles.exerciseSetsReps}>
                {ex.sets}×{ex.reps}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ExerciseGalleryScreen({ route, navigation }) {
  const selectionMode = route.params?.selectionMode ?? false;
  const { addExercise, pendingExercises } = useCoach();

  const [activeTab,       setActiveTab]       = useState('exercises');
  const [classes,         setClasses]         = useState([]);
  const [exercises,       setExercises]       = useState([]);
  const [exampleWorkouts, setExampleWorkouts] = useState([]);

  // Exercises tab filters
  const [search,    setSearch]    = useState('');
  const [movFilter, setMovFilter] = useState('All');
  const [exClassId, setExClassId] = useState(null);

  // Workouts tab
  const [workoutsClassId,  setWorkoutsClassId]  = useState(null);
  const [expandedWorkout,  setExpandedWorkout]  = useState(null);

  // UI
  const [loading,  setLoading]  = useState(true);
  const [addedMap, setAddedMap] = useState({});

  useEffect(() => {
    Promise.all([loadClasses(), loadExercises(), loadExampleWorkouts()])
      .finally(() => setLoading(false));
  }, []);

  // Re-fetch exercises / workouts when navigating back to this screen
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      loadExercises();
      loadExampleWorkouts();
    });
    return unsub;
  }, [navigation]);

  async function loadClasses() {
    const { data } = await supabase
      .from('classes')
      .select('id, name, order_index')
      .order('order_index');
    const rows = data ?? [];
    setClasses(rows);
    if (rows.length > 0) setWorkoutsClassId(rows[0].id);
  }

  async function loadExercises() {
    const { data } = await supabase
      .from('exercises_gallery')
      .select('id, name, movement_type, youtube_url, video_url, description, coaching_cues, min_class_order')
      .order('name', { ascending: true });
    setExercises(data ?? []);
  }

  async function loadExampleWorkouts() {
    const { data } = await supabase
      .from('gallery_example_workouts')
      .select('id, title, description, class_order, exercises')
      .order('class_order', { ascending: true })
      .order('created_at', { ascending: true });
    setExampleWorkouts(data ?? []);
  }

  // ── Delete handlers ──────────────────────────────────────────────────────────

  async function handleDeleteExercise(item) {
    confirmAction(`Delete "${item.name}"?`, async () => {
      const { error } = await supabase
        .from('exercises_gallery')
        .delete()
        .eq('id', item.id);
      if (!error) setExercises(prev => prev.filter(e => e.id !== item.id));
    });
  }

  async function handleDeleteWorkout(workout) {
    const { error } = await supabase
      .from('gallery_example_workouts')
      .delete()
      .eq('id', workout.id);
    if (!error) setExampleWorkouts(prev => prev.filter(w => w.id !== workout.id));
  }

  // ── Derived state ────────────────────────────────────────────────────────────

  const selectedExClass = useMemo(
    () => classes.find(c => c.id === exClassId) ?? null,
    [classes, exClassId]
  );

  const filteredExercises = useMemo(() => {
    let result = exercises;
    if (selectedExClass) {
      result = result.filter(
        e => e.min_class_order === null || e.min_class_order === undefined
          || e.min_class_order === selectedExClass.order_index
      );
    }
    if (movFilter !== 'All') result = result.filter(e => e.movement_type === movFilter);
    if (search.trim())        result = result.filter(e =>
      e.name.toLowerCase().includes(search.toLowerCase())
    );
    return result;
  }, [exercises, selectedExClass, movFilter, search]);

  const workoutsClass = useMemo(
    () => classes.find(c => c.id === workoutsClassId) ?? classes[0] ?? null,
    [classes, workoutsClassId]
  );

  const shownWorkouts = useMemo(
    () => exampleWorkouts.filter(w => w.class_order === (workoutsClass?.order_index ?? 0)),
    [exampleWorkouts, workoutsClass]
  );

  // ── Selection-mode handlers ──────────────────────────────────────────────────

  function handleAdd(item) {
    addExercise(item);
    setAddedMap(prev => ({ ...prev, [item.id]: true }));
    setTimeout(() => {
      setAddedMap(prev => { const n = { ...prev }; delete n[item.id]; return n; });
    }, 1500);
  }

  // ── Cards ─────────────────────────────────────────────────────────────────────

  function renderSelectionCard({ item }) {
    const thumbId  = getYouTubeId(item.youtube_url);
    const thumbUri = thumbId ? `https://img.youtube.com/vi/${thumbId}/mqdefault.jpg` : null;
    const isAdded  = !!addedMap[item.id];
    return (
      <View style={styles.selCard}>
        {thumbUri ? (
          <Image source={{ uri: thumbUri }} style={styles.selThumb} resizeMode="cover" />
        ) : (
          <View style={[styles.selThumb, styles.thumbPlaceholder]}>
            <Text style={styles.thumbIcon}>▶</Text>
          </View>
        )}
        <View style={styles.selCardBody}>
          <Text style={styles.selExName} numberOfLines={2}>{item.name}</Text>
          <View style={styles.typeBadge}>
            <Text style={styles.typeText}>{(item.movement_type ?? '').toUpperCase()}</Text>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.addExBtn, isAdded && styles.addExBtnAdded]}
          onPress={() => handleAdd(item)}
          activeOpacity={0.75}
        >
          <Text style={[styles.addExBtnText, isAdded && styles.addExBtnTextAdded]}>
            {isAdded ? '✓ ADDED' : '+ ADD'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderBrowseCard({ item }) {
    const thumbId  = getYouTubeId(item.youtube_url);
    const thumbUri = thumbId ? `https://img.youtube.com/vi/${thumbId}/mqdefault.jpg` : null;
    const hasVideo = !!item.video_url;
    const className =
      item.min_class_order !== null && item.min_class_order !== undefined
        ? (classes.find(c => c.order_index === item.min_class_order)?.name ?? `Class ${item.min_class_order + 1}`)
        : null;

    return (
      <TouchableOpacity
        style={styles.browseCard}
        onPress={() => navigation.navigate('ExerciseDetail', { exercise: item })}
        activeOpacity={0.8}
      >
        {/* Thumbnail */}
        <View style={styles.thumbWrap}>
          {thumbUri ? (
            <Image source={{ uri: thumbUri }} style={styles.thumbFill} resizeMode="cover" />
          ) : hasVideo && Platform.OS === 'web' ? (
            // First frame of the uploaded video as a poster (muted, no controls)
            <video
              src={`${item.video_url}#t=0.1`}
              muted
              playsInline
              preload="metadata"
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <View style={[styles.thumbFill, styles.thumbPlaceholder]} />
          )}

          {/* Play overlay */}
          <View style={styles.playOverlay} pointerEvents="none">
            <View style={styles.playCircle}>
              <Text style={styles.playIcon}>▶</Text>
            </View>
          </View>

          {/* Delete button — admin browse only */}
          <TouchableOpacity
            style={styles.exDeleteBtn}
            onPress={() => handleDeleteExercise(item)}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Text style={styles.exDeleteText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Body */}
        <View style={styles.browseCardBody}>
          <Text style={styles.browseExName} numberOfLines={1}>{item.name}</Text>
          <View style={styles.badgeRow}>
            <View style={styles.typeBadge}>
              <Text style={styles.typeText}>{(item.movement_type ?? '').toUpperCase()}</Text>
            </View>
            {className && (
              <View style={styles.classBadge}>
                <Text style={styles.classBadgeText}>{className}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  const selectedCount = pendingExercises?.length ?? 0;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <ScreenFrame maxWidth={FRAME_MAX} fill>
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.navBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.title}>
          {selectionMode ? 'ADD EXERCISES' : 'GALLERY'}
        </Text>
        {selectionMode ? (
          selectedCount > 0 ? (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{selectedCount}</Text>
            </View>
          ) : (
            <View style={{ width: 48 }} />
          )
        ) : (
          <TouchableOpacity style={styles.navBtn} onPress={() => navigation.navigate('AddExercise')} activeOpacity={0.85}>
            <Text style={styles.addNewText}>+ NEW</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Tab bar — browse mode only */}
      {!selectionMode && (
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'exercises' && styles.tabActive]}
            onPress={() => setActiveTab('exercises')}
          >
            <Text style={[styles.tabText, activeTab === 'exercises' && styles.tabTextActive]}>
              EXERCISES
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'workouts' && styles.tabActive]}
            onPress={() => setActiveTab('workouts')}
          >
            <Text style={[styles.tabText, activeTab === 'workouts' && styles.tabTextActive]}>
              EXAMPLE WORKOUTS
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={SL.accent} style={{ marginTop: 48 }} size="large" />

      ) : activeTab === 'exercises' || selectionMode ? (

        /* ─────────── EXERCISES TAB ─────────── */
        <>
          {!selectionMode && (
            <>
              <Text style={styles.sectionLabel}>CLASS</Text>
              <ClassChips classes={classes} selectedId={exClassId} onSelect={setExClassId} showAll />
            </>
          )}

          <Text style={styles.sectionLabel}>TYPE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
            {MOVEMENT_TYPES.map(f => (
              <TouchableOpacity
                key={f}
                style={[styles.chip, movFilter === f && styles.chipActive]}
                onPress={() => setMovFilter(f)}
              >
                <Text style={[styles.chipText, movFilter === f && styles.chipTextActive]}>
                  {f.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.searchWrap}>
            <TextInput
              style={styles.search}
              placeholder="Search exercises..."
              placeholderTextColor={SL.muted}
              value={search}
              onChangeText={setSearch}
            />
          </View>

          {selectionMode ? (
            <FlatList
              data={filteredExercises}
              keyExtractor={item => item.id}
              renderItem={renderSelectionCard}
              contentContainerStyle={styles.selList}
              ListEmptyComponent={<Text style={styles.empty}>No exercises found.</Text>}
            />
          ) : (
            <FlatList
              data={filteredExercises}
              keyExtractor={item => item.id}
              renderItem={renderBrowseCard}
              numColumns={GRID_COLS}
              key={`grid-${GRID_COLS}`}
              contentContainerStyle={styles.browseGrid}
              columnWrapperStyle={styles.browseGridRow}
              ListEmptyComponent={
                <View style={styles.emptyBox}>
                  <Text style={styles.empty}>No exercises yet.</Text>
                  <Text style={styles.emptyHint}>Tap + NEW to add the first one.</Text>
                </View>
              }
            />
          )}

          {selectionMode && (
            <View style={styles.doneBar}>
              <TouchableOpacity style={styles.doneBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
                <Text style={styles.doneBtnText}>
                  {selectedCount > 0
                    ? `DONE — ${selectedCount} EXERCISE${selectedCount !== 1 ? 'S' : ''} ADDED`
                    : 'DONE — BACK TO WORKOUT'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </>

      ) : (

        /* ─────────── EXAMPLE WORKOUTS TAB ─────────── */
        <>
          {/* Class selector + New button row */}
          <View style={styles.workoutsTopRow}>
            <ClassChips
              classes={classes}
              selectedId={workoutsClassId}
              onSelect={id => { setWorkoutsClassId(id ?? classes[0]?.id); setExpandedWorkout(null); }}
              showAll={false}
            />
            <TouchableOpacity
              style={styles.newWorkoutBtn}
              onPress={() => navigation.navigate('AddExampleWorkout', {
                defaultClassOrder: workoutsClass?.order_index ?? 0,
              })}
              activeOpacity={0.8}
            >
              <Text style={styles.newWorkoutBtnText}>+ NEW</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.workoutsList}>
            {shownWorkouts.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.empty}>No example workouts yet.</Text>
                <Text style={styles.emptyHint}>Tap + NEW to create one for this class.</Text>
              </View>
            ) : (
              shownWorkouts.map(workout => (
                <WorkoutCard
                  key={workout.id}
                  workout={workout}
                  expanded={expandedWorkout === workout.id}
                  onToggle={() => setExpandedWorkout(prev => prev === workout.id ? null : workout.id)}
                  onDelete={() => handleDeleteWorkout(workout)}
                />
              ))
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        </>
      )}
    </View>
    </ScreenFrame>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getYouTubeId(url) {
  if (!url) return null;
  for (const p of [/[?&]v=([^&]+)/, /youtu\.be\/([^?&]+)/, /shorts\/([^?&]+)/]) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg },

  // ── Header ───────────────────────────────────────────────────────────────────

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: SL.border,
  },
  // Glowing ice pill — shared by BACK and + NEW.
  navBtn: {
    paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 24, borderWidth: 1.5, borderColor: SL.accent,
    backgroundColor: 'rgba(74,158,191,0.10)',
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 10,
  },
  backText: { fontFamily: F.heading, fontSize: 16, color: SL.accent, letterSpacing: 2 },
  title: {
    fontFamily: F.heading, fontSize: 30, color: SL.accent,
    letterSpacing: 6, textTransform: 'uppercase', flex: 1, textAlign: 'center',
    textShadowColor: 'rgba(74,158,191,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20,
  },
  addNewText: {
    fontFamily: F.heading, fontSize: 16, color: SL.accent, letterSpacing: 2,
  },
  countBadge: {
    width: 48, height: 28, backgroundColor: SL.accent,
    borderRadius: 4, justifyContent: 'center', alignItems: 'center',
  },
  countBadgeText: { fontFamily: F.heading, fontSize: 16, color: SL.bg, letterSpacing: 1 },

  // ── Tab bar ──────────────────────────────────────────────────────────────────

  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 2,
    borderBottomColor: SL.border,
  },
  tab: {
    flex: 1, paddingVertical: 18, alignItems: 'center',
    borderBottomWidth: 3, borderBottomColor: 'transparent', marginBottom: -2,
  },
  tabActive: {
    borderBottomColor: SL.accent,
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 8,
  },
  tabText: { fontFamily: F.heading, fontSize: 17, color: SL.muted, letterSpacing: 2.5 },
  tabTextActive: {
    color: SL.accent,
    textShadowColor: 'rgba(74,158,191,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
  },

  // ── Section labels & chips ───────────────────────────────────────────────────

  sectionLabel: {
    fontFamily: F.heading, fontSize: 14, color: SL.accent, opacity: 0.85,
    letterSpacing: 3, textTransform: 'uppercase',
    paddingHorizontal: 22, paddingTop: 22, paddingBottom: 4,
  },
  chipScroll: { flexGrow: 0 },
  chipRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 22, paddingVertical: 12 },
  chip: {
    paddingVertical: 12, paddingHorizontal: 22,
    borderRadius: 999, borderWidth: 1.5, borderColor: SL.border, backgroundColor: SL.panel,
  },
  chipActive: {
    borderColor: SL.accent, backgroundColor: 'rgba(74,158,191,0.16)',
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 10,
  },
  chipText: { fontFamily: F.bodyMed, fontSize: 16, color: SL.muted, letterSpacing: 1.5 },
  chipTextActive: { color: SL.accent, fontFamily: F.heading },

  // ── Search ───────────────────────────────────────────────────────────────────

  searchWrap: { paddingHorizontal: 22, paddingBottom: 12, paddingTop: 6 },
  search: {
    height: 58, backgroundColor: SL.panel, borderWidth: 1.5,
    borderColor: SL.accent, borderRadius: 14, paddingHorizontal: 20,
    fontFamily: F.body, fontSize: 19, color: SL.text,
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.18, shadowRadius: 10,
  },

  // ── Empty state ──────────────────────────────────────────────────────────────

  emptyBox: { alignItems: 'center', marginTop: 40, paddingHorizontal: 24 },
  empty: { fontFamily: F.bodyMed, fontSize: 15, color: SL.muted, textAlign: 'center', letterSpacing: 1 },
  emptyHint: {
    fontFamily: F.body, fontSize: 13, color: SL.muted,
    textAlign: 'center', marginTop: 8, letterSpacing: 0.5,
  },

  // ── Selection mode ───────────────────────────────────────────────────────────

  selList: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 100, gap: 10 },
  selCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: SL.panel, borderWidth: 1.5, borderColor: SL.border,
    borderRadius: 4, overflow: 'hidden',
  },
  selThumb: { width: 72, height: 64, flexShrink: 0 },
  selCardBody: { flex: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  selExName: {
    fontFamily: F.heading, fontSize: 14, color: SL.text,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  addExBtn: {
    marginRight: 12, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1.5, borderColor: SL.accent, borderRadius: 4,
    backgroundColor: 'transparent', minWidth: 76, alignItems: 'center',
  },
  addExBtnAdded: { borderColor: SL.green, backgroundColor: 'rgba(76,175,80,0.1)' },
  addExBtnText: { fontFamily: F.body, fontSize: 13, color: SL.accent, letterSpacing: 1.5 },
  addExBtnTextAdded: { color: SL.green },

  // ── Browse grid ───────────────────────────────────────────────────────────────

  browseGrid: { padding: GRID_PAD, paddingTop: 12, paddingBottom: 32 },
  browseGridRow: { gap: GRID_GAP, marginBottom: GRID_GAP },
  // Classic media card: subtle border, soft shadow, rounded — not neon.
  browseCard: {
    width: CARD_W,
    backgroundColor: SL.panel,
    borderWidth: 1, borderColor: SL.border, borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 14,
  },

  // Thumbnail (square, uniform across the grid)
  thumbWrap: {
    width: '100%', aspectRatio: 1,
    backgroundColor: SL.panelAlt, position: 'relative', overflow: 'hidden',
  },
  thumbFill: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  thumbPlaceholder: {
    backgroundColor: SL.panelAlt, justifyContent: 'center', alignItems: 'center',
  },
  thumbIcon: { fontSize: 20, color: SL.muted },
  playOverlay: {
    ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center',
  },
  // Clean, classic play button — white triangle on a soft dark disc.
  playCircle: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: 'rgba(5,9,18,0.5)',
    borderWidth: 2, borderColor: 'rgba(232,244,255,0.92)',
    justifyContent: 'center', alignItems: 'center',
  },
  playIcon: { fontSize: 22, color: '#E8F4FF', marginLeft: 4 },

  browseCardBody: { paddingHorizontal: 16, paddingVertical: 16, gap: 12 },
  browseExName: {
    fontFamily: F.heading, fontSize: 19, color: SL.text,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },

  // ── Shared badges ─────────────────────────────────────────────────────────────

  typeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(74,158,191,0.12)',
    borderWidth: 1, borderColor: SL.accent, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  typeText: { fontFamily: F.bodyMed, fontSize: 12, color: SL.accent, letterSpacing: 1 },
  classBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,215,0,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.5)', borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  classBadgeText: { fontFamily: F.bodyMed, fontSize: 12, color: SL.gold, letterSpacing: 1 },

  // Delete button on exercise browse card
  exDeleteBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,68,68,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 4,
  },
  exDeleteText: { fontFamily: F.body, fontSize: 15, color: '#fff', lineHeight: 17 },

  // ── Done bar ──────────────────────────────────────────────────────────────────

  doneBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: SL.bg, borderTopWidth: 1.5, borderTopColor: SL.border,
    paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 24,
  },
  doneBtn: {
    height: 44, backgroundColor: SL.accent,
    borderRadius: 4, justifyContent: 'center', alignItems: 'center',
  },
  doneBtnText: {
    fontFamily: F.heading, fontSize: 15, color: SL.bg,
    letterSpacing: 2, textTransform: 'uppercase',
  },

  // ── Example workouts top row ──────────────────────────────────────────────────

  workoutsTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  newWorkoutBtn: {
    marginRight: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 4,
    backgroundColor: 'transparent',
  },
  newWorkoutBtnText: {
    fontFamily: F.heading,
    fontSize: 13,
    color: SL.accent,
    letterSpacing: 2,
  },

  // ── Workout cards ─────────────────────────────────────────────────────────────

  workoutsList: { paddingHorizontal: 16, paddingTop: 12 },
  workoutCard: {
    backgroundColor: SL.panel, borderWidth: 1.5, borderColor: SL.border,
    borderRadius: 4, marginBottom: 14, overflow: 'hidden',
  },
  workoutCardHeader: {
    flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12,
  },
  workoutCardLeft: { flex: 1 },
  workoutCardActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  workoutTitle: {
    fontFamily: F.heading, fontSize: 18, color: SL.text,
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4,
  },
  workoutDesc: {
    fontFamily: F.body, fontSize: 13, color: SL.muted, letterSpacing: 0.5, lineHeight: 18,
  },
  workoutChevron: { fontFamily: F.body, fontSize: 12, color: SL.muted },
  cardDeleteBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(255,68,68,0.15)',
    borderWidth: 1, borderColor: 'rgba(255,68,68,0.4)',
    justifyContent: 'center', alignItems: 'center',
  },
  cardDeleteText: { fontFamily: F.body, fontSize: 13, color: SL.danger },

  workoutExercises: {
    borderTopWidth: 1, borderTopColor: SL.border,
    paddingHorizontal: 16, paddingVertical: 12, gap: 12,
  },
  exerciseRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between', gap: 8,
  },
  exerciseRowLeft: {
    flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 12,
  },
  exerciseLetter: {
    fontFamily: F.heading, fontSize: 16, color: SL.accent,
    letterSpacing: 1, width: 20, marginTop: 1,
  },
  exerciseName: {
    fontFamily: F.bodyMed, fontSize: 14, color: SL.text, letterSpacing: 0.5,
  },
  exerciseNotes: {
    fontFamily: F.body, fontSize: 11, color: SL.muted, letterSpacing: 0.3, marginTop: 2,
  },
  exerciseSetsReps: {
    fontFamily: F.heading, fontSize: 13, color: SL.gold, letterSpacing: 1, marginTop: 2,
  },
});
