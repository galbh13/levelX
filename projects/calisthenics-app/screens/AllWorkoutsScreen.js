import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useCoach } from '../context/CoachContext';
import { F } from '../constants/fonts';

const SL = {
  bg:     '#050912',
  panel:  '#070d1a',
  border: '#1a3a5c',
  accent: '#4A9EBF',
  blue:   '#3A6E9E',
  text:   '#E8F4FF',
  muted:  '#4a6a8a',
  danger: '#FF4444',
};

function Corner({ pos }) {
  const s = pos === 'TL'
    ? { top: -1, left: -1, borderTopWidth: 1.5, borderLeftWidth: 1.5 }
    : { bottom: -1, right: -1, borderBottomWidth: 1.5, borderRightWidth: 1.5 };
  return <View style={[styles.corner, s]} pointerEvents="none" />;
}

function formatDate(dateStr) {
  if (!dateStr) return 'NO DATE';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
}

export default function AllWorkoutsScreen({ navigation }) {
  const { selectedStudent: student } = useCoach();

  const [workouts, setWorkouts] = useState([]);
  const [loading,  setLoading]  = useState(true);

  const fetchWorkouts = useCallback(async () => {
    if (!student) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('workouts')
        .select('*, exercises(count)')
        .eq('assigned_to', student.id)
        .order('scheduled_date', { ascending: false });

      if (error) throw error;
      setWorkouts(data ?? []);
    } catch (e) {
      console.error('[AllWorkouts] fetch:', e);
      alert('Could not load workouts: ' + e.message);
    }
    setLoading(false);
  }, [student?.id]);

  useEffect(() => { fetchWorkouts(); }, [fetchWorkouts]);

  const handleDelete = async (workoutId) => {
    if (window.confirm('Delete this workout?')) {
      const { error } = await supabase
        .from('workouts')
        .delete()
        .eq('id', workoutId);
      if (error) { alert('Error: ' + error.message); return; }
      setWorkouts(prev => prev.filter(w => w.id !== workoutId));
    }
  };

  function renderWorkout({ item }) {
    const exerciseCount = item.exercises?.[0]?.count ?? 0;
    const isComplete    = item.completed === true;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('WorkoutDetail', { workout: item })}
        activeOpacity={0.8}
      >
        <Corner pos="TL" />
        <Corner pos="BR" />

        {/* Top row: title + delete */}
        <View style={styles.cardTop}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title?.toUpperCase()}</Text>
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => handleDelete(item.id)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.deleteBtnText}>DELETE</Text>
          </TouchableOpacity>
        </View>

        {/* Date */}
        <Text style={styles.cardDate}>{formatDate(item.scheduled_date)}</Text>

        {/* Purpose */}
        {item.purpose ? (
          <Text style={styles.cardPurpose} numberOfLines={2}>{item.purpose}</Text>
        ) : null}

        {/* Footer */}
        <View style={styles.cardFooter}>
          <View style={styles.exCountBadge}>
            <Text style={styles.exCountText}>
              {exerciseCount} {exerciseCount === 1 ? 'EXERCISE' : 'EXERCISES'}
            </Text>
          </View>
          <Text style={[styles.statusText, isComplete && styles.statusComplete]}>
            {isComplete ? '✅ COMPLETE' : '⏳ PENDING'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  if (!student) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>NO STUDENT SELECTED</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.secondaryBtn}>
          <Text style={styles.secondaryBtnText}>← GO BACK</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.subtitle}>{student.full_name?.toUpperCase()}</Text>
        <Text style={styles.title}>ALL WORKOUTS</Text>
        <View style={styles.divider} />
      </View>

      {loading ? (
        <ActivityIndicator color={SL.accent} style={{ marginTop: 48 }} size="large" />
      ) : (
        <FlatList
          data={workouts}
          keyExtractor={item => item.id}
          renderItem={renderWorkout}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>NO WORKOUTS YET</Text>
              <Text style={styles.emptySub}>Create the first one from the student's weekly view.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg },

  corner: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderColor: SL.accent,
    zIndex: 2,
  },

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
    fontSize: 20,
    color: SL.accent,
    letterSpacing: 2,
    marginBottom: 16,
  },
  subtitle: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.muted,
    letterSpacing: 3,
    textAlign: 'center',
    marginBottom: 4,
  },
  title: {
    fontFamily: F.heading,
    fontSize: 36,
    color: SL.accent,
    letterSpacing: 4,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  divider: {
    height: 1,
    backgroundColor: SL.accent,
    opacity: 0.3,
    marginTop: 20,
  },

  // Cool ice-glow frame wrapping the body, matching the Skills page.
  list: {
    padding: 16,
    gap: 12,
    paddingBottom: 48,
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

  card: {
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 10,
    padding: 18,
    gap: 8,
    overflow: 'visible',
    position: 'relative',
    // Soft ice-glow frame, matching the Home / Skills cards.
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardTitle: {
    fontFamily: F.heading,
    fontSize: 28,
    color: SL.text,
    letterSpacing: 2,
    flex: 1,
  },
  deleteBtn: {
    borderWidth: 1.5,
    borderColor: SL.danger,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  deleteBtnText: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.danger,
    letterSpacing: 1.5,
  },
  cardDate: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.accent,
    letterSpacing: 1,
  },
  cardPurpose: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.muted,
    letterSpacing: 0.5,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  exCountBadge: {
    backgroundColor: SL.border,
    borderRadius: 2,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  exCountText: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.accent,
    letterSpacing: 1.5,
  },
  statusText: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 1,
  },
  statusComplete: { color: '#4CAF50' },

  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 16,
    marginTop: 60,
  },
  emptyText: {
    fontFamily: F.heading,
    fontSize: 24,
    color: SL.muted,
    letterSpacing: 3,
    textAlign: 'center',
  },
  emptySub: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.muted,
    letterSpacing: 0.5,
    textAlign: 'center',
    lineHeight: 28,
  },
  secondaryBtn: {
    height: 36,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 6,
    paddingHorizontal: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.accent,
    letterSpacing: 3,
  },
});
