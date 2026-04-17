import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Modal,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';

// ─── Theme ────────────────────────────────────────────────────────────────────

const SL = {
  bg:     '#050912',
  panel:  '#070d1a',
  border: '#1a3a5c',
  accent: '#4A9EBF',
  text:   '#E8F4FF',
  muted:  '#4a6a8a',
  danger: '#FF4444',
  green:  '#4CAF50',
  gold:   '#FFD700',
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ClassQuestScreen({ route, navigation }) {
  const { student } = route.params;

  const [profile,      setProfile]      = useState(null);
  const [classData,    setClassData]    = useState(null);
  const [quests,       setQuests]       = useState([]);
  const [completedIds, setCompletedIds] = useState(new Set());
  const [allClasses,   setAllClasses]   = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [toggling,     setToggling]     = useState(null);
  const [classModal,   setClassModal]   = useState(false);
  const [assigning,    setAssigning]    = useState(false);

  // Inline confirmation state (replaces Alert.alert — unreliable on Expo web)
  const [pendingQuest,  setPendingQuest]  = useState(null);
  const [showPrestige,  setShowPrestige]  = useState(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const [profileRes, classesRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('class_id, current_lvl, total_exp, prestige_count')
          .eq('id', student.id)
          .single(),
        supabase
          .from('classes')
          .select('*')
          .order('order_index'),
      ]);

      const prof = profileRes.data ?? null;
      setProfile(prof);
      setAllClasses(classesRes.data ?? []);

      if (!prof?.class_id) { setLoading(false); return; }

      const [classRes, questsRes, completionsRes] = await Promise.all([
        supabase
          .from('classes')
          .select('*')
          .eq('id', prof.class_id)
          .single(),
        supabase
          .from('class_quests')
          .select('*')
          .eq('class_id', prof.class_id)
          .order('quest_type')
          .order('chain')
          .order('order_index'),
        supabase
          .from('student_quest_completions')
          .select('quest_id')
          .eq('student_id', student.id),
      ]);

      setClassData(classRes.data ?? null);
      setQuests(questsRes.data ?? []);
      setCompletedIds(new Set((completionsRes.data ?? []).map(c => c.quest_id)));
    } catch (e) {
      console.error('[ClassQuestScreen] fetchData:', e);
    }
    setLoading(false);
  }, [student.id]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]));

  // ── Assign class ───────────────────────────────────────────────────────────

  async function handleAssignClass(cls) {
    setAssigning(true);
    const { error } = await supabase
      .from('profiles')
      .update({ class_id: cls.id })
      .eq('id', student.id);
    setAssigning(false);
    setClassModal(false);
    if (error) { console.error('[ClassQuestScreen] assign class:', error); return; }
    setLoading(true);
    fetchData();
  }

  // ── Toggle quest completion ────────────────────────────────────────────────

  async function toggleQuest(quest) {
    setToggling(quest.id);
    const done = completedIds.has(quest.id);
    try {
      if (done) {
        const { error: delErr } = await supabase
          .from('student_quest_completions')
          .delete()
          .eq('student_id', student.id)
          .eq('quest_id', quest.id);
        if (delErr) throw delErr;

        const newLvl = Math.max(0, (profile?.current_lvl ?? 0) - quest.lvl_reward);
        const { error: updErr } = await supabase
          .from('profiles')
          .update({ current_lvl: newLvl })
          .eq('id', student.id);
        if (updErr) throw updErr;

        setCompletedIds(prev => { const s = new Set(prev); s.delete(quest.id); return s; });
        setProfile(prev => ({ ...prev, current_lvl: newLvl }));
      } else {
        const { error: insErr } = await supabase
          .from('student_quest_completions')
          .insert({ student_id: student.id, quest_id: quest.id });
        if (insErr) throw insErr;

        const newLvl = (profile?.current_lvl ?? 0) + quest.lvl_reward;
        const { error: updErr } = await supabase
          .from('profiles')
          .update({ current_lvl: newLvl })
          .eq('id', student.id);
        if (updErr) throw updErr;

        setCompletedIds(prev => new Set([...prev, quest.id]));
        setProfile(prev => ({ ...prev, current_lvl: newLvl }));
      }
    } catch (e) {
      console.error('[ClassQuestScreen] toggleQuest:', e);
    }
    setToggling(null);
  }

  // ── Prestige ───────────────────────────────────────────────────────────────

  async function handlePrestige() {
    try {
      const currentClass = allClasses.find(c => c.id === profile?.class_id);
      const nextClass    = allClasses.find(c => c.order_index === (currentClass?.order_index ?? 0) + 1);

      const { error: updErr } = await supabase
        .from('profiles')
        .update({
          current_lvl:    0,
          prestige_count: (profile?.prestige_count ?? 0) + 1,
          class_id:       nextClass?.id ?? profile?.class_id,
        })
        .eq('id', student.id);
      if (updErr) throw updErr;

      const { error: delErr } = await supabase
        .from('student_quest_completions')
        .delete()
        .eq('student_id', student.id);
      if (delErr) throw delErr;

      setLoading(true);
      fetchData();
    } catch (e) {
      console.error('[ClassQuestScreen] prestige:', e);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={SL.accent} />
      </View>
    );
  }

  const lvl      = profile?.current_lvl    ?? 0;
  const exp      = profile?.total_exp      ?? 0;
  const prestige = profile?.prestige_count ?? 0;

  const mainQuests = quests.filter(q => q.quest_type === 'main');
  const sideQuests = quests.filter(q => q.quest_type === 'side');
  const chains     = [...new Set(mainQuests.map(q => q.chain).filter(Boolean))];

  const confirmBarVisible = pendingQuest !== null || showPrestige;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.title}>CLASS & QUESTS</Text>
        <Text style={styles.subtitle}>{student.full_name?.toUpperCase()}</Text>
        <View style={styles.divider} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, confirmBarVisible && { paddingBottom: 140 }]}
      >
        {/* ── Class assignment ── */}
        <View style={styles.classRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>CURRENT CLASS</Text>
            <Text style={styles.rowValue}>
              {classData?.name ?? 'No class assigned'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.assignBtn}
            onPress={() => setClassModal(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.assignBtnText}>ASSIGN CLASS</Text>
          </TouchableOpacity>
        </View>

        {/* ── LVL & EXP ── */}
        <View style={styles.statsRow}>
          {[
            { label: 'LVL',      value: lvl },
            { label: 'EXP',      value: exp },
            { label: 'PRESTIGE', value: prestige },
          ].map(({ label, value }) => (
            <View key={label} style={styles.statCard}>
              <Text style={styles.statValue}>{value}</Text>
              <Text style={styles.statLabel}>{label}</Text>
            </View>
          ))}
        </View>

        {/* ── Prestige button ── */}
        {lvl >= 80 && (
          <TouchableOpacity
            style={styles.prestigeBtn}
            onPress={() => setShowPrestige(true)}
            activeOpacity={0.85}
          >
            <Text style={styles.prestigeBtnText}>⚡ PRESTIGE STUDENT</Text>
          </TouchableOpacity>
        )}

        {/* ── Main Quests ── */}
        {mainQuests.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>MAIN QUESTS</Text>
            {chains.map(chain => {
              const chainQuests = mainQuests.filter(q => q.chain === chain);
              return (
                <View key={chain} style={styles.chainBlock}>
                  <Text style={styles.chainLabel}>{chain.toUpperCase()}</Text>
                  {chainQuests.map((quest, i) => {
                    const done       = completedIds.has(quest.id);
                    const prevDone   = i === 0 || completedIds.has(chainQuests[i - 1].id);
                    const locked     = !done && !prevDone;
                    const isToggling = toggling === quest.id;
                    return (
                      <TouchableOpacity
                        key={quest.id}
                        style={[
                          styles.questCard,
                          done   && styles.questCardDone,
                          locked && styles.questCardLocked,
                        ]}
                        onPress={() => { if (!locked) setPendingQuest(quest); }}
                        disabled={!!toggling || locked}
                        activeOpacity={locked ? 1 : 0.75}
                      >
                        <Text style={[
                          styles.questName,
                          done   && styles.questNameDone,
                          locked && styles.questNameLocked,
                        ]}>
                          {locked ? '🔒  ' : ''}{quest.name}
                        </Text>
                        <View style={styles.questRight}>
                          {isToggling ? (
                            <ActivityIndicator color={SL.accent} size="small" />
                          ) : done ? (
                            <View style={styles.doneBadge}>
                              <Text style={styles.doneBadgeText}>✓ DONE</Text>
                            </View>
                          ) : (
                            <View style={[styles.rewardBadge, locked && { opacity: 0.35 }]}>
                              <Text style={styles.rewardText}>+{quest.lvl_reward} LVL</Text>
                            </View>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })}
          </>
        )}

        {/* ── Side Quests ── */}
        {sideQuests.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 24 }]}>SIDE QUESTS</Text>
            {sideQuests.map(quest => {
              const done       = completedIds.has(quest.id);
              const isToggling = toggling === quest.id;
              return (
                <TouchableOpacity
                  key={quest.id}
                  style={[styles.questCard, done && styles.questCardDone]}
                  onPress={() => setPendingQuest(quest)}
                  disabled={!!toggling}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.questName, done && styles.questNameDone]}>
                    {quest.name}
                  </Text>
                  <View style={styles.questRight}>
                    {isToggling ? (
                      <ActivityIndicator color={SL.accent} size="small" />
                    ) : done ? (
                      <View style={styles.doneBadge}>
                        <Text style={styles.doneBadgeText}>✓ DONE</Text>
                      </View>
                    ) : (
                      <View style={styles.rewardBadge}>
                        <Text style={styles.rewardText}>+{quest.lvl_reward} LVL</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {!classData && (
          <View style={styles.noClass}>
            <Text style={styles.noClassText}>Assign a class to see quests.</Text>
          </View>
        )}
      </ScrollView>

      {/* ── Quest confirmation bar ── */}
      {pendingQuest && (
        <View style={styles.confirmBar}>
          <Text style={styles.confirmText}>
            {completedIds.has(pendingQuest.id)
              ? `Remove "${pendingQuest.name}"? (−${pendingQuest.lvl_reward} LVL)`
              : `Mark "${pendingQuest.name}" done? (+${pendingQuest.lvl_reward} LVL)`
            }
          </Text>
          <View style={styles.confirmButtons}>
            <TouchableOpacity
              style={styles.confirmCancel}
              onPress={() => setPendingQuest(null)}
            >
              <Text style={styles.confirmCancelText}>CANCEL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.confirmOk}
              onPress={() => {
                const q = pendingQuest;
                setPendingQuest(null);
                toggleQuest(q);
              }}
            >
              <Text style={styles.confirmOkText}>CONFIRM</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Prestige confirmation bar ── */}
      {showPrestige && (
        <View style={styles.confirmBar}>
          <Text style={styles.confirmText}>
            Reset to LVL 0, advance class, clear all completions?
          </Text>
          <View style={styles.confirmButtons}>
            <TouchableOpacity
              style={styles.confirmCancel}
              onPress={() => setShowPrestige(false)}
            >
              <Text style={styles.confirmCancelText}>CANCEL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmOk, { backgroundColor: SL.gold }]}
              onPress={() => { setShowPrestige(false); handlePrestige(); }}
            >
              <Text style={styles.confirmOkText}>PRESTIGE</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Class picker modal ── */}
      <Modal
        visible={classModal}
        transparent
        animationType="slide"
        onRequestClose={() => setClassModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>SELECT CLASS</Text>
            <View style={styles.modalDivider} />
            {allClasses.map(cls => (
              <TouchableOpacity
                key={cls.id}
                style={[
                  styles.classOption,
                  cls.id === profile?.class_id && styles.classOptionSelected,
                ]}
                onPress={() => handleAssignClass(cls)}
                disabled={assigning}
                activeOpacity={0.75}
              >
                <Text style={[
                  styles.classOptionName,
                  cls.id === profile?.class_id && styles.classOptionNameSelected,
                ]}>
                  {cls.name}
                </Text>
                {cls.description ? (
                  <Text style={styles.classOptionDesc}>{cls.description}</Text>
                ) : null}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setClassModal(false)}>
              <Text style={styles.modalCancelText}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg, position: 'relative' },

  header: {
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
  title: {
    fontFamily: F.heading,
    fontSize: 32,
    color: SL.accent,
    letterSpacing: 4,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: 6,
  },
  divider: {
    height: 1,
    backgroundColor: SL.accent,
    opacity: 0.3,
    marginTop: 20,
  },

  body: { paddingBottom: 48 },

  // ── Class row ────────────────────────────────────────────────────────────────

  classRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: SL.border,
    gap: 12,
  },
  rowLabel: {
    fontFamily: F.bodyMed,
    fontSize: 11,
    color: SL.muted,
    letterSpacing: 2,
    marginBottom: 4,
  },
  rowValue: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.gold,
    letterSpacing: 2,
  },
  assignBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 6,
  },
  assignBtnText: {
    fontFamily: F.bodyMed,
    fontSize: 13,
    color: SL.accent,
    letterSpacing: 2,
  },

  // ── Stats ─────────────────────────────────────────────────────────────────────

  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontFamily: F.heading,
    fontSize: 28,
    color: SL.accent,
    letterSpacing: 1,
  },
  statLabel: {
    fontFamily: F.bodyMed,
    fontSize: 11,
    color: SL.muted,
    letterSpacing: 2,
  },

  // ── Prestige button ───────────────────────────────────────────────────────────

  prestigeBtn: {
    marginHorizontal: 16,
    marginTop: 16,
    height: 46,
    borderWidth: 1.5,
    borderColor: SL.gold,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,215,0,0.06)',
  },
  prestigeBtnText: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.gold,
    letterSpacing: 3,
  },

  // ── Section labels ───────────────────────────────────────────────────────────

  sectionLabel: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: SL.muted,
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 10,
    marginHorizontal: 16,
  },

  // ── Quest cards ──────────────────────────────────────────────────────────────

  chainBlock: {
    marginHorizontal: 16,
    marginBottom: 14,
  },
  chainLabel: {
    fontFamily: F.heading,
    fontSize: 13,
    color: SL.accent,
    letterSpacing: 4,
    marginBottom: 8,
    opacity: 0.7,
  },
  questCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 6,
  },
  questCardDone: {
    backgroundColor: 'rgba(76,175,80,0.08)',
    borderColor: SL.green,
    borderLeftWidth: 3,
    borderLeftColor: SL.green,
  },
  questCardLocked: {
    opacity: 0.45,
  },
  questName: {
    flex: 1,
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.text,
    letterSpacing: 1,
  },
  questNameDone:   { color: SL.green },
  questNameLocked: { color: SL.muted },
  questRight: { marginLeft: 12 },
  doneBadge: {
    backgroundColor: 'rgba(76,175,80,0.15)',
    borderWidth: 1,
    borderColor: SL.green,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  doneBadgeText: {
    fontFamily: F.heading,
    fontSize: 12,
    color: SL.green,
    letterSpacing: 2,
  },
  rewardBadge: {
    borderWidth: 1,
    borderColor: SL.accent,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  rewardText: {
    fontFamily: F.bodyMed,
    fontSize: 13,
    color: SL.accent,
    letterSpacing: 1.5,
  },

  noClass: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  noClassText: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 1,
  },

  // ── Confirmation bar ──────────────────────────────────────────────────────────

  confirmBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: SL.panel,
    borderTopWidth: 2,
    borderTopColor: SL.accent,
    padding: 16,
    gap: 12,
  },
  confirmText: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.text,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  confirmCancel: {
    flex: 1,
    height: 40,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmCancelText: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.muted,
    letterSpacing: 2,
  },
  confirmOk: {
    flex: 1,
    height: 40,
    backgroundColor: SL.accent,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmOkText: {
    fontFamily: F.heading,
    fontSize: 14,
    color: SL.bg,
    letterSpacing: 2,
  },

  // ── Class modal ───────────────────────────────────────────────────────────────

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalBox: {
    backgroundColor: SL.panel,
    borderTopWidth: 1.5,
    borderTopColor: SL.accent,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },
  modalTitle: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.accent,
    letterSpacing: 4,
    textAlign: 'center',
    marginBottom: 16,
  },
  modalDivider: {
    height: 1,
    backgroundColor: SL.border,
    marginBottom: 16,
  },
  classOption: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    marginBottom: 8,
    gap: 4,
  },
  classOptionSelected: {
    borderColor: SL.gold,
    backgroundColor: 'rgba(255,215,0,0.06)',
  },
  classOptionName: {
    fontFamily: F.heading,
    fontSize: 20,
    color: SL.text,
    letterSpacing: 2,
  },
  classOptionNameSelected: { color: SL.gold },
  classOptionDesc: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.muted,
    letterSpacing: 0.5,
  },
  modalCancel: {
    marginTop: 8,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCancelText: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 2,
  },
});
