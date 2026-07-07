import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Modal, Platform, Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useCoach } from '../context/CoachContext';
import { F } from '../constants/fonts';
import { DAY_LABELS } from '../lib/schedule';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import PillButton from '../components/PillButton';
import { CARD_H, CARD_W } from '../constants/layout';

const DOW_FULL = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
// First letter of each weekday for the compact at-a-glance week strip on each card.
const DOW_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

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

// ── Workout TYPE meta ─────────────────────────────────────────────────────────
// Each category gets its own signature glow so the warehouse reads at a glance —
// the rail, type chip, filter pill, section header and week-dots all inherit it.
// `__none` is the catch-all bucket for legacy/untyped workouts.
const CAT_ORDER = ['main', 'side', 'accessory', 'legs', '__none'];
const CAT_META = {
  main:      { label: 'MAIN QUEST',  color: '#4A9EBF' }, // ice
  side:      { label: 'SIDE QUEST',  color: '#A98BE0' }, // violet
  accessory: { label: 'ACCESSORIES', color: '#D9B65A' }, // gold
  legs:      { label: 'LEGS',        color: '#5FC79A' }, // green
  __none:    { label: 'UNTYPED',     color: '#5a7794' }, // muted steel
};
const catKey = (w) => (w?.category && CAT_META[w.category] ? w.category : '__none');
// Translucent fill from a hex accent (6-digit hex + alpha byte).
const tint = (hex, a = '22') => hex + a;

// Compact Sun→Sat strip: lit dots = weekdays this workout repeats on. Reads the
// whole week at a glance, far quicker than a wrapping list of day chips.
function WeekStrip({ days, color = SL.accent }) {
  const set = new Set(days);
  return (
    <View style={styles.weekStrip}>
      {DOW_INITIALS.map((letter, dow) => {
        const on = set.has(dow);
        return (
          <View
            key={dow}
            style={[
              styles.weekDot,
              on && styles.weekDotOn,
              on && { borderColor: color, backgroundColor: tint(color, '22'), shadowColor: color },
            ]}
          >
            <Text style={[styles.weekDotText, on && { color }]}>{letter}</Text>
          </View>
        );
      })}
    </View>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return 'NO DATE';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
}

export default function AllWorkoutsScreen({ navigation }) {
  const { selectedStudent: student } = useCoach();

  const [workouts,     setWorkouts]     = useState([]);
  const [templateRows, setTemplateRows] = useState([]);  // weekly_workout_template rows
  const [loading,      setLoading]      = useState(true);
  const [filter,       setFilter]       = useState('all'); // 'all' | category key

  // Assign-to-days modal
  const [assignWorkout, setAssignWorkout] = useState(null);   // workout being assigned
  const [pickedDays,    setPickedDays]    = useState([]);     // dows 0..6 selected
  const [savingAssign,  setSavingAssign]  = useState(false);

  const fetchWorkouts = useCallback(async () => {
    if (!student) return;
    setLoading(true);
    try {
      const [workoutsRes, templateRes] = await Promise.all([
        supabase
          .from('workouts')
          .select('*, exercises(count)')
          .eq('assigned_to', student.id)
          .order('scheduled_date', { ascending: false }),
        supabase
          .from('weekly_workout_template')
          .select('id, day_of_week, workout_id')
          .eq('student_id', student.id),
      ]);

      if (workoutsRes.error) throw workoutsRes.error;
      if (templateRes.error) throw templateRes.error;
      setWorkouts(workoutsRes.data ?? []);
      setTemplateRows(templateRes.data ?? []);
    } catch (e) {
      console.error('[AllWorkouts] fetch:', e);
      alert('Could not load workouts: ' + e.message);
    }
    setLoading(false);
  }, [student?.id]);

  useEffect(() => { fetchWorkouts(); }, [fetchWorkouts]);

  // Which weekdays (0..6) a given workout is currently on in the weekly plan.
  const daysByWorkout = useMemo(() => {
    const map = {};
    for (const t of templateRows) {
      (map[t.workout_id] ??= []).push(t.day_of_week);
    }
    return map;
  }, [templateRows]);

  // Group workouts by type, in canonical order, plus per-type counts. Empty
  // buckets are dropped so the filter bar only offers types that actually exist.
  const { grouped, counts, availableCats } = useMemo(() => {
    const grouped = {};
    const counts = {};
    for (const w of workouts) {
      const k = catKey(w);
      (grouped[k] ??= []).push(w);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    const availableCats = CAT_ORDER.filter(k => grouped[k]?.length);
    return { grouped, counts, availableCats };
  }, [workouts]);

  // If the active filter's type empties out (e.g. last one deleted), fall back to ALL.
  useEffect(() => {
    if (filter !== 'all' && !availableCats.includes(filter)) setFilter('all');
  }, [filter, availableCats]);

  // Which sections to render: every type when ALL, else just the chosen one.
  const sectionsToRender = filter === 'all' ? availableCats : [filter];
  const visibleCount = sectionsToRender.reduce((n, k) => n + (grouped[k]?.length ?? 0), 0);

  function openAssign(workout) {
    setAssignWorkout(workout);
    setPickedDays(daysByWorkout[workout.id] ?? []);
  }

  function toggleDay(dow) {
    setPickedDays(prev => prev.includes(dow) ? prev.filter(d => d !== dow) : [...prev, dow]);
  }

  // Save the day selection: insert newly-checked days, delete unchecked ones.
  async function saveAssign() {
    if (!assignWorkout) return;
    setSavingAssign(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const before = daysByWorkout[assignWorkout.id] ?? [];
      const toAdd    = pickedDays.filter(d => !before.includes(d));
      const toRemove = before.filter(d => !pickedDays.includes(d));

      if (toAdd.length) {
        const rows = toAdd.map(day_of_week => ({
          student_id:  student.id,
          coach_id:    user.id,
          day_of_week,
          workout_id:  assignWorkout.id,
        }));
        const { error } = await supabase.from('weekly_workout_template').insert(rows);
        if (error) throw error;
      }
      if (toRemove.length) {
        const { error } = await supabase
          .from('weekly_workout_template')
          .delete()
          .eq('student_id', student.id)
          .eq('workout_id', assignWorkout.id)
          .in('day_of_week', toRemove);
        if (error) throw error;
      }
      setAssignWorkout(null);
      await fetchWorkouts();
    } catch (e) {
      alert('Save failed: ' + (e.message ?? 'Something went wrong.'));
    }
    setSavingAssign(false);
  }

  // Cross-platform confirm — window.confirm only exists on web; the APK build
  // needs Alert.alert or the delete button would crash the screen.
  const handleDelete = (workoutId) => {
    const doDelete = async () => {
      const { error } = await supabase
        .from('workouts')
        .delete()
        .eq('id', workoutId);
      if (error) { alert('Error: ' + error.message); return; }
      setWorkouts(prev => prev.filter(w => w.id !== workoutId));
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Delete this workout?')) doDelete();
    } else {
      Alert.alert('Delete workout', 'Delete this workout?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  function renderWorkout(item) {
    const meta = CAT_META[catKey(item)];
    const assignedDays = (daysByWorkout[item.id] ?? []).slice().sort((a, b) => a - b);
    const inPlan = assignedDays.length > 0;
    const exCount = item.exercises?.[0]?.count ?? 0;

    return (
      <TouchableOpacity
        key={item.id}
        style={[
          styles.card,
          inPlan && styles.cardActive,
          inPlan && { borderColor: tint(meta.color, '99'), shadowColor: meta.color },
        ]}
        onPress={() => navigation.navigate('WorkoutDetail', { workout: item })}
        activeOpacity={0.85}
      >
        {/* Left accent rail, tinted by TYPE; it ignites (glows) when this
            workout lives in the weekly plan, so scheduled vs. shelved reads
            instantly while scanning the list. */}
        <View
          style={[
            styles.rail,
            { backgroundColor: meta.color, opacity: inPlan ? 1 : 0.5 },
            inPlan && { shadowColor: meta.color, shadowOpacity: 0.9, shadowRadius: 9 },
          ]}
          pointerEvents="none"
        />

        <View style={styles.cardBody}>
          {/* Top row: title + type chip on the left, delete on the right */}
          <View style={styles.cardTop}>
            <View style={styles.titleCol}>
              <Text style={styles.cardTitle} numberOfLines={1}>{item.title?.toUpperCase()}</Text>
              <View style={[styles.typeChip, { borderColor: meta.color, backgroundColor: tint(meta.color, '1c') }]}>
                <View style={[styles.typeDot, { backgroundColor: meta.color }]} />
                <Text style={[styles.typeChipText, { color: meta.color }]}>{meta.label}</Text>
              </View>
            </View>
            <PillButton label="DELETE" tone="danger" size="md" onPress={() => handleDelete(item.id)} />
          </View>

          {/* Stat line: exercise count + (optional) scheduled date */}
          <View style={styles.statRow}>
            <Text style={[styles.statNum, { color: meta.color }]}>{exCount}</Text>
            <Text style={styles.statLabel}>{exCount === 1 ? 'EXERCISE' : 'EXERCISES'}</Text>
            {item.scheduled_date ? (
              <>
                <View style={styles.statDivider} />
                <Text style={styles.statDate}>{formatDate(item.scheduled_date)}</Text>
              </>
            ) : null}
          </View>

          {/* Purpose */}
          {item.purpose ? (
            <Text style={styles.cardPurpose} numberOfLines={2}>{item.purpose}</Text>
          ) : null}

          {/* Weekly-plan assignment */}
          <View style={styles.assignRow}>
            <View style={styles.planBlock}>
              <Text style={[styles.planLabel, inPlan && { color: meta.color }]}>
                {inPlan ? 'WEEKLY PLAN' : 'NOT SCHEDULED'}
              </Text>
              <WeekStrip days={assignedDays} color={meta.color} />
            </View>
            <PillButton
              label={inPlan ? 'EDIT DAYS' : 'ASSIGN'}
              variant={inPlan ? 'outline' : 'solid'}
              size="md"
              onPress={() => openAssign(item)}
            />
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  if (!student) {
    return (
      <ScreenFrame maxWidth={CARD_W}>
        <View style={{ paddingVertical: 120, alignItems: 'center', gap: 16 }}>
          <Text style={styles.emptyText}>NO STUDENT SELECTED</Text>
          <PillButton label="← GO BACK" onPress={() => navigation.goBack()} />
        </View>
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame maxWidth={CARD_W} ready={!loading}>
      <View style={styles.cardFrame}>
      <ScreenHeader
        title="MY WORKOUTS"
        subtitle={student.full_name}
        onBack={() => navigation.goBack()}
        right={!loading && workouts.length > 0 ? (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeNum}>{workouts.length}</Text>
            <Text style={styles.countBadgeLabel}>SAVED</Text>
          </View>
        ) : null}
      />

      {/* ── Type filter bar ── only meaningful with >1 type present ── */}
      {!loading && availableCats.length > 1 && (
        <View style={styles.filterWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            <FilterChip
              active={filter === 'all'}
              color={SL.accent}
              label="ALL"
              count={workouts.length}
              onPress={() => setFilter('all')}
            />
            {availableCats.map(k => (
              <FilterChip
                key={k}
                active={filter === k}
                color={CAT_META[k].color}
                label={CAT_META[k].label}
                count={counts[k]}
                onPress={() => setFilter(k)}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Fills the remaining fixed-card height; overflow scrolls internally. */}
      <View style={styles.listArea}>
        {loading ? (
          <View style={styles.areaCenter}>
            <ActivityIndicator color={SL.accent} size="large" />
          </View>
        ) : workouts.length === 0 ? (
          <View style={styles.areaCenter}>
            <Text style={styles.emptyText}>NO WORKOUTS YET</Text>
            <Text style={styles.emptySub}>Create one, or import an elite workout from the gallery.</Text>
          </View>
        ) : visibleCount === 0 ? (
          <View style={styles.areaCenter}>
            <Text style={styles.emptyText}>NOTHING HERE</Text>
            <Text style={styles.emptySub}>No workouts of this type yet.</Text>
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {sectionsToRender.map(k => {
              const items = grouped[k] ?? [];
              if (!items.length) return null;
              const meta = CAT_META[k];
              return (
                <View key={k} style={styles.section}>
                  {/* Section header — a colored type banner that organizes the warehouse */}
                  <View style={styles.sectionHead}>
                    <View style={[styles.sectionDot, { backgroundColor: meta.color, shadowColor: meta.color }]} />
                    <Text style={[styles.sectionTitle, { color: meta.color }]}>{meta.label}</Text>
                    <View style={[styles.sectionRule, { backgroundColor: tint(meta.color, '55') }]} />
                    <Text style={[styles.sectionCount, { color: meta.color, borderColor: tint(meta.color, '66') }]}>
                      {items.length}
                    </Text>
                  </View>
                  {items.map(renderWorkout)}
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
      </View>

      {/* ── Assign-to-days Modal ── */}
      <Modal
        visible={!!assignWorkout}
        transparent
        animationType="fade"
        onRequestClose={() => setAssignWorkout(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.assignBox}>
            <Text style={styles.assignBoxTitle}>{assignWorkout?.title?.toUpperCase()}</Text>
            <Text style={styles.assignBoxSub}>
              Pick the weekday(s) this repeats on, every week.
            </Text>

            <View style={styles.dayPickerGrid}>
              {DAY_LABELS.map((label, dow) => {
                const on = pickedDays.includes(dow);
                return (
                  <TouchableOpacity
                    key={label}
                    style={[styles.dayPick, on && styles.dayPickOn]}
                    onPress={() => toggleDay(dow)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.dayPickText, on && styles.dayPickTextOn]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.assignButtons}>
              <PillButton
                label="CANCEL"
                tone="muted"
                onPress={() => setAssignWorkout(null)}
                disabled={savingAssign}
                style={{ flex: 1 }}
              />
              <PillButton
                label="SAVE"
                variant="solid"
                onPress={saveAssign}
                loading={savingAssign}
                style={{ flex: 2 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </ScreenFrame>
  );
}

// ── Type filter pill ──────────────────────────────────────────────────────────
function FilterChip({ active, color, label, count, onPress }) {
  return (
    <TouchableOpacity
      style={[
        styles.filterChip,
        active && { borderColor: color, backgroundColor: tint(color, '22'), shadowColor: color },
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={[styles.filterDot, { backgroundColor: color, opacity: active ? 1 : 0.45 }]} />
      <Text style={[styles.filterChipText, active && { color }]}>{label}</Text>
      <Text style={[styles.filterChipCount, active && { color }]}>{count}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // ── Header workout counter ────────────────────────────────────────────────
  countBadge: { alignItems: 'flex-end' },
  countBadgeNum: {
    fontFamily: F.heading,
    fontSize: 26,
    color: SL.accent,
    letterSpacing: 1,
    textShadowColor: 'rgba(74,158,191,0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
  countBadgeLabel: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: SL.muted,
    letterSpacing: 2,
    marginTop: -2,
  },

  // Fixed card height so the frame is the same size regardless of data.
  cardFrame: { height: CARD_H },

  // ── Type filter bar ───────────────────────────────────────────────────────
  filterWrap: {
    borderBottomWidth: 1,
    borderBottomColor: SL.border,
    paddingBottom: 12,
    marginBottom: 2,
  },
  filterRow: { paddingHorizontal: 16, gap: 8, flexDirection: 'row' },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: SL.border,
    backgroundColor: SL.panel,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 9,
  },
  filterDot: { width: 8, height: 8, borderRadius: 999 },
  filterChipText: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 1.5,
  },
  filterChipCount: {
    fontFamily: F.heading,
    fontSize: 17,
    color: SL.muted,
    letterSpacing: 0.5,
  },

  // Fills the remaining card height; long lists scroll inside it.
  listArea: { flex: 1 },
  areaCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  // Inner content padding — the ScreenFrame provides the glowing outer frame now.
  list: {
    padding: 16,
    paddingBottom: 40,
  },

  // ── Type section ──────────────────────────────────────────────────────────
  section: { marginBottom: 22 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  sectionDot: {
    width: 10, height: 10, borderRadius: 999,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 7,
  },
  sectionTitle: {
    fontFamily: F.heading,
    fontSize: 17,
    letterSpacing: 3,
  },
  sectionRule: { flex: 1, height: 1, borderRadius: 1 },
  sectionCount: {
    fontFamily: F.heading,
    fontSize: 14,
    letterSpacing: 0.5,
    minWidth: 26,
    textAlign: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 1,
    paddingHorizontal: 6,
    overflow: 'hidden',
  },

  card: {
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 14,
    // Soft ice-glow frame, matching the Home / Skills cards.
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.10,
    shadowRadius: 12,
  },
  // Scheduled workouts pop a little more — brighter border + stronger glow
  // (tinted by the workout's type, applied inline).
  cardActive: {
    shadowOpacity: 0.30,
    shadowRadius: 18,
  },
  // Left status rail. Tinted by type; ignites when in the weekly plan.
  rail: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    width: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  cardBody: {
    paddingVertical: 18,
    paddingLeft: 22,
    paddingRight: 18,
    gap: 10,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleCol: { flex: 1, gap: 8 },
  cardTitle: {
    fontFamily: F.heading,
    fontSize: 28,
    color: SL.text,
    letterSpacing: 2,
  },
  // ── Type chip (under the title) ───────────────────────────────────────────
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  typeDot: { width: 6, height: 6, borderRadius: 999 },
  typeChipText: {
    fontFamily: F.bodyMed,
    fontSize: 12.5,
    letterSpacing: 2,
  },
  // ── Stat line (exercise count + scheduled date) ───────────────────────────
  statRow: { flexDirection: 'row', alignItems: 'center' },
  statNum: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.accent,
    letterSpacing: 1,
  },
  statLabel: {
    fontFamily: F.bodyMed,
    fontSize: 15,
    color: SL.muted,
    letterSpacing: 1.5,
    marginLeft: 6,
  },
  statDivider: {
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: SL.muted,
    marginHorizontal: 12,
  },
  statDate: {
    fontFamily: F.bodyMed,
    fontSize: 15,
    color: SL.accent,
    letterSpacing: 1.5,
  },
  cardPurpose: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 0.5,
    lineHeight: 24,
  },
  // ── Weekly-plan assignment (card) ─────────────────────────────────────────
  assignRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 4,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: SL.border,
  },
  planBlock: { gap: 8, flex: 1 },
  planLabel: {
    fontFamily: F.bodyMed,
    fontSize: 13,
    color: SL.muted,
    letterSpacing: 2.5,
  },
  // Compact Sun→Sat week strip dots.
  weekStrip: { flexDirection: 'row', gap: 6 },
  weekDot: {
    width: 28, height: 28, borderRadius: 999,
    borderWidth: 1,
    borderColor: SL.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  weekDotOn: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
  },
  weekDotText: {
    fontFamily: F.body,
    fontSize: 13,
    color: SL.muted,
    letterSpacing: 0.5,
  },

  // ── Assign-to-days Modal ──────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  assignBox: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 18,
    padding: 24,
    paddingBottom: 28,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
  },
  assignBoxTitle: {
    fontFamily: F.heading,
    fontSize: 26,
    color: SL.accent,
    letterSpacing: 3,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  assignBoxSub: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 0.5,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  dayPickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 24,
  },
  dayPick: {
    width: 64,
    height: 56,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: SL.bg,
  },
  dayPickOn: {
    borderColor: SL.accent,
    backgroundColor: 'rgba(74,158,191,0.16)',
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
  },
  dayPickText: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 1,
  },
  dayPickTextOn: { color: SL.accent },
  assignButtons: { flexDirection: 'row', gap: 10 },

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
});
