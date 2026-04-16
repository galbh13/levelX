import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';

const MOCK_STUDENTS = [
  { id: 'student-1', full_name: 'Alex Ronen', level: 7,  next_checkup: '2026-04-15' },
  { id: 'student-2', full_name: 'Maya Cohen', level: 4,  next_checkup: '2026-04-20' },
  { id: 'student-3', full_name: 'Ido Levi',   level: 11, next_checkup: '2026-04-12' },
];

function formatCheckup(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function CoachDashboard({ navigation }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => { fetchStudents(); }, []);

  async function fetchStudents() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, level, next_checkup')
        .eq('coach_id', user.id)
        .eq('role', 'student');
      setStudents((!error && data?.length) ? data : MOCK_STUDENTS);
    } catch {
      setStudents(MOCK_STUDENTS);
    }
    setLoading(false);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>My Students</Text>
          <TouchableOpacity onPress={() => supabase.auth.signOut()} style={styles.signOut}>
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.subtitle}>Coach Dashboard</Text>
        <TouchableOpacity
          style={styles.galleryBtn}
          onPress={() => navigation.navigate('ExerciseGallery')}
        >
          <Text style={styles.galleryBtnText}>Exercise Gallery</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={C.iceGlow} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {students.map((student) => (
            <TouchableOpacity
              key={student.id}
              style={styles.card}
              onPress={() => navigation.navigate('StudentDetail', { student })}
              activeOpacity={0.75}
            >
              <View style={styles.cardMain}>
                <Text style={styles.studentName}>{student.full_name}</Text>
                <Text style={styles.checkup}>CHECKUP: {formatCheckup(student.next_checkup)}</Text>
              </View>
              <View style={styles.cardRight}>
                <Text style={styles.level}>LVL {student.level ?? '—'}</Text>
                <Text style={styles.chevron}>›</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: C.cardBorder,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: F.heading,
    fontSize: 26,
    color: C.text,
    letterSpacing: 4,
    textTransform: 'uppercase',
  },
  signOut: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  signOutText: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: C.iceGlow,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  subtitle: {
    fontFamily: F.bodyMed,
    fontSize: 11,
    color: C.iceGlow,
    letterSpacing: 4,
    marginTop: 6,
    textTransform: 'uppercase',
  },
  galleryBtn: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  galleryBtnText: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: C.iceGlow,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  list: {
    padding: 16,
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.deepBlue,
    borderRadius: 10,
    padding: 18,
    gap: 12,
  },
  cardMain: {
    flex: 1,
    gap: 6,
  },
  studentName: {
    fontFamily: F.heading,
    fontSize: 15,
    color: C.text,
    letterSpacing: 1.5,
  },
  checkup: {
    fontFamily: F.body,
    fontSize: 11,
    color: C.textMuted,
    letterSpacing: 1.5,
  },
  cardRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  level: {
    fontFamily: F.heading,
    fontSize: 13,
    color: C.iceGlow,
    letterSpacing: 2,
  },
  chevron: {
    fontSize: 22,
    color: C.iceGlow,
  },
});
