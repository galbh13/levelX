import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, Image, ActivityIndicator, ScrollView, Platform, Alert,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import { useCoach } from '../context/CoachContext';
import { F } from '../constants/fonts';
import ScreenFrame from '../components/ScreenFrame';
import { useDesktopLayout } from '../constants/layout';
import { GearLine } from '../components/CoachText';
import { splitGear } from '../lib/gear';
import { findExerciseUsage, deleteExerciseEverywhere } from '../lib/workouts';

// Video-game "upgrade" arrow (double chevron pointing up) — the placeholder icon
// for exercises with no thumbnail.
function UpgradeArrow({ size = 30, color = '#4A9EBF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 13l6-6 6 6M6 18l6-6 6 6"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// ─── Responsive browse grid ─────────────────────────────────────────────────────
// No fixed body height: the gallery FILLS the frame (ScreenFrame is always in
// `fill` mode here) and the grid/list region flexes to the bottom of the card.
// A fixed height used to cut the grid mid-card and leave a dead black band under
// it — the card is already full height, so let the grid own what's left.
const GRID_PAD  = 20;
const GRID_GAP  = 18;
// Fixed node height: tall enough for a 2-line exercise name. Shorter (1-line)
// names center vertically inside this constant box, so every node lines up.
const NODE_H    = 104;

// ─── Desktop ─────────────────────────────────────────────────────────────────
// The gallery is an ADMIN screen: the library is curated on a COMPUTER, so on a
// desktop-sized canvas it takes `useDesktopLayout()`'s wide card — the same
// sanctioned exception AdminCheckupScreen uses (see constants/layout.js) — and
// lays the grid out in as many columns as that width affords, instead of a
// phone-width column stranded in the middle of a monitor. On a phone NOTHING
// changes: the same card, two columns, 48% each.
//
// Column count is resolved from the live card width inside the component, not
// from a module-level `Dimensions.get()` — that read happens once at import and
// never updates, so a resized window (and the wide card itself) kept getting
// phone-sized columns.
const GRID_TARGET_W = 590; // canvas units — the width a 2-up phone node lands on
function gridColumns(cardW) {
  const usable = cardW - GRID_PAD * 2;
  const cols = Math.round((usable + GRID_GAP) / (GRID_TARGET_W + GRID_GAP));
  return Math.max(2, Math.min(6, cols));
}

// ─── Theme ────────────────────────────────────────────────────────────────────

const SL = {
  bg:      '#050912',
  panel:   '#070d1a',
  border:  '#1a3a5c',
  accent:  '#4A9EBF',
  text:    '#E8F4FF',
  muted:   '#4a6a8a',
  gold:    '#FFD700',
  green:   '#4CAF50',
  danger:  '#FF4444',
};

const MOVEMENT_TYPES = ['All', 'Pull', 'Push', 'Balance', 'Legs', 'Core', 'Mobility', 'Flexibility', 'Isolated'];

// ─── Cross-platform confirm ───────────────────────────────────────────────────

// Plain "here's what happened" message — same web/native split as the confirm.
function notify(message) {
  if (Platform.OS === 'web') window.alert(message);
  else Alert.alert('Exercise library', message);
}

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
    <View style={styles.chipWrap}>
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
    </View>
  );
}

// ─── Workout card ─────────────────────────────────────────────────────────────

// Tapping the card OPENS the workout on the real workout screen (WorkoutDetail
// in preview mode) instead of expanding a stripped inline list under it. The
// inline version could only ever show name + sets×reps — no variation, no notes,
// no fork, no exercise cards — so the one place a coach reads a program back was
// the one place it wasn't fully written down.
function WorkoutCard({ workout, onOpen, onEdit, onDelete }) {
  return (
    <View style={styles.workoutCard}>
      <TouchableOpacity style={styles.workoutCardHeader} onPress={onOpen} activeOpacity={0.8}>
        <View style={styles.workoutCardLeft}>
          <Text style={styles.workoutTitle}>{workout.title}</Text>
          {!!workout.description && (() => {
            const { prose, items } = splitGear(workout.description);
            return (
              <>
                {prose ? (
                  <Text style={styles.workoutDesc} numberOfLines={1}>{prose}</Text>
                ) : null}
                <GearLine items={items} />
              </>
            );
          })()}
        </View>
        <View style={styles.workoutCardActions}>
          {!!onEdit && (
            <TouchableOpacity
              style={styles.cardEditBtn}
              onPress={onEdit}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.cardEditText}>✎</Text>
            </TouchableOpacity>
          )}
          {!!onDelete && (
            <TouchableOpacity
              style={styles.cardDeleteBtn}
              onPress={() => confirmAction(`Delete "${workout.title}"?`, onDelete)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.cardDeleteText}>✕</Text>
            </TouchableOpacity>
          )}
          {/* Points RIGHT: this card leads somewhere, it doesn't unfold. */}
          <Text style={styles.workoutChevron}>›</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

// Filters stay put between visits. Editing an exercise leaves the gallery and
// comes back to it, and re-picking the same class / type every time is pure
// friction during a long session spent inside one class or movement type.
const stickyFilters = {
  activeTab:       null,
  exClassId:       null,
  movFilter:       'All',
  search:          '',
  workoutsClassId: null,
  workoutCategory: 'main',
  workoutSearch:   '',
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ExerciseGalleryScreen({ route, navigation }) {
  const selectionMode = route.params?.selectionMode ?? false;
  const { addExercise, pendingExercises } = useCoach();

  // Desktop: the wide admin card + a grid that actually uses it. `wide` is false
  // on every phone-sized canvas (web or native), where all of this collapses
  // back to the original one-column-card, two-up-grid layout.
  const { wide, cardW } = useDesktopLayout();
  const cols = wide ? gridColumns(cardW) : 2;
  // Fixed pixel columns + a real column gap on desktop: `space-between` would
  // fling a short last row to the card's two edges once there are 3+ columns.
  const nodeStyle = wide
    ? { width: Math.floor((cardW - GRID_PAD * 2 - GRID_GAP * (cols - 1)) / cols) }
    : null;
  // Selection mode's cards are wide rows (thumb + name + ADD), so they take far
  // fewer columns than the name-only browse nodes.
  const selCols = wide ? Math.min(3, Math.max(2, Math.round(cardW / 900))) : 1;

  const [activeTab,       setActiveTab]       = useState(route.params?.initialTab ?? stickyFilters.activeTab ?? 'exercises');
  const [classes,         setClasses]         = useState([]);
  const [exercises,       setExercises]       = useState([]);
  const [exampleWorkouts, setExampleWorkouts] = useState([]);

  // Exercises tab filters
  const [search,    setSearch]    = useState(stickyFilters.search);
  const [movFilter, setMovFilter] = useState(stickyFilters.movFilter);
  const [exClassId, setExClassId] = useState(stickyFilters.exClassId);

  // Workouts tab
  const [workoutsClassId,  setWorkoutsClassId]  = useState(stickyFilters.workoutsClassId);
  const [workoutCategory,  setWorkoutCategory]  = useState(stickyFilters.workoutCategory); // main | side | accessory | legs
  const [workoutSearch,    setWorkoutSearch]    = useState(stickyFilters.workoutSearch);

  // UI
  const [loading,  setLoading]  = useState(true);
  const [addedMap, setAddedMap] = useState({});
  // Catalog id currently being deleted — a delete now sweeps every workout, so
  // it takes long enough that a second tap has to be blocked.
  const [deletingId, setDeletingId] = useState(null);

  // Remember the current filters so the next mount of this screen opens where
  // this one left off.
  useEffect(() => {
    stickyFilters.activeTab       = activeTab;
    stickyFilters.exClassId       = exClassId;
    stickyFilters.movFilter       = movFilter;
    stickyFilters.search          = search;
    stickyFilters.workoutsClassId = workoutsClassId;
    stickyFilters.workoutCategory = workoutCategory;
    stickyFilters.workoutSearch   = workoutSearch;
  }, [activeTab, exClassId, movFilter, search, workoutsClassId, workoutCategory, workoutSearch]);

  useEffect(() => {
    Promise.all([loadClasses(), loadExercises(), loadExampleWorkouts()])
      .finally(() => setLoading(false));
  }, []);

  // Re-fetch exercises / workouts when navigating back to this screen
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      // Editing an exercise leaves the gallery and comes back to it. Re-assert
      // the remembered filters on the way back so the edit lands on the same
      // "hip" / class / type view it started from, whatever the stack did in
      // between (pop, fresh push, or a remount).
      setActiveTab(stickyFilters.activeTab ?? 'exercises');
      setMovFilter(stickyFilters.movFilter);
      setSearch(stickyFilters.search);
      setWorkoutCategory(stickyFilters.workoutCategory);
      setWorkoutSearch(stickyFilters.workoutSearch);
      loadExercises();
      loadExampleWorkouts();
    });
    return unsub;
  }, [navigation]);

  async function loadClasses() {
    const { data } = await supabase
      .from('classes')
      .select('id, name, order_index')
      // Exercise-library targets follow the 'static' class ladder; other jobs
      // (e.g. handstand) don't appear as gallery class filters.
      .eq('job', 'static')
      .order('order_index');
    const rows = data ?? [];
    setClasses(rows);
    // Keep a remembered class if it still exists; otherwise fall back to the first.
    if (rows.length > 0) {
      setWorkoutsClassId(prev => (rows.some(r => r.id === prev) ? prev : rows[0].id));
      setExClassId(prev => (rows.some(r => r.id === prev) ? prev : null));
    }
  }

  async function loadExercises() {
    const { data } = await supabase
      .from('exercises_gallery')
      .select('id, name, movement_type, youtube_url, video_url, description, coaching_cues, min_class_order, class_orders')
      .order('name', { ascending: true });
    setExercises(data ?? []);
  }

  async function loadExampleWorkouts() {
    const { data } = await supabase
      .from('gallery_example_workouts')
      .select('id, title, description, class_order, class_orders, exercises, branches, category')
      .order('class_order', { ascending: true })
      .order('created_at', { ascending: true });
    setExampleWorkouts(data ?? []);
  }

  // ── Delete handlers ──────────────────────────────────────────────────────────

  // Deleting a movement takes it out of the players' workouts too. Without that
  // the workout keeps a copy of something that no longer exists — same name, but
  // its how-to card (video + cues) now resolves to nothing, and nothing anywhere
  // says why. The confirmation names the damage before it's done.
  async function handleDeleteExercise(item) {
    if (deletingId) return;
    setDeletingId(item.id);
    const usage = await findExerciseUsage({ galleryId: item.id, name: item.name });
    setDeletingId(null);
    if (usage.error) {
      notify(`Couldn't check where "${item.name}" is used, so nothing was deleted: ${usage.error.message}`);
      return;
    }

    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const where = [
      usage.workouts  ? plural(usage.workouts, 'player workout')   : null,
      usage.templates ? plural(usage.templates, 'library workout') : null,
    ].filter(Boolean).join(' and ');
    const message = where
      ? `Delete "${item.name}"?\n\nIt will also be taken out of ${where}. This cannot be undone.`
      : `Delete "${item.name}"?`;

    confirmAction(message, async () => {
      setDeletingId(item.id);
      // The copies are swept FIRST: deleting the catalog row nulls every
      // `gallery_id` pointing at it, leaving only the weaker name match to find
      // them. A failure here leaves the catalog entry standing, so a retry is
      // still a complete delete.
      const purge = await deleteExerciseEverywhere({ galleryId: item.id, name: item.name });
      if (purge.error) {
        setDeletingId(null);
        notify(`Couldn't take "${item.name}" out of existing workouts, so it was left in the library: ${purge.error.message}`);
        return;
      }

      const { error } = await supabase
        .from('exercises_gallery')
        .delete()
        .eq('id', item.id);
      setDeletingId(null);
      if (error) {
        notify(`Removed from workouts, but the library entry didn't delete: ${error.message}`);
        return;
      }
      setExercises(prev => prev.filter(e => e.id !== item.id));
      if (purge.workouts || purge.templates) {
        notify(`"${item.name}" deleted — and taken out of ${plural(purge.workouts, 'player workout')} and ${plural(purge.templates, 'library workout')}.`);
      }
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
      result = result.filter(e => {
        const set = e.class_orders
          ?? (e.min_class_order != null ? [e.min_class_order] : null);
        // null/empty = targets all classes.
        return !set || set.length === 0 || set.includes(selectedExClass.order_index);
      });
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

  const shownWorkouts = useMemo(() => {
    const idx = workoutsClass?.order_index ?? 0;
    const q = workoutSearch.trim().toLowerCase();
    return exampleWorkouts.filter(w => {
      const set = w.class_orders ?? (w.class_order != null ? [w.class_order] : []);
      // Rows predating the category column default to 'main'.
      const cat = w.category ?? 'main';
      if (!(set.includes(idx) && cat === workoutCategory)) return false;
      if (q && !(w.title ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [exampleWorkouts, workoutsClass, workoutCategory, workoutSearch]);

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
    if (item.__filler) return <View style={styles.selCardCol} />;
    const thumbId  = getYouTubeId(item.youtube_url);
    const thumbUri = thumbId ? `https://img.youtube.com/vi/${thumbId}/mqdefault.jpg` : null;
    const isAdded  = !!addedMap[item.id];
    return (
      <View style={[styles.selCard, selCols > 1 && styles.selCardCol]}>
        {/* Tapping the thumbnail/name opens the full exercise detail (video +
            cues); the + ADD button stays separate so it still just adds. */}
        <TouchableOpacity
          style={styles.selCardMain}
          onPress={() => navigation.navigate('ExerciseDetail', { exercise: item, hideEdit: true })}
          activeOpacity={0.75}
        >
          {thumbUri ? (
            <Image source={{ uri: thumbUri }} style={styles.selThumb} resizeMode="cover" />
          ) : (
            <View style={[styles.selThumb, styles.thumbPlaceholder]}>
              <UpgradeArrow size={30} color={SL.accent} />
            </View>
          )}
          <View style={styles.selCardBody}>
            <Text style={styles.selExName} numberOfLines={2}>{item.name}</Text>
            <View style={styles.typeBadge}>
              <Text style={styles.typeText}>{(item.movement_type ?? '').toUpperCase()}</Text>
            </View>
          </View>
        </TouchableOpacity>
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
    return (
      <View style={[styles.browseCard, nodeStyle]}>
        <TouchableOpacity
          style={styles.browseCardInner}
          onPress={() => navigation.navigate('ExerciseDetail', { exercise: item })}
          activeOpacity={0.8}
        >
          {/* Name only — centered vertically + horizontally; up to two lines. */}
          <Text style={styles.browseExName} numberOfLines={2}>{item.name}</Text>
        </TouchableOpacity>

        {/* Delete button — admin browse only */}
        <TouchableOpacity
          style={[styles.exDeleteBtn, deletingId === item.id && styles.exDeleteBtnBusy]}
          onPress={() => handleDeleteExercise(item)}
          disabled={!!deletingId}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={styles.exDeleteText}>{deletingId === item.id ? '…' : '✕'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const selectedCount = pendingExercises?.length ?? 0;

  // Multi-column FlatList rows share their width with `flex: 1`, so a last row
  // holding 1 of 3 cards would stretch that card across the whole card. Pad the
  // data with invisible fillers to keep every row's cards the same width.
  const selData = useMemo(() => {
    if (selCols < 2) return filteredExercises;
    const rem = filteredExercises.length % selCols;
    if (rem === 0) return filteredExercises;
    return [
      ...filteredExercises,
      ...Array.from({ length: selCols - rem }, (_, i) => ({ id: `__filler_${i}`, __filler: true })),
    ];
  }, [filteredExercises, selCols]);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <ScreenFrame fill maxWidth={cardW}>
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        {/* popToTop (not goBack) so BACK always lands on the stack root — the admin
            dashboard — regardless of how we got here (e.g. via Detail → Edit, which
            re-enter the gallery and would otherwise make goBack retrace those). */}
        <TouchableOpacity style={styles.navBtn} onPress={() => navigation.popToTop()} activeOpacity={0.85}>
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
          <TouchableOpacity
            style={styles.navBtn}
            onPress={() => activeTab === 'workouts'
              ? navigation.navigate('AddExampleWorkout', { defaultClassOrder: workoutsClass?.order_index ?? 0, defaultCategory: workoutCategory })
              : navigation.navigate('AddExercise')}
            activeOpacity={0.85}
          >
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
              WORKOUTS
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {selectionMode ? (

        /* ─────────── SELECTION MODE (fill, scrollable) ─────────── */
        <>
          <Text style={styles.sectionLabel}>TYPE</Text>
          <View style={styles.chipWrap}>
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
          </View>

          <View style={styles.searchWrap}>
            <TextInput
              style={styles.search}
              placeholder="Search exercises..."
              placeholderTextColor={SL.muted}
              value={search}
              onChangeText={setSearch}
            />
          </View>

          <FlatList
            data={selData}
            keyExtractor={item => item.id}
            renderItem={renderSelectionCard}
            /* numColumns can't change on a live list — the key remounts it. */
            key={`sel-${selCols}`}
            numColumns={selCols}
            columnWrapperStyle={selCols > 1 ? styles.selRow : undefined}
            contentContainerStyle={styles.selList}
            ListEmptyComponent={
              loading
                ? <ActivityIndicator color={SL.accent} style={{ marginTop: 48 }} size="large" />
                : <Text style={styles.empty}>No exercises found.</Text>
            }
          />

          <View style={styles.doneBar}>
            <TouchableOpacity style={styles.doneBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
              <Text style={styles.doneBtnText}>
                {selectedCount > 0
                  ? `DONE — ${selectedCount} EXERCISE${selectedCount !== 1 ? 'S' : ''} ADDED`
                  : 'DONE — BACK TO WORKOUT'}
              </Text>
            </TouchableOpacity>
          </View>
        </>

      ) : activeTab === 'exercises' ? (

        /* ─────────── EXERCISES TAB ─────────── */
        /* Flexible body: fills the card below the tab bar, so the grid runs all
           the way to the bottom edge instead of stopping short. */
        <View style={styles.tabBody}>
          <Text style={styles.sectionLabel}>CLASS</Text>
          <ClassChips classes={classes} selectedId={exClassId} onSelect={setExClassId} showAll />

          <Text style={styles.sectionLabel}>TYPE</Text>
          <View style={styles.chipWrap}>
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
          </View>

          <View style={styles.searchWrap}>
            <TextInput
              style={styles.search}
              placeholder="Search exercises..."
              placeholderTextColor={SL.muted}
              value={search}
              onChangeText={setSearch}
            />
          </View>

          <View style={styles.gridArea}>
            {loading ? (
              <View style={styles.gridCenter}>
                <ActivityIndicator color={SL.accent} size="large" />
              </View>
            ) : filteredExercises.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.empty}>No exercises yet.</Text>
                <Text style={styles.emptyHint}>Tap + NEW to add the first one.</Text>
              </View>
            ) : (
              <ScrollView style={styles.gridScroll} contentContainerStyle={styles.browseGrid} showsVerticalScrollIndicator={false}>
                <View style={[styles.browseGridWrap, wide && styles.browseGridWrapWide]}>
                  {filteredExercises.map(item => (
                    <React.Fragment key={item.id}>{renderBrowseCard({ item })}</React.Fragment>
                  ))}
                </View>
              </ScrollView>
            )}
          </View>
        </View>

      ) : (

        /* ─────────── EXAMPLE WORKOUTS TAB ─────────── */
        <View style={styles.tabBody}>
          {/* Class selector — workout creation now lives in the header + NEW */}
          <Text style={styles.sectionLabel}>CLASS</Text>
          <View style={styles.workoutsTopRow}>
            <ClassChips
              classes={classes}
              selectedId={workoutsClassId}
              onSelect={id => { setWorkoutsClassId(id ?? classes[0]?.id); setExpandedWorkout(null); }}
              showAll={false}
            />
          </View>

          {/* Goal filter within the class — categories mirror the workout builder
              (AddExampleWorkoutScreen): MAIN QUEST / SIDE QUEST / ACCESSORIES. */}
          <Text style={styles.sectionLabel}>GOAL</Text>
          <View style={styles.chipWrap}>
            {[
              { k: 'main',      l: 'MAIN QUEST' },
              { k: 'side',      l: 'SIDE QUEST' },
              { k: 'handstand', l: 'HANDSTAND' },
              { k: 'accessory', l: 'ACCESSORIES' },
              { k: 'legs',      l: 'LEGS' },
            ].map(c => (
              <TouchableOpacity
                key={c.k}
                style={[styles.chip, workoutCategory === c.k && styles.chipActive]}
                onPress={() => { setWorkoutCategory(c.k); setExpandedWorkout(null); }}
              >
                <Text style={[styles.chipText, workoutCategory === c.k && styles.chipTextActive]}>
                  {c.l}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.searchWrap}>
            <TextInput
              style={styles.search}
              placeholder="Search workouts..."
              placeholderTextColor={SL.muted}
              value={workoutSearch}
              onChangeText={setWorkoutSearch}
            />
          </View>

          <View style={styles.gridArea}>
            {loading ? (
              <View style={styles.gridCenter}>
                <ActivityIndicator color={SL.accent} size="large" />
              </View>
            ) : (
              <ScrollView style={styles.gridScroll} contentContainerStyle={styles.workoutsList} showsVerticalScrollIndicator={false}>
                {shownWorkouts.length === 0 ? (
                  <View style={styles.emptyBox}>
                    {workoutSearch.trim() ? (
                      <>
                        <Text style={styles.empty}>No workouts match "{workoutSearch.trim()}".</Text>
                        <Text style={styles.emptyHint}>Try a different search or category.</Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.empty}>No example workouts yet.</Text>
                        <Text style={styles.emptyHint}>Tap + NEW to create one for this class.</Text>
                      </>
                    )}
                  </View>
                ) : (
                  <View style={wide && styles.workoutsWrapWide}>
                    {shownWorkouts.map(workout => (
                      <View key={workout.id} style={wide && styles.workoutColWide}>
                        <WorkoutCard
                          workout={workout}
                          onOpen={() => navigation.navigate('WorkoutDetail', { preview: workout })}
                          onEdit={() => navigation.navigate('AddExampleWorkout', { workout })}
                          onDelete={() => handleDeleteWorkout(workout)}
                        />
                      </View>
                    ))}
                  </View>
                )}
                <View style={{ height: 40 }} />
              </ScrollView>
            )}
          </View>
        </View>
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
  backText: { fontFamily: F.heading, fontSize: 19, color: SL.accent, letterSpacing: 2 },
  title: {
    fontFamily: F.heading, fontSize: 36, color: SL.accent,
    letterSpacing: 6, textTransform: 'uppercase', flex: 1, textAlign: 'center',
    textShadowColor: 'rgba(74,158,191,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20,
  },
  addNewText: {
    fontFamily: F.heading, fontSize: 19, color: SL.accent, letterSpacing: 2,
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
  tabText: { fontFamily: F.heading, fontSize: 20, color: SL.muted, letterSpacing: 2.5 },
  tabTextActive: {
    color: SL.accent,
    textShadowColor: 'rgba(74,158,191,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
  },

  // ── Section labels & chips ───────────────────────────────────────────────────

  sectionLabel: {
    fontFamily: F.heading, fontSize: 17, color: SL.accent, opacity: 0.85,
    letterSpacing: 3, textTransform: 'uppercase',
    paddingHorizontal: 22, paddingTop: 22, paddingBottom: 4,
  },
  // Phone-friendly chip layout: wraps to multiple rows so no chip is clipped off
  // the right edge (the old horizontal ScrollView cut chips on narrow screens).
  chipWrap: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 12,
    paddingHorizontal: 22, paddingVertical: 12,
  },
  chip: {
    paddingVertical: 12, paddingHorizontal: 22,
    borderRadius: 999, borderWidth: 1.5, borderColor: SL.border, backgroundColor: SL.panel,
  },
  chipActive: {
    borderColor: SL.accent, backgroundColor: 'rgba(74,158,191,0.16)',
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 10,
  },
  // The label keeps the SAME (bold) face whether or not the chip is selected —
  // only the color changes. Swapping Regular→Bold on select changed the label's
  // width, which re-flowed the whole wrapping row (picking FLEXIBILITY pushed
  // ISOLATED onto a second line). Constant metrics = chips never move.
  chipText: { fontFamily: F.heading, fontSize: 19, color: SL.muted, letterSpacing: 1.5 },
  chipTextActive: { color: SL.accent },

  // ── Search ───────────────────────────────────────────────────────────────────

  searchWrap: { paddingHorizontal: 22, paddingBottom: 12, paddingTop: 6 },
  search: {
    height: 58, backgroundColor: SL.panel, borderWidth: 1.5,
    borderColor: SL.accent, borderRadius: 14, paddingHorizontal: 20,
    fontFamily: F.body, fontSize: 22, color: SL.text,
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.18, shadowRadius: 10,
  },

  // ── Empty state ──────────────────────────────────────────────────────────────

  emptyBox: { alignItems: 'center', marginTop: 40, paddingHorizontal: 24 },
  empty: { fontFamily: F.bodyMed, fontSize: 18, color: SL.muted, textAlign: 'center', letterSpacing: 1 },
  emptyHint: {
    fontFamily: F.body, fontSize: 16, color: SL.muted,
    textAlign: 'center', marginTop: 8, letterSpacing: 0.5,
  },

  // ── Selection mode ───────────────────────────────────────────────────────────

  selList: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 100, gap: 10 },
  // Desktop selection list: even columns (each card flexes to its share).
  selRow: { gap: 10 },
  selCardCol: { flex: 1 },
  selCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: SL.panel, borderWidth: 1.5, borderColor: SL.border,
    borderRadius: 4, overflow: 'hidden',
  },
  selCardMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  selThumb: { width: 72, height: 64, flexShrink: 0 },
  selCardBody: { flex: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  selExName: {
    fontFamily: F.heading, fontSize: 17, color: SL.text,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  // Same glowing ice-pill shape as the BACK button, so the two read as one family.
  addExBtn: {
    marginRight: 12, paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: 24, borderWidth: 1.5, borderColor: SL.accent,
    backgroundColor: 'rgba(74,158,191,0.10)',
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 10,
    minWidth: 76, alignItems: 'center',
  },
  addExBtnAdded: {
    borderColor: SL.green, backgroundColor: 'rgba(76,175,80,0.10)', shadowColor: SL.green,
  },
  addExBtnText: { fontFamily: F.heading, fontSize: 16, color: SL.accent, letterSpacing: 1.5 },
  addExBtnTextAdded: { color: SL.green },

  // ── Browse grid ───────────────────────────────────────────────────────────────

  // Both browse tabs fill the rest of the card below the header/tab bar, so the
  // frame is always exactly viewport-tall and neither tab leaves dead space.
  tabBody: { flex: 1, minHeight: 0 },
  // Scroll region takes everything the tab's controls leave — it grows with the
  // window instead of stopping at a constant height.
  gridArea: { flex: 1, minHeight: 0 },
  gridScroll: { flex: 1 },
  gridCenter: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  browseGrid: { padding: GRID_PAD, paddingTop: 12, paddingBottom: 32 },
  // Non-virtualized wrapping grid. Percentage-width cards + space-between so the
  // two columns always fill the row edge-to-edge regardless of measured width.
  browseGridWrap: {
    flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'space-between', rowGap: GRID_GAP,
  },
  // Desktop grid: explicit column gap, rows packed from the left, so a last row
  // holding 1 of 4 nodes sits under the first column instead of being stretched
  // across the whole card by `space-between`.
  browseGridWrapWide: { justifyContent: 'flex-start', columnGap: GRID_GAP },
  // Name-only node: fixed height so every card lines up; the name is centered
  // inside, so a 1-line name sits mid-card and a 2-line name fills it evenly.
  browseCard: {
    width: '48%',
    height: NODE_H,
    position: 'relative',
    backgroundColor: SL.panel,
    borderWidth: 1, borderColor: SL.border, borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 14,
  },
  browseCardInner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },

  // Icon placeholder for exercises with no thumbnail (selection cards).
  thumbPlaceholder: {
    backgroundColor: 'transparent', justifyContent: 'center', alignItems: 'center',
  },

  browseExName: {
    fontFamily: F.heading, fontSize: 22, color: SL.text,
    letterSpacing: 0.5, textTransform: 'uppercase',
    textAlign: 'center', lineHeight: 28,
  },

  // ── Shared badges ─────────────────────────────────────────────────────────────

  typeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(74,158,191,0.12)',
    borderWidth: 1, borderColor: SL.accent, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  typeText: { fontFamily: F.bodyMed, fontSize: 15, color: SL.accent, letterSpacing: 1 },

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
  exDeleteBtnBusy: { opacity: 0.5 },
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

  // ── Workout cards ─────────────────────────────────────────────────────────────

  workoutsList: { paddingHorizontal: 16, paddingTop: 12 },
  // Desktop: example workouts run two-up — a full-width row per workout across a
  // 1600px card is one title and an ocean of empty panel.
  workoutsWrapWide: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14 },
  workoutColWide:   { width: '49%' },
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
    fontFamily: F.heading, fontSize: 22, color: SL.text,
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4,
  },
  workoutDesc: {
    fontFamily: F.body, fontSize: 16, color: SL.muted, letterSpacing: 0.5, lineHeight: 22,
  },
  workoutChevron: { fontFamily: F.body, fontSize: 12, color: SL.muted },
  cardEditBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(74,158,191,0.15)',
    borderWidth: 1.5, borderColor: SL.accent,
    justifyContent: 'center', alignItems: 'center',
  },
  cardEditText: { fontFamily: F.body, fontSize: 20, color: SL.accent },
  cardDeleteBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,68,68,0.15)',
    borderWidth: 1.5, borderColor: 'rgba(255,68,68,0.6)',
    justifyContent: 'center', alignItems: 'center',
  },
  cardDeleteText: { fontFamily: F.body, fontSize: 20, color: SL.danger },

});
