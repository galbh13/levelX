import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Modal,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useCoach } from '../context/CoachContext';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { getWeekDays, TODAY_STR } from '../lib/schedule';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import PillButton from '../components/PillButton';
import { CARD_H, CARD_W } from '../constants/layout';
import { categoryMeta } from '../lib/workouts';

// Local theme — built on the shared palette (C) plus the gold/green tones the
// PillButton uses, so the accessories card matches every other player screen.
const T = {
  bg:     C.bg,
  panel:  '#070d1a',
  border: '#1a3a5c',
  accent: C.deepBlue,
  text:   C.text,
  muted:  '#4a6a8a',
  green:  '#4CAF50',
  gold:   '#FFD700',
  danger: '#FF4444',
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtDay = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;

const DAY_LABELS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const DOW_FULL   = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
const TODAY_DOW  = new Date().getDay(); // 0=Sun … 6=Sat

// ─── A single tappable progress cell ────────────────────────────────────────────
// Filled when its index is below the current count. Cells past the weekly target
// are "bonus" reps and glow gold instead of ice-blue.
function RepCell({ index, count, target, onPress }) {
  const filled = index < count;
  const bonus  = index >= target;
  const tone   = bonus ? T.gold : T.accent;
  return (
    <Pressable onPress={() => onPress(index)} hitSlop={6} style={styles.cellHit}>
      <View
        style={[
          styles.cell,
          filled
            ? { backgroundColor: tone, borderColor: tone, shadowColor: tone }
            : { backgroundColor: 'transparent', borderColor: T.border },
        ]}
      >
        {filled ? <Text style={[styles.cellTick, bonus && { color: '#1a1200' }]}>✓</Text> : null}
      </View>
    </Pressable>
  );
}

// ─── Screen ─────────────────────────────────────────────────────────────────────
// "Weekly Accessories" — a self-managed list of extra accessory/legs movements the
// player hits a target number of times per week, performed whenever (off the dated
// program, so they don't add to managed fatigue). Tap the rep cells to log each
// time you do one; progress is counted within the current Sun–Sat week and resets
// automatically next week (older completions just become history).
//
// Scoped to the CoachContext player (`selectedStudent`) — same as the Manage hub
// it's launched from, so an admin acting as coach manages that player's list.
export default function WeeklyAccessoriesScreen({ navigation }) {
  const { selectedStudent: student } = useCoach();

  const [items,       setItems]       = useState([]);             // weekly_accessories rows
  const [completions, setCompletions] = useState({});            // { [accessoryId]: [{id}] } this week
  const [workouts,    setWorkouts]    = useState([]);            // the player's own workouts (picker source)
  const [templateRows, setTemplateRows] = useState([]);         // weekly_workout_template rows (the routine)
  const [loading,     setLoading]     = useState(true);
  const [selectedDow, setSelectedDow] = useState(TODAY_DOW);    // ruler-selected weekday

  // Add / edit modal
  const [modalOpen,  setModalOpen]  = useState(false);
  const [editing,    setEditing]    = useState(null);           // row being edited, or null = new
  const [pickedWk,   setPickedWk]   = useState(null);           // chosen workout {id,title,category}
  const [draftTgt,   setDraftTgt]   = useState(3);
  const [saving,     setSaving]     = useState(false);

  // Workouts already linked to an active accessory — disabled in the picker so
  // the same workout isn't added twice (the one being edited stays selectable).
  const usedWorkoutIds = useMemo(
    () => new Set(items.filter(i => i.id !== editing?.id).map(i => i.workout_id).filter(Boolean)),
    [items, editing],
  );

  // The current week's Sun…Sat boundaries (matches the Workouts week ruler).
  const week = useMemo(() => getWeekDays(0), []);
  const weekStart = week[0];
  const weekEnd   = week[6];

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!student?.id) return;
    const [listRes, compRes, wkRes, tmplRes] = await Promise.all([
      supabase
        .from('weekly_accessories')
        .select('id, name, target_per_week, workout_id')
        .eq('student_id', student.id)
        .eq('active', true)
        .order('created_at', { ascending: true }),
      supabase
        .from('accessory_completions')
        .select('id, accessory_id')
        .eq('student_id', student.id)
        .gte('completion_date', weekStart.dateStr)
        .lte('completion_date', weekEnd.dateStr),
      supabase
        .from('workouts')
        .select('id, title, category, purpose')
        .eq('assigned_to', student.id)
        .order('title', { ascending: true }),
      supabase
        .from('weekly_workout_template')
        .select('id, day_of_week, workout_id')
        .eq('student_id', student.id),
    ]);

    if (listRes.error) { console.error('[Accessories] list:', listRes.error); return; }
    if (compRes.error) { console.error('[Accessories] completions:', compRes.error); return; }
    if (wkRes.error)   { console.error('[Accessories] workouts:', wkRes.error); }
    if (tmplRes.error) { console.error('[Accessories] template:', tmplRes.error); }

    const grouped = {};
    for (const row of compRes.data ?? []) {
      (grouped[row.accessory_id] ??= []).push({ id: row.id });
    }
    setItems(listRes.data ?? []);
    setCompletions(grouped);
    setWorkouts(wkRes.data ?? []);
    setTemplateRows(tmplRes.data ?? []);
  }, [student?.id, weekStart.dateStr, weekEnd.dateStr]);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  // ── Log / unlog completions ──────────────────────────────────────────────────
  // Set this week's count for an accessory to `desired` by inserting or deleting
  // completion rows (dated today) to match — a tap drives the count up or down.
  async function setWeekCount(item, desired) {
    const cur = completions[item.id] ?? [];
    if (desired === cur.length || desired < 0) return;

    if (desired > cur.length) {
      const rows = Array.from({ length: desired - cur.length }, () => ({
        accessory_id: item.id, student_id: student.id, completion_date: TODAY_STR,
      }));
      // Optimistic, then reconcile ids from the insert.
      setCompletions(p => ({ ...p, [item.id]: [...cur, ...rows.map(() => ({ id: 'tmp' }))] }));
      const { data, error } = await supabase
        .from('accessory_completions').insert(rows).select('id');
      if (error) { alert('Error: ' + error.message); fetchData(); return; }
      setCompletions(p => ({ ...p, [item.id]: [...cur, ...(data ?? [])] }));
    } else {
      const removeIds = cur.slice(desired).map(r => r.id).filter(id => id !== 'tmp');
      setCompletions(p => ({ ...p, [item.id]: cur.slice(0, desired) }));
      if (removeIds.length) {
        const { error } = await supabase
          .from('accessory_completions').delete().in('id', removeIds);
        if (error) { alert('Error: ' + error.message); fetchData(); }
      }
    }
  }

  // Tapping cell i: fill up to & including it (i+1) if it's empty, or clear back to
  // it (i) if it's already filled — a forgiving progress-bar tap.
  const onCellPress = (item, i) => {
    const count = (completions[item.id] ?? []).length;
    setWeekCount(item, i < count ? i : i + 1);
  };

  // Quick lookup of a workout by id, for the type chip on each accessory card.
  const workoutById = useMemo(() => {
    const m = {};
    for (const w of workouts) m[w.id] = w;
    return m;
  }, [workouts]);

  // Only ACCESSORIES / LEGS workouts are eligible — these are the off-program
  // extra-work types. Main/side quests are the dated program and excluded here.
  const pickerWorkouts = useMemo(
    () => workouts.filter(w => w.category === 'accessory' || w.category === 'legs'),
    [workouts],
  );

  // Which weekdays (0..6) each workout is scheduled on in the weekly routine.
  const dowsByWorkout = useMemo(() => {
    const m = {};
    for (const t of templateRows) (m[t.workout_id] ??= []).push(t.day_of_week);
    return m;
  }, [templateRows]);

  // Accessories scheduled on a given weekday (for the ruler dots).
  const accessoriesOnDow = useCallback(
    (dow) => items.filter(it => it.workout_id && (dowsByWorkout[it.workout_id] ?? []).includes(dow)),
    [items, dowsByWorkout],
  );

  // Toggle an accessory onto / off a weekday of the player's REAL routine
  // (weekly_workout_template) — the same schedule Home & Workouts read. Optional:
  // most accessories stay ad-hoc; this just pins one to a day when wanted.
  async function toggleSchedule(item, dow) {
    if (!item.workout_id) { alert('Re-pick this accessory from My Workouts to schedule it.'); return; }
    const on = (dowsByWorkout[item.workout_id] ?? []).includes(dow);
    if (on) {
      setTemplateRows(prev => prev.filter(t => !(t.workout_id === item.workout_id && t.day_of_week === dow)));
      const { error } = await supabase
        .from('weekly_workout_template')
        .delete()
        .eq('student_id', student.id)
        .eq('workout_id', item.workout_id)
        .eq('day_of_week', dow);
      if (error) { alert('Error: ' + error.message); fetchData(); }
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const row = { student_id: student.id, coach_id: user.id, day_of_week: dow, workout_id: item.workout_id };
      setTemplateRows(prev => [...prev, { ...row, id: `tmp-${dow}` }]);
      const { data, error } = await supabase
        .from('weekly_workout_template')
        .insert(row)
        .select('id, day_of_week, workout_id')
        .single();
      if (error) { alert('Error: ' + error.message); fetchData(); return; }
      setTemplateRows(prev => prev.map(t =>
        (t.id === `tmp-${dow}` && t.workout_id === item.workout_id) ? data : t));
    }
  }

  // ── Add / edit / delete an accessory ──────────────────────────────────────────
  const openNew  = () => { setEditing(null); setPickedWk(null); setDraftTgt(3); setModalOpen(true); };
  const openEdit = (item) => {
    setEditing(item);
    setPickedWk(workoutById[item.workout_id] ?? null);
    setDraftTgt(item.target_per_week);
    setModalOpen(true);
  };

  async function saveDraft() {
    // Name comes from the chosen workout's title (kept ≤80 for the CHECK). When
    // editing without re-picking, fall back to the existing values.
    const name       = (pickedWk ? pickedWk.title : editing?.name ?? '').slice(0, 80);
    const workout_id = pickedWk ? pickedWk.id : (editing?.workout_id ?? null);
    if (!name) return;
    setSaving(true);
    if (editing) {
      const { error } = await supabase
        .from('weekly_accessories')
        .update({ name, target_per_week: draftTgt, workout_id })
        .eq('id', editing.id);
      if (error) { alert('Error: ' + error.message); setSaving(false); return; }
    } else {
      const { error } = await supabase
        .from('weekly_accessories')
        .insert({ student_id: student.id, name, target_per_week: draftTgt, workout_id });
      if (error) { alert('Error: ' + error.message); setSaving(false); return; }
    }
    setSaving(false);
    setModalOpen(false);
    await fetchData();
  }

  async function deleteItem(item) {
    // Soft-delete so completion history survives, mirroring daily_quests.
    setItems(p => p.filter(i => i.id !== item.id));
    const { error } = await supabase
      .from('weekly_accessories').update({ active: false }).eq('id', item.id);
    if (error) { alert('Error: ' + error.message); fetchData(); }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <ScreenFrame maxWidth={CARD_W} ready={!loading}>
      <View style={styles.card}>
        <ScreenHeader
          title="ACCESSORIES"
          subtitle={`${fmtDay(weekStart.date)} – ${fmtDay(weekEnd.date)}`}
          onBack={() => navigation.goBack()}
          right={<PillButton label="+ NEW" size="sm" variant="solid" onPress={openNew} />}
        />

        <View style={styles.body}>
          {loading ? (
            <View style={styles.center}><ActivityIndicator color={T.accent} /></View>
          ) : items.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>NO ACCESSORIES YET</Text>
              <Text style={styles.emptySub}>
                Add the accessory or legs movements you want to hit each week.
              </Text>
              <PillButton label="+ ADD ONE" variant="solid" onPress={openNew} style={{ marginTop: 18 }} />
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollInner}
              showsVerticalScrollIndicator={false}
            >
              {items.map(item => {
                const count  = (completions[item.id] ?? []).length;
                const target = item.target_per_week;
                const done   = count >= target;
                const cells  = Math.max(target, count);
                const meta   = categoryMeta(item.workout_id ? workoutById[item.workout_id]?.category : null);
                const dows   = item.workout_id ? (dowsByWorkout[item.workout_id] ?? []) : [];
                return (
                  <View key={item.id} style={[styles.itemCard, { shadowColor: done ? T.green : meta.color }, done && styles.itemCardDone]}>
                    {/* type-colored rail anchors the card */}
                    <View style={[styles.itemRail, { backgroundColor: done ? T.green : meta.color }]} />

                    <View style={styles.itemContent}>
                      {/* Header — title + type chip on top; progress on the right */}
                      <View style={styles.itemHead}>
                        <View style={styles.itemTitleRow}>
                          <Text style={styles.itemName} numberOfLines={2}>{item.name.toUpperCase()}</Text>
                          <View style={[styles.typeChip, { borderColor: meta.color, backgroundColor: meta.color + '1c' }]}>
                            <View style={[styles.typeDot, { backgroundColor: meta.color }]} />
                            <Text style={[styles.typeChipText, { color: meta.color }]}>{meta.l}</Text>
                          </View>
                        </View>
                        <View style={styles.itemActions}>
                          <Text style={[styles.progressNum, done && { color: T.green }]}>
                            {count}<Text style={styles.progressDen}>/{target}</Text>
                          </Text>
                          {done ? (
                            <Text style={[styles.progressLabel, { color: T.green }]}>✓ DONE</Text>
                          ) : null}
                        </View>
                      </View>

                      {/* One row: rep log + routine circles + EDIT/REMOVE */}
                      <View style={styles.midRow}>
                        <View style={styles.repSection}>
                          <View style={styles.cellRow}>
                            {Array.from({ length: cells }, (_, i) => (
                              <RepCell key={i} index={i} count={count} target={target}
                                onPress={(idx) => onCellPress(item, idx)} />
                            ))}
                          </View>
                        </View>

                        {item.workout_id ? (
                          <View style={styles.routineSection}>
                            <View style={styles.schedDays}>
                              {DAY_LABELS.map((label, dow) => {
                                const on = dows.includes(dow);
                                return (
                                  <Pressable
                                    key={dow}
                                    onPress={() => toggleSchedule(item, dow)}
                                    hitSlop={4}
                                    style={[
                                      styles.schedDay,
                                      on && { borderColor: meta.color, backgroundColor: meta.color + '22', shadowColor: meta.color },
                                    ]}
                                  >
                                    <Text style={[styles.schedDayText, on && { color: meta.color }]}>{label[0]}</Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          </View>
                        ) : null}

                        <View style={styles.midActions}>
                          <PillButton label="EDIT" size="sm" tone="muted"
                            onPress={() => openEdit(item)} />
                          <PillButton label="REMOVE" size="sm" tone="danger" variant="outline"
                            onPress={() => deleteItem(item)} />
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })}
              <View style={{ height: 8 }} />
            </ScrollView>
          )}

          {/* ── Lower widget — copied from the Training Forge skeleton:
              weekly ruler + selected-day panel below it. Dots mark days an
              accessory is pinned to the real routine (colored by type). ── */}
          {!loading && (
            <>
              <View style={styles.weekGrid}>
                {DAY_LABELS.map((label, dow) => {
                  const dayAcc     = accessoriesOnDow(dow);
                  const isToday    = dow === TODAY_DOW;
                  const isSelected = dow === selectedDow;
                  return (
                    <Pressable
                      key={label}
                      style={[
                        styles.dayNode,
                        isToday && !isSelected && styles.dayNodeToday,
                        isSelected && styles.dayNodeSelected,
                      ]}
                      onPress={() => setSelectedDow(dow)}
                    >
                      <Text style={[styles.dayLabel, (isSelected || isToday) && styles.dayLabelSel]}>{label}</Text>
                      {dayAcc.length > 0 ? (
                        <View style={styles.dotsRow}>
                          {dayAcc.map(a => {
                            const meta = categoryMeta(workoutById[a.workout_id]?.category);
                            return (
                              <View
                                key={a.id}
                                style={[styles.dot, { backgroundColor: meta.color, shadowColor: meta.color }]}
                              />
                            );
                          })}
                        </View>
                      ) : (
                        <Text style={styles.dayRest}>REST</Text>
                      )}
                      {isToday && <View style={styles.todayBar} />}
                    </Pressable>
                  );
                })}
              </View>

              {/* Selected-day panel — the accessories pinned to that weekday. */}
              <View style={styles.dayCard}>
                <View style={styles.dayCardHeader}>
                  <Text style={styles.dayCardDayName}>{DOW_FULL[selectedDow]}</Text>
                </View>
                {(() => {
                  const dayAcc = accessoriesOnDow(selectedDow);
                  return (
                    <ScrollView
                      style={styles.dayCardBody}
                      contentContainerStyle={[
                        styles.dayCardBodyContent,
                        dayAcc.length === 0 && styles.dayCardBodyEmpty,
                      ]}
                      showsVerticalScrollIndicator={false}
                    >
                      {dayAcc.length > 0 ? dayAcc.map(a => {
                        const wk   = workoutById[a.workout_id];
                        const meta = categoryMeta(wk?.category);
                        return (
                          <View key={a.id} style={[styles.dayWorkoutCard, { borderLeftColor: meta.color }]}>
                            <View style={styles.dayWorkoutInfo}>
                              <Text style={[styles.dayWorkoutTitle, { color: meta.color }]} numberOfLines={1}>
                                {a.name.toUpperCase()}
                              </Text>
                            </View>
                            <View style={styles.dayCardActionRow}>
                              {wk ? (
                                <PillButton label="VIEW" variant="solid" size="sm"
                                  style={styles.actionBtn} textStyle={styles.actionBtnText}
                                  onPress={() => navigation.navigate('WorkoutDetail', { workout: wk })} />
                              ) : null}
                              <PillButton label="✕" tone="danger" size="sm"
                                style={styles.actionBtn} textStyle={styles.actionBtnText}
                                onPress={() => toggleSchedule(a, selectedDow)} />
                            </View>
                          </View>
                        );
                      }) : (
                        <View style={styles.restCard}>
                          <Text style={styles.restLabel}>REST DAY</Text>
                        </View>
                      )}
                    </ScrollView>
                  );
                })()}
              </View>
            </>
          )}
        </View>
      </View>

      {/* ── Add / edit modal ── */}
      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setModalOpen(false)}>
          <Pressable style={styles.modal} onPress={() => {}}>
            <Text style={styles.modalTitle}>{editing ? 'EDIT ACCESSORY' : 'NEW ACCESSORY'}</Text>

            <Text style={styles.fieldLabel}>CHOOSE FROM MY WORKOUTS</Text>
            {pickerWorkouts.length === 0 ? (
              <View style={styles.pickerEmpty}>
                <Text style={styles.pickerEmptyText}>
                  No ACCESSORIES or LEGS workouts yet. Create one (set its TYPE to
                  Accessories or Legs) in MY WORKOUTS, then add it here.
                </Text>
              </View>
            ) : (
              <ScrollView
                style={styles.picker}
                contentContainerStyle={styles.pickerInner}
                showsVerticalScrollIndicator={false}
              >
                {pickerWorkouts.map(w => {
                  const meta     = categoryMeta(w.category);
                  const selected = pickedWk?.id === w.id;
                  const used     = usedWorkoutIds.has(w.id);
                  return (
                    <Pressable
                      key={w.id}
                      disabled={used}
                      onPress={() => setPickedWk(w)}
                      style={[
                        styles.pickRow,
                        selected && { borderColor: meta.color, backgroundColor: meta.color + '1c', shadowColor: meta.color },
                        used && styles.pickRowUsed,
                      ]}
                    >
                      <View style={[styles.pickRail, { backgroundColor: meta.color, opacity: used ? 0.3 : 1 }]} />
                      <View style={styles.pickBody}>
                        <Text style={[styles.pickTitle, used && { color: T.muted }]} numberOfLines={1}>
                          {w.title?.toUpperCase()}
                        </Text>
                        <Text style={[styles.pickType, { color: used ? T.muted : meta.color }]}>{meta.l}</Text>
                      </View>
                      {used ? (
                        <Text style={styles.pickUsedTag}>ADDED</Text>
                      ) : selected ? (
                        <Text style={[styles.pickCheck, { color: meta.color }]}>✓</Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            <Text style={styles.fieldLabel}>TIMES PER WEEK</Text>
            <View style={styles.stepper}>
              <Pressable
                style={styles.stepBtn}
                onPress={() => setDraftTgt(t => Math.max(1, t - 1))}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </Pressable>
              <Text style={styles.stepValue}>{draftTgt}</Text>
              <Pressable
                style={styles.stepBtn}
                onPress={() => setDraftTgt(t => Math.min(21, t + 1))}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </Pressable>
            </View>

            <View style={styles.modalActions}>
              <PillButton label="CANCEL" tone="muted" onPress={() => setModalOpen(false)} />
              <PillButton
                label={editing ? 'SAVE' : 'ADD'}
                variant="solid"
                loading={saving}
                disabled={editing ? false : !pickedWk}
                onPress={saveDraft}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenFrame>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  card: { height: CARD_H },
  body: { flex: 1, paddingHorizontal: 16, paddingBottom: 12, paddingTop: 6 },

  // ── Weekly routine ruler — same skeleton as the Training Forge weekGrid ──
  weekGrid: { flexDirection: 'row', gap: 6, marginTop: 12 },
  dayNode: {
    flex: 1, minHeight: 88, overflow: 'hidden',
    backgroundColor: T.panel, borderRadius: 10, borderWidth: 1.5, borderColor: T.border,
    alignItems: 'center', justifyContent: 'center', gap: 5, position: 'relative',
  },
  dayNodeToday: { borderColor: T.accent },
  dayNodeSelected: {
    backgroundColor: '#0a1a2e', borderColor: T.accent, borderWidth: 2,
    shadowColor: T.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 12,
  },
  dayLabel: {
    fontFamily: F.heading, fontSize: 22, color: T.muted, letterSpacing: 1, textTransform: 'uppercase',
  },
  dayLabelSel: { color: T.accent },
  dotsRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 4, maxWidth: 44 },
  dot: {
    width: 7, height: 7, borderRadius: 999,
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 4,
  },
  dayRest: {
    fontFamily: F.bodyMed, fontSize: 12, color: '#2a4a6a', letterSpacing: 0.5, textTransform: 'uppercase',
  },
  todayBar: {
    position: 'absolute', bottom: 0, left: 12, right: 12, height: 3,
    borderTopLeftRadius: 2, borderTopRightRadius: 2, backgroundColor: T.accent,
  },

  // ── Selected-day panel — copied from the Training Forge dayCard, with a fixed
  // height tuned so the accessory list keeps room but the panel stays roomy. ──
  dayCard: {
    marginTop: 14, height: 240,
    backgroundColor: T.panel, borderWidth: 1.5, borderColor: T.border,
    borderRadius: 12, padding: 18,
  },
  dayCardHeader: { gap: 4, minHeight: 36 },
  dayCardDayName: {
    fontFamily: F.heading, fontSize: 30, color: T.accent, letterSpacing: 3, textTransform: 'uppercase',
  },
  dayCardBody: { flex: 1 },
  dayCardBodyContent: { gap: 12, flexGrow: 1, justifyContent: 'flex-start' },
  dayCardBodyEmpty: { justifyContent: 'center' },
  dayWorkoutCard: {
    backgroundColor: T.bg, borderWidth: 1.5, borderColor: T.border,
    borderLeftWidth: 4, borderLeftColor: T.accent, borderRadius: 8,
    paddingVertical: 12, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  },
  dayWorkoutInfo: { flex: 1, gap: 2 },
  dayWorkoutTitle: {
    fontFamily: F.heading, fontSize: 19, color: T.accent, letterSpacing: 1.5,
    textTransform: 'uppercase', flexShrink: 1,
  },
  dayCardActionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap',
    justifyContent: 'flex-end', flexShrink: 0,
  },
  actionBtn: { paddingHorizontal: 12 },
  actionBtnText: { fontSize: 14, letterSpacing: 1 },
  restCard: { alignItems: 'center', gap: 8, paddingVertical: 16 },
  restLabel: { fontFamily: F.heading, fontSize: 26, color: T.muted, letterSpacing: 5 },

  // ── Per-accessory schedule strip (compact day circles, beside one another) ──
  schedDays: { flexDirection: 'row', gap: 7 },
  schedDay: {
    width: 36, height: 36, borderRadius: 999, borderWidth: 1.5, borderColor: T.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent',
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 6,
  },
  schedDayText: { fontFamily: F.bodyMed, fontSize: 14, color: T.muted },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  emptyTitle: { fontFamily: F.heading, fontSize: 20, color: T.accent, letterSpacing: 3 },
  emptySub: {
    fontFamily: F.body, fontSize: 14, color: T.muted, textAlign: 'center',
    marginTop: 10, lineHeight: 20,
  },

  scroll: { flex: 1 },
  scrollInner: { gap: 14, paddingBottom: 4 },

  // ── Accessory card ──
  itemCard: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: T.border,
    backgroundColor: T.panel,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
  },
  itemCardDone: { borderColor: T.green, shadowOpacity: 0.4 },
  itemRail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  itemContent: { paddingVertical: 18, paddingLeft: 24, paddingRight: 18, gap: 18 },

  itemHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  // Title + type chip share the top line.
  itemTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  itemName: {
    fontFamily: F.heading, fontSize: 24, color: T.text, letterSpacing: 1.5,
    textShadowColor: T.accent, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8,
  },

  // ── Type chip (mirrors My Workouts) ──
  typeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 11, paddingVertical: 4, borderRadius: 999, borderWidth: 1,
  },
  typeDot: { width: 6, height: 6, borderRadius: 999 },
  typeChipText: { fontFamily: F.bodyMed, fontSize: 12, letterSpacing: 1.5 },

  // ── Weekly progress (top-right) ──
  itemActions: { alignItems: 'flex-end', gap: 4 },
  progressNum: { fontFamily: F.heading, fontSize: 34, color: T.accent, letterSpacing: 1, lineHeight: 36 },
  progressDen: { fontFamily: F.heading, fontSize: 20, color: T.muted },
  progressLabel: { fontFamily: F.bodyMed, fontSize: 11, color: T.muted, letterSpacing: 2 },

  // ── Mid row — rep log + routine circles + actions, all in one row ──
  midRow: { flexDirection: 'row', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap' },
  repSection: { gap: 12 },
  routineSection: {
    gap: 12, paddingLeft: 24, borderLeftWidth: 1, borderLeftColor: T.border,
  },
  midActions: { flexDirection: 'row', gap: 8, marginLeft: 'auto' },

  // ── Rep cells ──
  cellRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cellHit: { padding: 2 },
  cell: {
    width: 42, height: 42, borderRadius: 12, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 8,
  },
  cellTick: { fontFamily: F.heading, fontSize: 20, color: '#02121e' },


  // ── Modal ──
  backdrop: {
    flex: 1, backgroundColor: 'rgba(2,6,14,0.82)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  modal: {
    width: '100%', maxWidth: 440, borderRadius: 18, borderWidth: 1.5,
    borderColor: T.accent, backgroundColor: T.bg, padding: 24,
    shadowColor: T.accent, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5, shadowRadius: 24,
  },
  modalTitle: {
    fontFamily: F.heading, fontSize: 22, color: T.accent, letterSpacing: 3,
    textAlign: 'center', marginBottom: 20,
  },
  fieldLabel: {
    fontFamily: F.bodyMed, fontSize: 12, color: T.muted, letterSpacing: 2,
    marginBottom: 8, marginTop: 4,
  },
  // ── Workout picker (in the add/edit modal) ──
  picker: { maxHeight: 240, marginBottom: 18 },
  pickerInner: { gap: 8, paddingRight: 2 },
  pickRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: T.border, borderRadius: 12,
    backgroundColor: T.panel, overflow: 'hidden',
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 9,
  },
  pickRowUsed: { opacity: 0.5 },
  pickRail: { width: 4, alignSelf: 'stretch' },
  pickBody: { flex: 1, paddingVertical: 11, paddingHorizontal: 14, gap: 3 },
  pickTitle: { fontFamily: F.heading, fontSize: 16, color: T.text, letterSpacing: 1.5 },
  pickType: { fontFamily: F.bodyMed, fontSize: 11, letterSpacing: 1.5 },
  pickCheck: { fontFamily: F.heading, fontSize: 20, paddingHorizontal: 16 },
  pickUsedTag: {
    fontFamily: F.bodyMed, fontSize: 10, color: T.muted, letterSpacing: 1.5, paddingHorizontal: 14,
  },
  pickerEmpty: {
    borderWidth: 1.5, borderColor: T.border, borderRadius: 12, backgroundColor: T.panel,
    padding: 18, marginBottom: 18,
  },
  pickerEmptyText: {
    fontFamily: F.body, fontSize: 14, color: T.muted, textAlign: 'center', lineHeight: 20,
  },

  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, marginBottom: 24 },
  stepBtn: {
    width: 48, height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: T.accent,
    backgroundColor: T.panel, alignItems: 'center', justifyContent: 'center',
  },
  stepBtnText: { fontFamily: F.heading, fontSize: 26, color: T.accent, marginTop: -2 },
  stepValue: { fontFamily: F.heading, fontSize: 32, color: T.text, minWidth: 48, textAlign: 'center' },

  modalActions: { flexDirection: 'row', justifyContent: 'center', gap: 14 },
});
