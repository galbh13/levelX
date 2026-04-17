import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useCoach } from '../context/CoachContext';
import { F } from '../constants/fonts';

// ─── Solo Leveling palette ────────────────────────────────────────────────────

const SL = {
  bg:     '#050912',
  panel:  '#070d1a',
  border: '#1a3a5c',
  accent: '#4A9EBF',
  blue:   '#3A6E9E',
  text:   '#E8F4FF',
  muted:  '#4a6a8a',
  danger: '#FF4444',
  green:  '#4CAF50',
};

const TODAY = new Date().toISOString().split('T')[0];

// ─── Corner component ─────────────────────────────────────────────────────────

function Corner({ pos }) {
  const isTop = pos === 'TL';
  const style = isTop
    ? { top: -1, left: -1, borderTopWidth: 1.5, borderLeftWidth: 1.5 }
    : { bottom: -1, right: -1, borderBottomWidth: 1.5, borderRightWidth: 1.5 };
  return <View style={[styles.corner, { borderColor: SL.accent }, style]} pointerEvents="none" />;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCheckup(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Student card (manages its own pulse animation) ───────────────────────────

function StudentCard({ student, todayStatus, onPress }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (todayStatus !== 'missed') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.2, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,   duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [todayStatus]);

  const leftBorderStyle = todayStatus === 'missed'
    ? { borderLeftWidth: 3, borderLeftColor: SL.danger }
    : todayStatus === 'complete'
    ? { borderLeftWidth: 3, borderLeftColor: SL.green }
    : {};

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.panel, leftBorderStyle]}>
        <Corner pos="TL" />
        <Corner pos="BR" />

        {/* Pulsing red dot — only when missed */}
        {todayStatus === 'missed' && (
          <Animated.View style={[styles.pulseDot, { opacity: pulseAnim }]} />
        )}

        <View style={styles.cardInner}>
          <View style={styles.cardMain}>
            <Text style={styles.studentName}>{student.full_name?.toUpperCase()}</Text>

            {/* Today status label */}
            {todayStatus === 'missed' && (
              <Text style={styles.missedLabel}>⚠ MISSED TODAY'S WORKOUT</Text>
            )}
            {todayStatus === 'complete' && (
              <Text style={styles.completeLabel}>✓ TODAY COMPLETE</Text>
            )}

            <Text style={styles.checkupText}>
              NEXT CHECKUP: <Text style={styles.checkupValue}>{formatCheckup(student.nextCheckup)}</Text>
            </Text>
          </View>

          <View style={styles.cardRight}>
            <View style={styles.levelBadge}>
              <Text style={styles.levelText}>LVL {student.level ?? '—'}</Text>
            </View>
            <Text style={styles.chevron}>→</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CoachDashboard({ navigation }) {
  const { setSelectedStudent } = useCoach();
  // Each entry: { ...studentProfile, todayStatus: 'missed' | 'complete' | null }
  const [students, setStudents] = useState([]);
  const [loading,  setLoading]  = useState(true);

  const fetchStudents = useCallback(async () => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) { setLoading(false); return; }

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'student')
        .eq('coach_id', user.id);

      if (profileError || !profileData) { setLoading(false); return; }

      // For each student, fetch today's workouts in parallel
      const enriched = await Promise.all(
        profileData.map(async (student) => {
          const { data: todayAssignments } = await supabase
            .from('workout_override_workouts')
            .select('id, workout_id, completed')
            .eq('student_id', student.id)
            .eq('specific_date', TODAY);

          const todayWorkouts = todayAssignments ?? [];

          let todayStatus = null;
          if (todayWorkouts.length > 0) {
            todayStatus = todayWorkouts.every(w => w.completed) ? 'complete' : 'missed';
          }

          const { data: nextCheckup } = await supabase
            .from('checkups')
            .select('scheduled_date')
            .eq('student_id', student.id)
            .eq('status', 'pending')
            .order('scheduled_date', { ascending: true })
            .limit(1)
            .maybeSingle();

          return { ...student, todayStatus, nextCheckup: nextCheckup?.scheduled_date ?? null };
        })
      );

      setStudents(enriched);
    } catch (e) {
      console.error('[CoachDashboard] fetchStudents:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStudents(); }, [fetchStudents]);

  useFocusEffect(useCallback(() => { fetchStudents(); }, [fetchStudents]));

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => supabase.auth.signOut()}>
            <Text style={styles.signOut}>SIGN OUT</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('ExerciseGallery')}>
            <Text style={styles.galleryLink}>EXERCISE GALLERY →</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.subtitle}>COACH DASHBOARD</Text>
        <Text style={styles.title}>MY STUDENTS</Text>
        <View style={styles.divider} />
      </View>

      {loading ? (
        <ActivityIndicator color={SL.accent} style={{ marginTop: 48 }} size="large" />
      ) : students.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>NO STUDENTS ASSIGNED YET</Text>
          <Text style={styles.emptySubText}>Contact admin to have students assigned to your account.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {students.map((student) => (
            <StudentCard
              key={student.id}
              student={student}
              todayStatus={student.todayStatus}
              onPress={() => { setSelectedStudent(student); navigation.navigate('StudentDetail'); }}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg },

  header: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: SL.border,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  signOut: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 2,
  },
  galleryLink: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.accent,
    letterSpacing: 1.5,
  },
  subtitle: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.muted,
    letterSpacing: 4,
    textAlign: 'center',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  title: {
    fontFamily: F.heading,
    fontSize: 40,
    color: SL.accent,
    letterSpacing: 4,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  divider: {
    height: 1,
    backgroundColor: SL.accent,
    marginTop: 20,
    opacity: 0.4,
  },

  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyText: {
    fontFamily: F.heading,
    fontSize: 24,
    color: SL.muted,
    letterSpacing: 3,
    textAlign: 'center',
  },
  emptySubText: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.muted,
    letterSpacing: 0.5,
    textAlign: 'center',
    opacity: 0.7,
    lineHeight: 28,
  },

  list: { padding: 16, gap: 12, paddingBottom: 48 },

  // Panel base
  panel: {
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    overflow: 'visible',
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 14,
    height: 14,
    zIndex: 2,
  },

  // Pulsing red dot
  pulseDot: {
    position: 'absolute',
    top: 12,
    left: -6,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: SL.danger,
    zIndex: 10,
  },

  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    gap: 12,
  },
  cardMain: { flex: 1, gap: 6 },
  studentName: {
    fontFamily: F.heading,
    fontSize: 28,
    color: SL.text,
    letterSpacing: 2,
  },
  missedLabel: {
    fontFamily: F.bodyMed,
    fontSize: 11,
    color: SL.danger,
    letterSpacing: 1.5,
  },
  completeLabel: {
    fontFamily: F.bodyMed,
    fontSize: 11,
    color: SL.green,
    letterSpacing: 1.5,
  },
  checkupText: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.muted,
    letterSpacing: 1.5,
    marginTop: 2,
  },
  checkupValue: { color: SL.text },
  cardRight: { alignItems: 'flex-end', gap: 8 },
  levelBadge: {
    borderWidth: 1,
    borderColor: SL.accent,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  levelText: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.accent,
    letterSpacing: 2,
  },
  chevron: {
    fontSize: 24,
    color: SL.accent,
    fontFamily: F.bodyMed,
  },
});
