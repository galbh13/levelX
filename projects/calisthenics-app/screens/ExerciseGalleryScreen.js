import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, Image, ActivityIndicator, ScrollView, Dimensions,
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
  green:  '#4CAF50',
  danger: '#FF4444',
};

const SCREEN_WIDTH = Dimensions.get('window').width;
const BROWSE_CARD_W = (SCREEN_WIDTH - 48) / 2;

const FILTERS = ['All', 'Strength', 'Skill', 'Mobility', 'Conditioning'];

const MOCK_EXERCISES = [
  { id: 'm1', name: 'Pull-Ups',            movement_type: 'Strength',     youtube_url: null },
  { id: 'm2', name: 'L-Sit',               movement_type: 'Skill',        youtube_url: null },
  { id: 'm3', name: 'Hip Flexor Stretch',  movement_type: 'Mobility',     youtube_url: null },
  { id: 'm4', name: 'Burpees',             movement_type: 'Conditioning', youtube_url: null },
  { id: 'm5', name: 'Dips',                movement_type: 'Strength',     youtube_url: null },
  { id: 'm6', name: 'Handstand Hold',      movement_type: 'Skill',        youtube_url: null },
];

function getYouTubeId(url) {
  if (!url) return null;
  for (const p of [/[?&]v=([^&]+)/, /youtu\.be\/([^?&]+)/, /shorts\/([^?&]+)/]) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ExerciseGalleryScreen({ route, navigation }) {
  const selectionMode              = route.params?.selectionMode ?? false;
  const { addExercise, pendingExercises } = useCoach();

  const [exercises,    setExercises]    = useState([]);
  const [filtered,     setFiltered]     = useState([]);
  const [search,       setSearch]       = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [loading,      setLoading]      = useState(true);
  // Map of exerciseId → true while the "✓ ADDED" flash is showing
  const [addedMap, setAddedMap] = useState({});

  useEffect(() => { fetchExercises(); }, []);

  useEffect(() => {
    let result = exercises;
    if (activeFilter !== 'All') result = result.filter(e => e.movement_type === activeFilter);
    if (search.trim())          result = result.filter(e =>
      e.name.toLowerCase().includes(search.toLowerCase())
    );
    setFiltered(result);
  }, [exercises, search, activeFilter]);

  async function fetchExercises() {
    try {
      const { data, error } = await supabase
        .from('exercises_gallery')
        .select('id, name, movement_type, youtube_url')
        .order('name', { ascending: true });
      setExercises((!error && data?.length) ? data : MOCK_EXERCISES);
    } catch {
      setExercises(MOCK_EXERCISES);
    }
    setLoading(false);
  }

  // ── Selection mode: add with visual flash ────────────────────────────────

  function handleAdd(item) {
    addExercise(item);
    setAddedMap(prev => ({ ...prev, [item.id]: true }));
    setTimeout(() => {
      setAddedMap(prev => { const n = { ...prev }; delete n[item.id]; return n; });
    }, 1500);
  }

  // ── Selection mode card (single column, horizontal layout) ───────────────

  function renderSelectionCard({ item }) {
    const thumbId  = getYouTubeId(item.youtube_url);
    const thumbUri = thumbId ? `https://img.youtube.com/vi/${thumbId}/mqdefault.jpg` : null;
    const isAdded  = !!addedMap[item.id];

    return (
      <View style={styles.selCard}>
        {/* Thumbnail */}
        {thumbUri ? (
          <Image source={{ uri: thumbUri }} style={styles.selThumb} resizeMode="cover" />
        ) : (
          <View style={[styles.selThumb, styles.selThumbPlaceholder]}>
            <Text style={styles.thumbIcon}>▶</Text>
          </View>
        )}

        {/* Info */}
        <View style={styles.selCardBody}>
          <Text style={styles.selExName} numberOfLines={2}>{item.name}</Text>
          <View style={styles.typeBadge}>
            <Text style={styles.typeText}>{(item.movement_type ?? '').toUpperCase()}</Text>
          </View>
        </View>

        {/* Add / Added button */}
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

  // ── Browse mode card (2-column grid) ─────────────────────────────────────

  function renderBrowseCard({ item }) {
    const thumbId  = getYouTubeId(item.youtube_url);
    const thumbUri = thumbId ? `https://img.youtube.com/vi/${thumbId}/mqdefault.jpg` : null;

    return (
      <TouchableOpacity
        style={styles.browseCard}
        onPress={() => navigation.navigate('ExerciseDetail', { exercise: item })}
        activeOpacity={0.75}
      >
        {thumbUri ? (
          <Image source={{ uri: thumbUri }} style={styles.browseThumb} resizeMode="cover" />
        ) : (
          <View style={[styles.browseThumb, styles.browseThumbPlaceholder]}>
            <Text style={styles.thumbIcon}>▶</Text>
          </View>
        )}
        <View style={styles.browseCardBody}>
          <Text style={styles.browseExName} numberOfLines={2}>{item.name}</Text>
          <View style={styles.typeBadge}>
            <Text style={styles.typeText}>{(item.movement_type ?? '').toUpperCase()}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  const selectedCount = pendingExercises.length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>

        <Text style={styles.title}>
          {selectionMode ? 'ADD EXERCISES' : 'EXERCISE GALLERY'}
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
          <TouchableOpacity onPress={() => navigation.navigate('AddExercise')}>
            <Text style={styles.addNewText}>+ NEW</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          placeholder="Search exercises..."
          placeholderTextColor={SL.muted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterTab, activeFilter === f && styles.filterTabActive]}
            onPress={() => setActiveFilter(f)}
          >
            <Text style={[styles.filterText, activeFilter === f && styles.filterTextActive]}>
              {f.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      {loading ? (
        <ActivityIndicator color={SL.accent} style={{ marginTop: 40 }} size="large" />
      ) : selectionMode ? (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          renderItem={renderSelectionCard}
          contentContainerStyle={styles.selList}
          ListEmptyComponent={<Text style={styles.empty}>No exercises found.</Text>}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          renderItem={renderBrowseCard}
          numColumns={2}
          contentContainerStyle={styles.browseGrid}
          columnWrapperStyle={styles.browseGridRow}
          ListEmptyComponent={<Text style={styles.empty}>No exercises found.</Text>}
        />
      )}

      {/* Selection mode: fixed Done button */}
      {selectionMode && (
        <View style={styles.doneBar}>
          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.85}
          >
            <Text style={styles.doneBtnText}>
              {selectedCount > 0
                ? `DONE — ${selectedCount} EXERCISE${selectedCount !== 1 ? 'S' : ''} ADDED`
                : 'DONE — BACK TO WORKOUT'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg },

  // ── Header ──────────────────────────────────────────────────────────────────

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: SL.border,
  },
  backText: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.accent,
    letterSpacing: 1.5,
    minWidth: 60,
  },
  title: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.text,
    letterSpacing: 3,
    textTransform: 'uppercase',
    textAlign: 'center',
    flex: 1,
  },
  addNewText: {
    fontFamily: F.body,
    fontSize: 16,
    color: SL.accent,
    letterSpacing: 1,
    minWidth: 60,
    textAlign: 'right',
  },

  // Selected count badge (top right in selection mode)
  countBadge: {
    width: 48,
    height: 28,
    backgroundColor: SL.accent,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countBadgeText: {
    fontFamily: F.heading,
    fontSize: 16,
    color: SL.bg,
    letterSpacing: 1,
  },

  // ── Search ───────────────────────────────────────────────────────────────────

  searchWrap: { paddingHorizontal: 16, paddingTop: 14 },
  search: {
    height: 44,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    paddingHorizontal: 14,
    fontFamily: F.body,
    fontSize: 16,
    color: SL.text,
  },

  // ── Filter tabs ──────────────────────────────────────────────────────────────

  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  filterTab: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: SL.border,
    backgroundColor: SL.panel,
  },
  filterTabActive: {
    borderColor: SL.accent,
    backgroundColor: '#0a1a2e',
  },
  filterText: {
    fontFamily: F.body,
    fontSize: 12,
    color: SL.muted,
    letterSpacing: 1,
  },
  filterTextActive: { color: SL.accent },

  empty: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    textAlign: 'center',
    marginTop: 48,
  },

  // ── Selection mode list ───────────────────────────────────────────────────────

  selList: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 100, gap: 10 },

  selCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    overflow: 'hidden',
    gap: 0,
  },
  selThumb: {
    width: 72,
    height: 64,
    flexShrink: 0,
  },
  selThumbPlaceholder: {
    backgroundColor: '#0d1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbIcon: { fontSize: 20, color: SL.muted },

  selCardBody: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  selExName: {
    fontFamily: F.heading,
    fontSize: 16,
    color: SL.text,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  typeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(74,158,191,0.1)',
    borderWidth: 1,
    borderColor: SL.border,
    borderRadius: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  typeText: {
    fontFamily: F.bodyMed,
    fontSize: 10,
    color: SL.accent,
    letterSpacing: 1,
  },

  // + ADD / ✓ ADDED button
  addExBtn: {
    marginRight: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 4,
    backgroundColor: 'transparent',
    minWidth: 76,
    alignItems: 'center',
  },
  addExBtnAdded: {
    borderColor: '#4CAF50',
    backgroundColor: 'rgba(76,175,80,0.1)',
  },
  addExBtnText: {
    fontFamily: F.body,
    fontSize: 14,
    color: SL.accent,
    letterSpacing: 1.5,
  },
  addExBtnTextAdded: {
    color: '#4CAF50',
  },

  // ── Browse mode grid ──────────────────────────────────────────────────────────

  browseGrid: { padding: 16, paddingTop: 8, paddingBottom: 24 },
  browseGridRow: { gap: 16, marginBottom: 16 },

  browseCard: {
    width: BROWSE_CARD_W,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  browseThumb: { width: '100%', height: 90 },
  browseThumbPlaceholder: {
    backgroundColor: '#0d1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  browseCardBody: { padding: 10, gap: 6 },
  browseExName: {
    fontFamily: F.heading,
    fontSize: 13,
    color: SL.text,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  // ── Done bar ──────────────────────────────────────────────────────────────────

  doneBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: SL.bg,
    borderTopWidth: 1.5,
    borderTopColor: SL.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 24,
  },
  doneBtn: {
    height: 44,
    backgroundColor: SL.accent,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  doneBtnText: {
    fontFamily: F.heading,
    fontSize: 16,
    color: SL.bg,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});
