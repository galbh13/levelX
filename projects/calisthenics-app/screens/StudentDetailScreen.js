import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Modal, TextInput,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';

// ─── Date helpers ─────────────────────────────────────────────────────────────

function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekDays() {
  const today  = new Date();
  const dow    = today.getDay();
  const diff   = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  monday.setHours(0, 0, 0, 0);

  const labels = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  return labels.map((label, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return { label, date: d, dateStr: toDateStr(d) };
  });
}

function isToday(date) {
  const t = new Date();
  return date.getDate() === t.getDate()
    && date.getMonth()  === t.getMonth()
    && date.getFullYear() === t.getFullYear();
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Mock workout data ────────────────────────────────────────────────────────

function getMockWorkouts() {
  const week = getWeekDays();
  return [
    {
      id: 'w1',
      title: 'Pull Day A',
      purpose: 'Build pulling strength',
      scheduled_date: week[0].dateStr,
      exercises: [
        { id: 'e1', letter: 'A', name: 'Pull-Ups',           sets: 4, reps: '8-10',    notes: 'Full ROM' },
        { id: 'e2', letter: 'B', name: 'Australian Pull-Ups', sets: 3, reps: '12',      notes: 'Controlled tempo' },
        { id: 'e3', letter: 'C', name: 'Face Pulls',          sets: 3, reps: '15',      notes: 'Light, focus on retraction' },
      ],
    },
    {
      id: 'w2',
      title: 'Push Day A',
      purpose: 'Develop pressing strength',
      scheduled_date: week[2].dateStr,
      exercises: [
        { id: 'e4', letter: 'A', name: 'Push-Ups',      sets: 4, reps: '15-20', notes: 'Slow eccentric 3s' },
        { id: 'e5', letter: 'B', name: 'Pike Push-Ups', sets: 3, reps: '10',    notes: '' },
        { id: 'e6', letter: 'C', name: 'Dips',          sets: 3, reps: '12',    notes: 'Bodyweight' },
      ],
    },
    {
      id: 'w3',
      title: 'Leg & Core',
      purpose: 'Stability and lower body power',
      scheduled_date: week[4].dateStr,
      exercises: [
        { id: 'e7', letter: 'A', name: 'Pistol Squats', sets: 3, reps: '5 each', notes: 'Assisted if needed' },
        { id: 'e8', letter: 'B', name: 'L-Sit Hold',    sets: 4, reps: '10-15s', notes: 'On parallettes' },
        { id: 'e9', letter: 'C', name: 'Dragon Flag',   sets: 3, reps: '6',      notes: '' },
      ],
    },
  ];
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function StudentDetailScreen({ route, navigation }) {
  const { student } = route.params;
  const weekDays = getWeekDays();
  const todayStr = toDateStr(new Date());

  const [selectedDay, setSelectedDay] = useState(
    weekDays.find(d => d.dateStr === todayStr) ?? weekDays[0]
  );
  const [workouts, setWorkouts]             = useState([]);
  const [loading, setLoading]               = useState(true);
  const [checkupDate, setCheckupDate]       = useState(student.next_checkup ?? '');
  const [editModalVisible, setEditModal]    = useState(false);
  const [editDateInput, setEditDateInput]   = useState('');

  useEffect(() => { fetchWorkouts(); }, []);

  async function fetchWorkouts() {
    try {
      const { data, error } = await supabase
        .from('workouts')
        .select('id, title, purpose, scheduled_date')
        .eq('assigned_to', student.id);
      setWorkouts((!error && data?.length) ? data : getMockWorkouts());
    } catch {
      setWorkouts(getMockWorkouts());
    }
    setLoading(false);
  }

  async function saveCheckupDate() {
    setCheckupDate(editDateInput);
    setEditModal(false);
    try {
      await supabase
        .from('profiles')
        .update({ next_checkup: editDateInput })
        .eq('id', student.id);
    } catch { /* silent */ }
  }

  const workoutForDay = workouts.find(w => w.scheduled_date === selectedDay.dateStr) ?? null;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{student.full_name}</Text>
        <Text style={styles.level}>LVL {student.level ?? '—'}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* Checkup date row */}
        <View style={styles.checkupRow}>
          <Text style={styles.checkupLabel}>
            NEXT CHECKUP:{' '}
            <Text style={styles.checkupValue}>
              {checkupDate ? formatDisplayDate(checkupDate) : 'Not set'}
            </Text>
          </Text>
          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => { setEditDateInput(checkupDate); setEditModal(true); }}
          >
            <Text style={styles.editBtnText}>EDIT</Text>
          </TouchableOpacity>
        </View>

        {/* Weekly calendar */}
        <Text style={styles.sectionLabel}>This Week</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.calendarRow}
        >
          {weekDays.map((day) => {
            const hasWorkout = workouts.some(w => w.scheduled_date === day.dateStr);
            const isSelected = day.dateStr === selectedDay.dateStr;
            const today      = isToday(day.date);
            return (
              <TouchableOpacity
                key={day.dateStr}
                style={[
                  styles.dayNode,
                  isSelected && styles.dayNodeSelected,
                  today && !isSelected && styles.dayNodeToday,
                ]}
                onPress={() => setSelectedDay(day)}
                activeOpacity={0.7}
              >
                <Text style={[styles.dayLabel, isSelected && styles.dayLabelSelected]}>
                  {day.label}
                </Text>
                <Text style={[styles.dayNum, isSelected && styles.dayNumSelected]}>
                  {day.date.getDate()}
                </Text>
                {hasWorkout && (
                  <View style={[styles.dot, isSelected && styles.dotSelected]} />
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* New workout button */}
        <TouchableOpacity
          style={styles.newWorkoutBtn}
          onPress={() => navigation.navigate('CreateWorkout', { student, day: selectedDay })}
          activeOpacity={0.8}
        >
          <Text style={styles.newWorkoutBtnText}>+ New Workout</Text>
        </TouchableOpacity>

        {/* Selected day content */}
        {loading ? (
          <ActivityIndicator color={C.iceGlow} style={{ marginTop: 24 }} />
        ) : workoutForDay ? (
          <View style={styles.workoutCard}>
            <View style={styles.workoutCardTop}>
              <Text style={styles.workoutTitle}>{workoutForDay.title}</Text>
              {workoutForDay.purpose ? (
                <Text style={styles.workoutPurpose}>{workoutForDay.purpose}</Text>
              ) : null}
            </View>
            <TouchableOpacity
              style={styles.viewBtn}
              onPress={() => navigation.navigate('WorkoutDetail', { workout: workoutForDay })}
              activeOpacity={0.8}
            >
              <Text style={styles.viewBtnText}>View Details</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.restCard}>
            <Text style={styles.restLabel}>REST DAY</Text>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => navigation.navigate('CreateWorkout', { student, day: selectedDay })}
              activeOpacity={0.8}
            >
              <Text style={styles.addBtnText}>+ Add Workout</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Checkup edit modal */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEditModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Next Checkup Date</Text>
            <TextInput
              style={styles.modalInput}
              value={editDateInput}
              onChangeText={setEditDateInput}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={C.textMuted}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setEditModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSave} onPress={saveCheckupDate}>
                <Text style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  header: {
    paddingHorizontal: 24,
    paddingTop: 56,
    paddingBottom: 16,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: C.cardBorder,
  },
  back:     { alignSelf: 'flex-start', marginBottom: 10 },
  backText: { fontFamily: F.bodyMed, color: C.iceGlow, fontSize: 13, letterSpacing: 2 },
  title: {
    fontFamily: F.heading,
    fontSize: 22,
    color: C.text,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  level: {
    fontFamily: F.heading,
    fontSize: 13,
    color: C.iceGlow,
    letterSpacing: 2,
    marginTop: 4,
  },

  body: { paddingBottom: 48 },

  checkupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.cardBorder,
  },
  checkupLabel: {
    fontFamily: F.body,
    fontSize: 11,
    color: C.textMuted,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  checkupValue: {
    color: C.iceGlow,
  },
  editBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 4,
  },
  editBtnText: {
    fontFamily: F.body,
    fontSize: 10,
    color: C.iceGlow,
    letterSpacing: 2,
  },

  sectionLabel: {
    fontFamily: F.bodyMed,
    fontSize: 10,
    color: C.textMuted,
    letterSpacing: 3,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },

  calendarRow: {
    paddingHorizontal: 12,
    gap: 8,
  },
  dayNode: {
    width: 48,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.cardBorder,
    backgroundColor: C.surface,
    alignItems: 'center',
    gap: 4,
  },
  dayNodeSelected: {
    backgroundColor: C.iceGlow,
    borderColor: C.iceGlow,
  },
  dayNodeToday: {
    borderColor: C.iceGlow,
  },
  dayLabel: {
    fontFamily: F.body,
    fontSize: 9,
    color: C.textMuted,
    letterSpacing: 1,
  },
  dayLabelSelected: { color: '#fff' },
  dayNum: {
    fontFamily: F.heading,
    fontSize: 16,
    color: C.text,
  },
  dayNumSelected: { color: '#fff' },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: C.iceGlow,
  },
  dotSelected: { backgroundColor: '#fff' },

  workoutCard: {
    marginHorizontal: 16,
    marginTop: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.deepBlue,
    borderRadius: 10,
    padding: 20,
    gap: 14,
  },
  workoutCardTop: { gap: 6 },
  workoutTitle: {
    fontFamily: F.heading,
    fontSize: 16,
    color: C.text,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  workoutPurpose: {
    fontFamily: F.body,
    fontSize: 12,
    color: C.textMuted,
    letterSpacing: 0.5,
  },
  viewBtn: {
    backgroundColor: C.iceGlow,
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
  },
  viewBtnText: {
    fontFamily: F.heading,
    fontSize: 12,
    color: '#fff',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  restCard: {
    marginHorizontal: 16,
    marginTop: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 10,
    padding: 20,
    alignItems: 'center',
    gap: 16,
  },
  restLabel: {
    fontFamily: F.heading,
    fontSize: 14,
    color: C.textMuted,
    letterSpacing: 4,
  },
  addBtn: {
    borderWidth: 1,
    borderColor: C.iceGlow,
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  addBtnText: {
    fontFamily: F.heading,
    fontSize: 12,
    color: C.iceGlow,
    letterSpacing: 2,
  },
  newWorkoutBtn: {
    marginHorizontal: 16,
    marginTop: 16,
    height: 46,
    backgroundColor: C.iceGlow,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  newWorkoutBtnText: {
    fontFamily: F.heading,
    fontSize: 12,
    color: '#fff',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  modalBox: {
    width: '100%',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 12,
    padding: 24,
    gap: 16,
  },
  modalTitle: {
    fontFamily: F.heading,
    fontSize: 14,
    color: C.text,
    letterSpacing: 2,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  modalInput: {
    height: 48,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 6,
    paddingHorizontal: 14,
    fontFamily: F.body,
    fontSize: 14,
    color: C.text,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  modalCancel: {
    flex: 1,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 6,
  },
  modalCancelText: {
    fontFamily: F.body,
    fontSize: 12,
    color: C.textMuted,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  modalSave: {
    flex: 1,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: C.iceGlow,
    borderRadius: 6,
  },
  modalSaveText: {
    fontFamily: F.heading,
    fontSize: 12,
    color: '#fff',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});
