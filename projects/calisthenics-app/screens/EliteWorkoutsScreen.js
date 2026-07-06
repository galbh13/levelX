import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, TextInput,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useCoach } from '../context/CoachContext';
import { importGalleryWorkout } from '../lib/workouts';
import { F } from '../constants/fonts';
import { CARD_H, CARD_W } from '../constants/layout';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import PillButton from '../components/PillButton';

const SL = {
  bg:     '#050912',
  panel:  '#070d1a',
  border: '#1a3a5c',
  accent: '#4A9EBF',
  text:   '#E8F4FF',
  muted:  '#4a6a8a',
  green:  '#4CAF50',
  gold:   '#FFD700',
};

// Player-only "elite workouts" page. Unlike the admin gallery, this is IMPORT-ONLY:
// no exercise browsing, no authoring/editing — players just pull admin-authored
// example workouts into their own warehouse (My Workouts).
export default function EliteWorkoutsScreen({ navigation }) {
  const { selectedStudent: student } = useCoach();

  const [classes,  setClasses]  = useState([]);
  const [workouts, setWorkouts] = useState([]);
  const [classId,  setClassId]  = useState(null);   // defaults to the first class
  const [category, setCategory] = useState('main'); // main | side | accessory (mirrors the gallery GOAL filter)
  const [search,   setSearch]   = useState('');
  const [expanded, setExpanded] = useState(null);
  const [imported, setImported] = useState({});      // gallery id -> true
  const [busy,     setBusy]     = useState({});      // gallery id -> importing
  const [loading,  setLoading]  = useState(true);

  const load = useCallback(async () => {
    try {
      const [clsRes, wRes] = await Promise.all([
        supabase.from('classes').select('id, name, order_index').order('order_index'),
        supabase
          .from('gallery_example_workouts')
          .select('id, title, description, class_order, class_orders, exercises, branches, category')
          .order('class_order', { ascending: true })
          .order('created_at', { ascending: true }),
      ]);
      const cls = clsRes.data ?? [];
      setClasses(cls);
      setWorkouts(wRes.data ?? []);
      // Default to the first class (the gallery example-workout filter has no ALL).
      // Functional update keeps the player's selection across focus re-loads.
      setClassId(prev => prev ?? cls[0]?.id ?? null);
    } catch (e) {
      console.error('[EliteWorkouts] load:', e);
    }
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  // Re-fetch whenever the screen regains focus so admin edits to the gallery
  // example workouts show up without a full reload.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const selectedClass = useMemo(
    () => classes.find(c => c.id === classId) ?? classes[0] ?? null,
    [classes, classId]
  );
  // Mirror the admin gallery Example Workouts filter: class + goal + title search.
  const shown = useMemo(() => {
    const idx = selectedClass?.order_index ?? 0;
    const q = search.trim().toLowerCase();
    return workouts.filter(w => {
      const set = w.class_orders ?? (w.class_order != null ? [w.class_order] : []);
      const cat = w.category ?? 'main'; // rows predating the category column default to 'main'
      if (!set.includes(idx)) return false;
      if (cat !== category) return false;
      if (q && !(w.title ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [workouts, selectedClass, category, search]);

  async function handleImport(template) {
    if (!student?.id || busy[template.id] || imported[template.id]) return;
    setBusy(prev => ({ ...prev, [template.id]: true }));
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await importGalleryWorkout({ template, studentId: student.id, userId: user.id });
      setImported(prev => ({ ...prev, [template.id]: true }));
    } catch (e) {
      alert('Import failed: ' + (e.message ?? 'Something went wrong.'));
    }
    setBusy(prev => ({ ...prev, [template.id]: false }));
  }

  return (
    <ScreenFrame maxWidth={CARD_W} ready={!loading}>
      <View style={styles.card}>
        <ScreenHeader
          title="WORKOUT LIBRARY"
          subtitle="Import a ready-made workout into My Workouts"
          onBack={() => navigation.goBack()}
          titleStyle={styles.headerTitle}
        />

        {/* Filters — same shape as the admin gallery Example Workouts tab:
            CLASS → GOAL (main/side/accessories) → title search. Chips wrap so
            none get clipped off the right edge on a phone. */}
        <Text style={styles.sectionLabel}>CLASS</Text>
        <View style={styles.chipWrap}>
          {classes.map(c => (
            <TouchableOpacity
              key={c.id}
              style={[styles.chip, selectedClass?.id === c.id && styles.chipActive]}
              onPress={() => { setClassId(c.id); setExpanded(null); }}
            >
              <Text style={[styles.chipText, selectedClass?.id === c.id && styles.chipTextActive]}>
                {c.name.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>GOAL</Text>
        <View style={styles.chipWrap}>
          {[
            { k: 'main',      l: 'MAIN QUEST' },
            { k: 'side',      l: 'SIDE QUEST' },
            { k: 'accessory', l: 'ACCESSORIES' },
            { k: 'legs',      l: 'LEGS' },
          ].map(c => (
            <TouchableOpacity
              key={c.k}
              style={[styles.chip, category === c.k && styles.chipActive]}
              onPress={() => { setCategory(c.k); setExpanded(null); }}
            >
              <Text style={[styles.chipText, category === c.k && styles.chipTextActive]}>
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
            value={search}
            onChangeText={setSearch}
          />
        </View>

        {/* List — fills the remaining fixed-card height, scrolls internally */}
        <View style={styles.listArea}>
          {loading ? (
            <View style={styles.areaCenter}>
              <ActivityIndicator color={SL.accent} size="large" />
            </View>
          ) : shown.length === 0 ? (
            <View style={styles.areaCenter}>
              {search.trim() ? (
                <>
                  <Text style={styles.emptyText}>NO MATCHES</Text>
                  <Text style={styles.emptySub}>Nothing matches "{search.trim()}" here. Try another search, goal, or class.</Text>
                </>
              ) : (
                <>
                  <Text style={styles.emptyText}>NO WORKOUTS YET</Text>
                  <Text style={styles.emptySub}>Ask an admin to add example workouts for this class &amp; goal.</Text>
                </>
              )}
            </View>
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
              {shown.map(w => {
                const exCount = w.exercises?.length ?? 0;
                const isOpen  = expanded === w.id;
                const done    = !!imported[w.id];
                const fork    = Array.isArray(w.branches) && w.branches.length >= 2;
                return (
                  <View key={w.id} style={styles.workoutCard}>
                    <TouchableOpacity
                      style={styles.workoutHead}
                      onPress={() => setExpanded(isOpen ? null : w.id)}
                      activeOpacity={0.8}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.workoutTitle}>{w.title?.toUpperCase()}</Text>
                        {w.description ? (
                          <Text style={styles.workoutDesc} numberOfLines={isOpen ? undefined : 1}>
                            {w.description}
                          </Text>
                        ) : null}
                        <Text style={styles.workoutMeta}>
                          {exCount} {exCount === 1 ? 'EXERCISE' : 'EXERCISES'}{fork ? ' · FORK' : ''}
                        </Text>
                      </View>
                      <Text style={styles.chevron}>{isOpen ? '▲' : '▼'}</Text>
                    </TouchableOpacity>

                    {isOpen && (
                      <View style={styles.exList}>
                        {(w.exercises ?? []).map((ex, i) => (
                          <View key={i} style={styles.exRow}>
                            <Text style={styles.exLetter}>{String.fromCharCode(65 + i)}</Text>
                            <Text style={styles.exName} numberOfLines={1}>{ex.name}</Text>
                            <Text style={styles.exSets}>{ex.sets}×{ex.reps}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    <PillButton
                      label={done ? '✓ ADDED' : '+ IMPORT'}
                      variant="outline"
                      tone={done ? 'green' : 'muted'}
                      size="sm"
                      onPress={() => handleImport(w)}
                      loading={!!busy[w.id]}
                      disabled={done}
                      style={{ alignSelf: 'flex-start', marginHorizontal: 16, marginBottom: 14, marginTop: 4 }}
                    />
                  </View>
                );
              })}
              <View style={{ height: 20 }} />
            </ScrollView>
          )}
        </View>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  card: { height: CARD_H },

  // Smaller title so the long "WORKOUT LIBRARY" doesn't overrun the BACK pill on
  // a narrow phone card (the default 28px + 5 letter-spacing overflows its slot).
  headerTitle: { fontSize: 20, letterSpacing: 2 },

  sectionLabel: {
    fontFamily: F.heading, fontSize: 16, color: SL.accent, opacity: 0.85,
    letterSpacing: 3, textTransform: 'uppercase',
    paddingHorizontal: 22, paddingTop: 16, paddingBottom: 2,
  },
  // Wrapping chip row — phone-friendly (no horizontal clip), matches the gallery.
  chipWrap: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
    paddingHorizontal: 22, paddingVertical: 10,
  },
  searchWrap: { paddingHorizontal: 22, paddingTop: 6, paddingBottom: 10 },
  search: {
    height: 52, backgroundColor: SL.panel, borderWidth: 1.5,
    borderColor: SL.accent, borderRadius: 14, paddingHorizontal: 18,
    fontFamily: F.body, fontSize: 18, color: SL.text,
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.18, shadowRadius: 10,
  },
  chip: {
    paddingVertical: 10, paddingHorizontal: 20,
    borderRadius: 999, borderWidth: 1.5, borderColor: SL.border, backgroundColor: SL.panel,
  },
  chipActive: {
    borderColor: SL.accent, backgroundColor: 'rgba(74,158,191,0.16)',
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 10,
  },
  chipText: { fontFamily: F.bodyMed, fontSize: 15, color: SL.muted, letterSpacing: 1.5 },
  chipTextActive: { color: SL.accent, fontFamily: F.heading },

  listArea: { flex: 1 },
  areaCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 24 },
  emptyText: { fontFamily: F.heading, fontSize: 22, color: SL.muted, letterSpacing: 3, textAlign: 'center' },
  emptySub: { fontFamily: F.bodyMed, fontSize: 17, color: SL.muted, letterSpacing: 0.5, textAlign: 'center', lineHeight: 24 },

  list: { paddingHorizontal: 16, paddingTop: 8, gap: 14 },
  workoutCard: {
    backgroundColor: SL.panel, borderWidth: 1.5, borderColor: SL.border,
    borderRadius: 14, overflow: 'hidden',
  },
  workoutHead: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  workoutTitle: { fontFamily: F.heading, fontSize: 22, color: SL.text, letterSpacing: 1.5, textTransform: 'uppercase' },
  workoutDesc: { fontFamily: F.bodyMed, fontSize: 16, color: SL.muted, letterSpacing: 0.5, marginTop: 4 },
  workoutMeta: { fontFamily: F.bodyMed, fontSize: 14, color: SL.accent, letterSpacing: 1.5, marginTop: 6 },
  chevron: { fontFamily: F.body, fontSize: 14, color: SL.muted },

  exList: { paddingHorizontal: 16, paddingBottom: 8, gap: 6 },
  exRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: 'rgba(26,58,92,0.5)',
  },
  exLetter: { fontFamily: F.heading, fontSize: 16, color: SL.accent, width: 22 },
  exName: { flex: 1, fontFamily: F.bodyMed, fontSize: 16, color: SL.text, letterSpacing: 0.5 },
  exSets: { fontFamily: F.bodyMed, fontSize: 15, color: SL.muted, letterSpacing: 1 },
});
