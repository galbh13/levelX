import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Modal,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { computeLvlFromData } from '../lib/computeLvl';
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
  const [classModal,   setClassModal]   = useState(false);
  const [assigning,    setAssigning]    = useState(false);

  // Inline confirmation state (replaces Alert.alert — unreliable on Expo web)
  const [showPrestige,  setShowPrestige]  = useState(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const [profileRes, classesRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('class_id, total_exp, prestige_count')
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

  // ── Prestige ───────────────────────────────────────────────────────────────

  async function handlePrestige() {
    try {
      const currentClass = allClasses.find(c => c.id === profile?.class_id);
      const nextClass    = allClasses.find(c => c.order_index === (currentClass?.order_index ?? 0) + 1);

      const { error: updErr } = await supabase
        .from('profiles')
        .update({
          prestige_count: (profile?.prestige_count ?? 0) + 1,
          class_id:       nextClass?.id ?? profile?.class_id,
        })
        .eq('id', student.id);
      if (updErr) throw updErr;

      // Quest completions are intentionally preserved across prestige so that
      // computed per-class LVL auto-restores if the player ever returns.

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

  const lvl      = computeLvlFromData(quests, completedIds);
  const exp      = profile?.total_exp      ?? 0;
  const prestige = profile?.prestige_count ?? 0;

  const mainQuests = quests.filter(q => q.quest_type === 'main');
  const sideQuests = quests.filter(q => q.quest_type === 'side');
  const chains     = [...new Set(mainQuests.map(q => q.chain).filter(Boolean))];
  const sideChains = [...new Set(sideQuests.map(q => q.chain).filter(Boolean))];

  const confirmBarVisible = showPrestige;

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

        {/* ── Main Quest chains — one card per chain → opens CoachQuestTree ── */}
        {chains.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>MAIN QUESTS</Text>
            {chains.map(chain => {
              const chainQuests = mainQuests.filter(q => q.chain === chain);
              const done        = chainQuests.filter(q => completedIds.has(q.id));
              const earnedLvl   = done.reduce((s, q) => s + (q.lvl_reward ?? 0), 0);
              return (
                <TouchableOpacity
                  key={chain}
                  style={styles.chainCard}
                  activeOpacity={0.8}
                  onPress={() =>
                    navigation.navigate('CoachQuestTree', {
                      student,
                      classId:   profile.class_id,
                      chain,
                      questType: 'main',
                    })
                  }
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.chainCardName}>
                      {chain.replace(/_/g, ' ').toUpperCase()}
                    </Text>
                    <Text style={styles.chainCardMeta}>
                      {done.length}/{chainQuests.length} · +{earnedLvl} LVL earned
                    </Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {/* ── Side Quest chains — one card per chain → opens CoachQuestTree ── */}
        {sideChains.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 24 }]}>SIDE QUESTS</Text>
            {sideChains.map(chain => {
              const chainQuests = sideQuests.filter(q => q.chain === chain);
              const done        = chainQuests.filter(q => completedIds.has(q.id));
              const earnedLvl   = done.reduce((s, q) => s + (q.lvl_reward ?? 0), 0);
              return (
                <TouchableOpacity
                  key={chain}
                  style={styles.chainCard}
                  activeOpacity={0.8}
                  onPress={() =>
                    navigation.navigate('CoachQuestTree', {
                      student,
                      classId:   profile.class_id,
                      chain,
                      questType: 'side',
                    })
                  }
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.chainCardName}>
                      {chain.replace(/_/g, ' ').toUpperCase()}
                    </Text>
                    <Text style={styles.chainCardMeta}>
                      {done.length}/{chainQuests.length} · +{earnedLvl} LVL earned
                    </Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
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

      {/* ── Prestige confirmation bar ── */}
      {showPrestige && (
        <View style={styles.confirmBar}>
          <Text style={styles.confirmText}>
            Advance to next class? Your quest history will be kept.
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

  // ── Chain / side-quest cards ─────────────────────────────────────────────────

  chainCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 6,
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  chainCardName: {
    fontFamily: F.heading,
    fontSize: 20,
    color: SL.text,
    letterSpacing: 3,
    marginBottom: 4,
  },
  chainCardMeta: {
    fontFamily: F.bodyMed,
    fontSize: 13,
    color: SL.accent,
    letterSpacing: 1,
  },
  chevron: {
    fontFamily: F.heading,
    fontSize: 28,
    color: SL.muted,
    marginLeft: 12,
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
