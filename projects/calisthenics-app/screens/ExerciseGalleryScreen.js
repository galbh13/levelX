import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, Image, ActivityIndicator, ScrollView, Dimensions,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_W = (SCREEN_WIDTH - 48) / 2;

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
  const patterns = [/[?&]v=([^&]+)/, /youtu\.be\/([^?&]+)/, /shorts\/([^?&]+)/];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

export default function ExerciseGalleryScreen({ route, navigation }) {
  const selectionMode = route.params?.selectionMode ?? false;
  const returnTo      = route.params?.returnTo      ?? 'CreateWorkout';

  const [exercises,     setExercises]     = useState([]);
  const [filtered,      setFiltered]      = useState([]);
  const [search,        setSearch]        = useState('');
  const [activeFilter,  setActiveFilter]  = useState('All');
  const [loading,       setLoading]       = useState(true);

  useEffect(() => { fetchExercises(); }, []);

  useEffect(() => {
    let result = exercises;
    if (activeFilter !== 'All') result = result.filter(e => e.movement_type === activeFilter);
    if (search.trim())          result = result.filter(e => e.name.toLowerCase().includes(search.toLowerCase()));
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

  function renderCard({ item }) {
    const thumbId  = getYouTubeId(item.youtube_url);
    const thumbUri = thumbId ? `https://img.youtube.com/vi/${thumbId}/mqdefault.jpg` : null;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => !selectionMode && navigation.navigate('ExerciseDetail', { exercise: item })}
        activeOpacity={selectionMode ? 1 : 0.75}
      >
        {thumbUri ? (
          <Image source={{ uri: thumbUri }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View style={styles.thumbPlaceholder}>
            <Text style={styles.thumbIcon}>▶</Text>
          </View>
        )}
        <View style={styles.cardBody}>
          <Text style={styles.exerciseName} numberOfLines={2}>{item.name}</Text>
          <View style={styles.typeBadge}>
            <Text style={styles.typeText}>{item.movement_type}</Text>
          </View>
          {selectionMode && (
            <TouchableOpacity
              style={styles.selectBtn}
              onPress={() => navigation.navigate(returnTo, { selectedExercise: item })}
            >
              <Text style={styles.selectBtnText}>+ Select</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Exercise Gallery</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => navigation.navigate('AddExercise')}
        >
          <Text style={styles.addBtnText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <TextInput
        style={styles.search}
        placeholder="Search exercises..."
        placeholderTextColor={C.textMuted}
        value={search}
        onChangeText={setSearch}
      />

      {/* Filter tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterTab, activeFilter === f && styles.filterTabActive]}
            onPress={() => setActiveFilter(f)}
          >
            <Text style={[styles.filterText, activeFilter === f && styles.filterTextActive]}>
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Grid */}
      {loading ? (
        <ActivityIndicator color={C.iceGlow} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          renderItem={renderCard}
          numColumns={2}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.gridRow}
          ListEmptyComponent={
            <Text style={styles.empty}>No exercises found.</Text>
          }
        />
      )}
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
  back: { marginRight: 12 },
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
  addBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  addBtnText: { fontFamily: F.bodyMed, fontSize: 13, color: C.iceGlow, letterSpacing: 1 },

  search: {
    marginHorizontal: 16,
    marginTop: 14,
    height: 44,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 8,
    paddingHorizontal: 14,
    fontFamily: F.body,
    fontSize: 13,
    color: C.text,
  },

  filterRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  filterTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.cardBorder,
    backgroundColor: C.surface,
  },
  filterTabActive: {
    backgroundColor: C.iceGlow,
    borderColor: C.iceGlow,
  },
  filterText: {
    fontFamily: F.bodyMed,
    fontSize: 11,
    color: C.textMuted,
    letterSpacing: 1,
  },
  filterTextActive: { color: '#fff' },

  grid: { padding: 16, paddingTop: 0 },
  gridRow: { gap: 16, marginBottom: 16 },

  card: {
    width: CARD_W,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 10,
    overflow: 'hidden',
  },
  thumb: { width: '100%', height: 90 },
  thumbPlaceholder: {
    width: '100%',
    height: 90,
    backgroundColor: C.lockedBg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbIcon: { fontSize: 24, color: C.textMuted },

  cardBody: { padding: 10, gap: 6 },
  exerciseName: {
    fontFamily: F.heading,
    fontSize: 12,
    color: C.text,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  typeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: C.lockedBg,
    borderWidth: 1,
    borderColor: C.deepBlue,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  typeText: {
    fontFamily: F.bodyMed,
    fontSize: 9,
    color: C.iceGlow,
    letterSpacing: 1,
  },
  selectBtn: {
    marginTop: 4,
    backgroundColor: C.iceGlow,
    borderRadius: 4,
    paddingVertical: 6,
    alignItems: 'center',
  },
  selectBtnText: {
    fontFamily: F.bodyMed,
    fontSize: 11,
    color: '#fff',
    letterSpacing: 1,
  },

  empty: {
    fontFamily: F.body,
    fontSize: 13,
    color: C.textMuted,
    textAlign: 'center',
    marginTop: 48,
  },
});
