import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatJoinDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LevelBadge({ level }) {
  return (
    <View style={styles.levelBadge}>
      <Text style={styles.levelBadgeText}>LVL {level ?? '—'}</Text>
    </View>
  );
}

function UnassignedCard({ student, onAssign }) {
  return (
    <View style={styles.studentCard}>
      <View style={styles.cardLeft}>
        <Text style={styles.studentName}>{student.full_name}</Text>
        <Text style={styles.joinDate}>Joined {formatJoinDate(student.created_at)}</Text>
      </View>
      <View style={styles.cardRight}>
        <LevelBadge level={student.level} />
        <TouchableOpacity style={styles.assignBtn} onPress={() => onAssign(student)}>
          <Text style={styles.assignBtnText}>ASSIGN</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function CoachBlock({ coach, students, coaches, onReassign, onRemove }) {
  const [expanded, setExpanded] = useState(false);
  const myStudents = students.filter(s => s.coach_id === coach.id);

  return (
    <View style={styles.coachBlock}>
      <TouchableOpacity
        style={styles.coachHeader}
        onPress={() => setExpanded(e => !e)}
        activeOpacity={0.7}
      >
        <View style={styles.coachHeaderLeft}>
          <Text style={styles.coachName}>{coach.full_name?.toUpperCase()}</Text>
          <Text style={styles.coachCount}>
            {myStudents.length} {myStudents.length === 1 ? 'STUDENT' : 'STUDENTS'}
          </Text>
        </View>
        <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.coachStudents}>
          {myStudents.length === 0 ? (
            <Text style={styles.emptyText}>No students assigned.</Text>
          ) : (
            myStudents.map(student => (
              <View key={student.id} style={styles.rosterRow}>
                <View style={styles.rosterLeft}>
                  <Text style={styles.rosterName}>{student.full_name}</Text>
                  <LevelBadge level={student.level} />
                </View>
                <View style={styles.rosterActions}>
                  <TouchableOpacity
                    style={styles.rosterBtn}
                    onPress={() => onReassign(student, coach)}
                  >
                    <Text style={styles.rosterBtnText}>REASSIGN</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.rosterBtn, styles.rosterBtnDanger]}
                    onPress={() => onRemove(student)}
                  >
                    <Text style={[styles.rosterBtnText, styles.rosterBtnTextDanger]}>REMOVE</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}

// ─── Coach Picker Modal ───────────────────────────────────────────────────────

function CoachPickerModal({ visible, coaches, excludeCoachId, onSelect, onClose }) {
  const options = excludeCoachId
    ? coaches.filter(c => c.id !== excludeCoachId)
    : coaches;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalBox}>
          <Text style={styles.modalTitle}>SELECT COACH</Text>
          <ScrollView style={{ maxHeight: 320 }}>
            {options.map(coach => (
              <TouchableOpacity
                key={coach.id}
                style={styles.coachOption}
                onPress={() => onSelect(coach)}
                activeOpacity={0.7}
              >
                <Text style={styles.coachOptionName}>{coach.full_name}</Text>
                <Text style={styles.coachOptionCount}>
                  {coach._studentCount} students
                </Text>
              </TouchableOpacity>
            ))}
            {options.length === 0 && (
              <Text style={styles.emptyText}>No other coaches available.</Text>
            )}
          </ScrollView>
          <TouchableOpacity style={styles.modalCancelBtn} onPress={onClose}>
            <Text style={styles.modalCancelText}>CANCEL</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function AdminDashboard({ navigation }) {
  const [unassigned,  setUnassigned]  = useState([]);
  const [students,    setStudents]    = useState([]);   // all students, for the roster
  const [coaches,     setCoaches]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);

  // Modal state
  const [modalVisible,   setModalVisible]   = useState(false);
  const [targetStudent,  setTargetStudent]  = useState(null);   // student being assigned/reassigned
  const [excludeCoach,   setExcludeCoach]   = useState(null);   // current coach to exclude (for reassign)

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      // Unassigned students — must use .is() for NULL checks in Supabase
      const { data: unassignedData, error: unassignedErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'student')
        .is('coach_id', null);
      console.log('[AdminDashboard] unassigned students:', JSON.stringify(unassignedData));
      console.log('[AdminDashboard] unassigned error:', JSON.stringify(unassignedErr));

      // All students (for the coaching roster — needs assigned ones too)
      const { data: allStudentData, error: allStudentErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'student');
      console.log('[AdminDashboard] all students:', JSON.stringify(allStudentData));
      console.log('[AdminDashboard] all students error:', JSON.stringify(allStudentErr));

      // All coaches
      const { data: coachData, error: cErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'coach');
      console.log('[AdminDashboard] coaches:', JSON.stringify(coachData));
      console.log('[AdminDashboard] coaches error:', JSON.stringify(cErr));

      const studentList = allStudentData ?? [];
      const coachList   = (coachData ?? []).map(coach => ({
        ...coach,
        _studentCount: studentList.filter(s => s.coach_id === coach.id).length,
      }));

      setUnassigned(unassignedData ?? []);
      setStudents(studentList);
      setCoaches(coachList);
    } catch (e) {
      console.error('[AdminDashboard] fetchData exception:', e);
    }
  }, []);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  async function refresh() {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }

  // ── Assign / Reassign ──────────────────────────────────────────────────────

  function openAssign(student) {
    setTargetStudent(student);
    setExcludeCoach(null);
    setModalVisible(true);
  }

  function openReassign(student, currentCoach) {
    setTargetStudent(student);
    setExcludeCoach(currentCoach.id);
    setModalVisible(true);
  }

  async function handleCoachSelected(coach) {
    setModalVisible(false);
    if (!targetStudent) return;
    const student = targetStudent;
    setTargetStudent(null);
    try {
      console.log('[AdminDashboard] assigning student', student.id, '→ coach', coach.id);
      const { error } = await supabase
        .from('profiles')
        .update({ coach_id: coach.id })
        .eq('id', student.id);
      if (error) {
        console.error('[AdminDashboard] assign error:', error);
        Alert.alert('Assignment Failed', error.message ?? 'Could not assign coach.');
        return;
      }
      // Refetch from Supabase so UI reflects real DB state
      await fetchData();
    } catch (e) {
      console.error('[AdminDashboard] assign exception:', e);
      Alert.alert('Assignment Failed', e.message ?? 'Something went wrong.');
    }
  }

  async function handleRemove(student) {
    try {
      console.log('[AdminDashboard] removing coach from student', student.id);
      const { error } = await supabase
        .from('profiles')
        .update({ coach_id: null })
        .eq('id', student.id);
      if (error) {
        console.error('[AdminDashboard] remove error:', error);
        Alert.alert('Remove Failed', error.message ?? 'Could not remove coach assignment.');
        return;
      }
      // Refetch from Supabase so UI reflects real DB state
      await fetchData();
    } catch (e) {
      console.error('[AdminDashboard] remove exception:', e);
      Alert.alert('Remove Failed', e.message ?? 'Something went wrong.');
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.topBarBtn}
          onPress={() => navigation.navigate('ExerciseGallery')}
        >
          <Text style={styles.topBarBtnText}>GALLERY</Text>
        </TouchableOpacity>

        <Text style={styles.pageTitle}>ADMIN</Text>

        <TouchableOpacity
          style={styles.topBarBtn}
          onPress={() => supabase.auth.signOut()}
        >
          <Text style={styles.topBarBtnText}>SIGN OUT</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.iceGlow} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.iceGlow} />}
        >
          {/* ── Section 1: Unassigned ── */}
          <Text style={styles.sectionTitle}>UNASSIGNED STUDENTS</Text>
          <View style={styles.sectionPill}>
            <Text style={styles.sectionPillText}>{unassigned.length}</Text>
          </View>

          {unassigned.length === 0 ? (
            <Text style={styles.emptyText}>All students are assigned.</Text>
          ) : (
            unassigned.map(student => (
              <UnassignedCard
                key={student.id}
                student={student}
                onAssign={openAssign}
              />
            ))
          )}

          {/* ── Section 2: Coaching Roster ── */}
          <Text style={[styles.sectionTitle, { marginTop: 32 }]}>COACHING ROSTER</Text>

          {coaches.length === 0 ? (
            <Text style={styles.emptyText}>No coaches found.</Text>
          ) : (
            coaches.map(coach => (
              <CoachBlock
                key={coach.id}
                coach={coach}
                students={students}
                coaches={coaches}
                onReassign={openReassign}
                onRemove={handleRemove}
              />
            ))
          )}
        </ScrollView>
      )}

      {/* Coach picker modal */}
      <CoachPickerModal
        visible={modalVisible}
        coaches={coaches}
        excludeCoachId={excludeCoach}
        onSelect={handleCoachSelected}
        onClose={() => { setModalVisible(false); setTargetStudent(null); }}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.cardBorder,
  },
  pageTitle: {
    fontFamily: F.heading,
    fontSize: 18,
    color: C.text,
    letterSpacing: 4,
    textTransform: 'uppercase',
  },
  topBarBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 6,
  },
  topBarBtnText: {
    fontFamily: F.bodyMed,
    fontSize: 10,
    color: C.iceGlow,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  body: { padding: 16, paddingBottom: 56 },

  // Section headers
  sectionTitle: {
    fontFamily: F.heading,
    fontSize: 13,
    color: C.deepBlue,
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  sectionPill: {
    alignSelf: 'flex-start',
    backgroundColor: C.lockedBg,
    borderWidth: 1,
    borderColor: C.deepBlue,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 2,
    marginBottom: 12,
  },
  sectionPillText: {
    fontFamily: F.body,
    fontSize: 11,
    color: C.iceGlow,
    letterSpacing: 1,
  },

  emptyText: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: C.textMuted,
    letterSpacing: 1.5,
    marginVertical: 12,
    textAlign: 'center',
  },

  // Unassigned student card
  studentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  cardLeft: { flex: 1, gap: 4 },
  cardRight: { alignItems: 'flex-end', gap: 8 },

  studentName: {
    fontFamily: F.body,
    fontSize: 14,
    color: C.text,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  joinDate: {
    fontFamily: F.bodyMed,
    fontSize: 11,
    color: C.textMuted,
    letterSpacing: 1,
  },

  levelBadge: {
    backgroundColor: C.lockedBg,
    borderWidth: 1,
    borderColor: C.deepBlue,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  levelBadgeText: {
    fontFamily: F.heading,
    fontSize: 10,
    color: C.iceGlow,
    letterSpacing: 2,
  },

  assignBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: C.deepBlue,
    borderRadius: 6,
  },
  assignBtnText: {
    fontFamily: F.heading,
    fontSize: 11,
    color: '#fff',
    letterSpacing: 2,
  },

  // Coach block
  coachBlock: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 10,
    marginBottom: 10,
    overflow: 'hidden',
  },
  coachHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  coachHeaderLeft: { gap: 3 },
  coachName: {
    fontFamily: F.heading,
    fontSize: 13,
    color: C.text,
    letterSpacing: 2,
  },
  coachCount: {
    fontFamily: F.bodyMed,
    fontSize: 11,
    color: C.iceGlow,
    letterSpacing: 2,
  },
  chevron: {
    fontFamily: F.body,
    fontSize: 11,
    color: C.textMuted,
  },

  // Coach expanded student rows
  coachStudents: {
    borderTopWidth: 1,
    borderTopColor: C.cardBorder,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rosterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  rosterName: {
    fontFamily: F.body,
    fontSize: 13,
    color: C.text,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  rosterActions: {
    flexDirection: 'row',
    gap: 6,
  },
  rosterBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 5,
  },
  rosterBtnDanger: {
    borderColor: '#3a1a1a',
  },
  rosterBtnText: {
    fontFamily: F.bodyMed,
    fontSize: 9,
    color: C.iceGlow,
    letterSpacing: 1.5,
  },
  rosterBtnTextDanger: {
    color: '#FF6B6B',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  modalBox: {
    width: '100%',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 14,
    padding: 20,
    gap: 12,
  },
  modalTitle: {
    fontFamily: F.heading,
    fontSize: 13,
    color: C.text,
    letterSpacing: 3,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 4,
  },
  coachOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: C.cardBorder,
  },
  coachOptionName: {
    fontFamily: F.body,
    fontSize: 14,
    color: C.text,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  coachOptionCount: {
    fontFamily: F.bodyMed,
    fontSize: 11,
    color: C.textMuted,
    letterSpacing: 1,
  },
  modalCancelBtn: {
    marginTop: 4,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 8,
  },
  modalCancelText: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: C.textMuted,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});
