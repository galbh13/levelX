import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';

const SL = {
  bg:        '#050912',
  panel:     '#070d1a',
  panelAlt:  '#0a1424',
  border:    '#1a3a5c',
  accent:    '#4A9EBF',
  text:      '#E8F4FF',
  muted:     '#4a6a8a',
  gold:      '#FFD700',
  danger:    '#FF6B6B',
  dangerBg:  '#2a1414',
};

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
        <TouchableOpacity style={styles.assignBtn} onPress={() => onAssign(student)} activeOpacity={0.8}>
          <Text style={styles.assignBtnText}>ASSIGN</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function CoachBlock({ coach, students, onReassign, onRemove }) {
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
                    activeOpacity={0.8}
                  >
                    <Text style={styles.rosterBtnText}>REASSIGN</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.rosterBtn, styles.rosterBtnDanger]}
                    onPress={() => onRemove(student)}
                    activeOpacity={0.8}
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
          <ScrollView style={{ maxHeight: 360 }}>
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
          <TouchableOpacity style={styles.modalCancelBtn} onPress={onClose} activeOpacity={0.8}>
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
  const [students,    setStudents]    = useState([]);
  const [coaches,     setCoaches]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);

  const [modalVisible,   setModalVisible]   = useState(false);
  const [targetStudent,  setTargetStudent]  = useState(null);
  const [excludeCoach,   setExcludeCoach]   = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const { data: unassignedData } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'student')
        .is('coach_id', null);

      const { data: allStudentData } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'student');

      const { data: coachData } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'coach');

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
      const { error } = await supabase
        .from('profiles')
        .update({ coach_id: coach.id })
        .eq('id', student.id);
      if (error) {
        Alert.alert('Assignment Failed', error.message ?? 'Could not assign coach.');
        return;
      }
      await fetchData();
    } catch (e) {
      Alert.alert('Assignment Failed', e.message ?? 'Something went wrong.');
    }
  }

  async function handleRemove(student) {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ coach_id: null })
        .eq('id', student.id);
      if (error) {
        Alert.alert('Remove Failed', error.message ?? 'Could not remove coach assignment.');
        return;
      }
      await fetchData();
    } catch (e) {
      Alert.alert('Remove Failed', e.message ?? 'Something went wrong.');
    }
  }

  return (
    <View style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.topBarBtn}
          onPress={() => navigation.navigate('ExerciseGallery')}
          activeOpacity={0.8}
        >
          <Text style={styles.topBarBtnText}>GALLERY</Text>
        </TouchableOpacity>

        <Text style={styles.pageTitle}>ADMIN</Text>

        <TouchableOpacity
          style={styles.topBarBtn}
          onPress={() => supabase.auth.signOut()}
          activeOpacity={0.8}
        >
          <Text style={styles.topBarBtnText}>SIGN OUT</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={SL.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={SL.accent} />}
        >
          {/* ── Section 1: Unassigned ── */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>UNASSIGNED STUDENTS</Text>
            <View style={styles.sectionPill}>
              <Text style={styles.sectionPillText}>{unassigned.length}</Text>
            </View>
          </View>

          {unassigned.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>All students are assigned.</Text>
            </View>
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
          <View style={[styles.sectionHeader, { marginTop: 36 }]}>
            <Text style={styles.sectionTitle}>COACHING ROSTER</Text>
            <View style={styles.sectionPill}>
              <Text style={styles.sectionPillText}>{coaches.length}</Text>
            </View>
          </View>

          {coaches.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>No coaches found.</Text>
            </View>
          ) : (
            coaches.map(coach => (
              <CoachBlock
                key={coach.id}
                coach={coach}
                students={students}
                onReassign={openReassign}
                onRemove={handleRemove}
              />
            ))
          )}

          <View style={{ height: 60 }} />
        </ScrollView>
      )}

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
  container: { flex: 1, backgroundColor: SL.bg },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: 72,
    paddingBottom: 28,
    borderBottomWidth: 2,
    borderBottomColor: SL.border,
  },
  pageTitle: {
    fontFamily: F.heading,
    fontSize: 56,
    color: SL.accent,
    letterSpacing: 10,
    textTransform: 'uppercase',
  },
  topBarBtn: {
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderWidth: 2,
    borderColor: SL.border,
    borderRadius: 4,
    backgroundColor: SL.panel,
  },
  topBarBtnText: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.accent,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },

  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  body: { padding: 28, paddingTop: 36 },

  // Section headers
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 22,
  },
  sectionTitle: {
    fontFamily: F.heading,
    fontSize: 30,
    color: SL.text,
    letterSpacing: 5,
    textTransform: 'uppercase',
  },
  sectionPill: {
    backgroundColor: SL.panel,
    borderWidth: 2,
    borderColor: SL.accent,
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 4,
    minWidth: 50,
    alignItems: 'center',
  },
  sectionPillText: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.accent,
    letterSpacing: 1,
  },

  emptyBox: {
    backgroundColor: SL.panel,
    borderWidth: 2,
    borderColor: SL.border,
    borderRadius: 4,
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.muted,
    letterSpacing: 2,
    textAlign: 'center',
  },

  // Unassigned student card
  studentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: SL.panel,
    borderWidth: 2,
    borderColor: SL.border,
    borderRadius: 4,
    padding: 22,
    marginBottom: 14,
  },
  cardLeft: { flex: 1, gap: 6 },
  cardRight: { alignItems: 'flex-end', gap: 14 },

  studentName: {
    fontFamily: F.heading,
    fontSize: 26,
    color: SL.text,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  joinDate: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 1.5,
  },

  levelBadge: {
    backgroundColor: SL.panelAlt,
    borderWidth: 2,
    borderColor: SL.accent,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  levelBadgeText: {
    fontFamily: F.heading,
    fontSize: 17,
    color: SL.accent,
    letterSpacing: 2,
  },

  assignBtn: {
    paddingHorizontal: 26,
    paddingVertical: 13,
    backgroundColor: SL.accent,
    borderRadius: 4,
  },
  assignBtnText: {
    fontFamily: F.heading,
    fontSize: 17,
    color: SL.bg,
    letterSpacing: 3,
  },

  // Coach block
  coachBlock: {
    backgroundColor: SL.panel,
    borderWidth: 2,
    borderColor: SL.border,
    borderRadius: 4,
    marginBottom: 16,
    overflow: 'hidden',
  },
  coachHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 26,
  },
  coachHeaderLeft: { gap: 8 },
  coachName: {
    fontFamily: F.heading,
    fontSize: 30,
    color: SL.text,
    letterSpacing: 4,
  },
  coachCount: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.accent,
    letterSpacing: 3,
  },
  chevron: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.accent,
  },

  // Coach expanded student rows
  coachStudents: {
    borderTopWidth: 2,
    borderTopColor: SL.border,
    paddingHorizontal: 22,
    paddingVertical: 18,
    gap: 16,
    backgroundColor: SL.panelAlt,
  },
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rosterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  rosterName: {
    fontFamily: F.heading,
    fontSize: 20,
    color: SL.text,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  rosterActions: {
    flexDirection: 'row',
    gap: 10,
  },
  rosterBtn: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderWidth: 2,
    borderColor: SL.border,
    borderRadius: 4,
    backgroundColor: SL.panel,
  },
  rosterBtnDanger: {
    borderColor: SL.danger,
    backgroundColor: SL.dangerBg,
  },
  rosterBtnText: {
    fontFamily: F.heading,
    fontSize: 15,
    color: SL.accent,
    letterSpacing: 2,
  },
  rosterBtnTextDanger: {
    color: SL.danger,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  modalBox: {
    width: '100%',
    maxWidth: 560,
    backgroundColor: SL.panel,
    borderWidth: 2,
    borderColor: SL.accent,
    borderRadius: 4,
    padding: 28,
    gap: 18,
  },
  modalTitle: {
    fontFamily: F.heading,
    fontSize: 28,
    color: SL.accent,
    letterSpacing: 5,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 8,
  },
  coachOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 20,
    paddingHorizontal: 8,
    borderBottomWidth: 1.5,
    borderBottomColor: SL.border,
  },
  coachOptionName: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.text,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  coachOptionCount: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 1.5,
  },
  modalCancelBtn: {
    marginTop: 8,
    paddingVertical: 18,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: SL.border,
    borderRadius: 4,
    backgroundColor: SL.panelAlt,
  },
  modalCancelText: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
});
