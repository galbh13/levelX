// LEGACY: replaced by chain-card side-quest UI on 2026-05-20. Kept as fallback. Safe to delete once new UI is verified.
import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator,
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
//
// Flat list of side quests for `classId`. Coach taps a card → confirmation
// bar → DB write (insert/delete in student_quest_completions). LVL is no
// longer stored on profiles; it is computed per-class from completions.

export default function CoachSideQuestScreen({ route, navigation }) {
  const { student, classId } = route.params;

  const [quests,        setQuests]        = useState([]);
  const [completedIds,  setCompletedIds]  = useState(new Set());
  const [loading,       setLoading]       = useState(true);
  const [pendingQuest,  setPendingQuest]  = useState(null);
  const [toggling,      setToggling]      = useState(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const [qRes, cRes] = await Promise.all([
        supabase
          .from('class_quests')
          .select('*')
          .eq('class_id', classId)
          .eq('quest_type', 'side')
          .order('chain')
          .order('order_index'),
        supabase
          .from('student_quest_completions')
          .select('quest_id')
          .eq('student_id', student.id),
      ]);

      setQuests(qRes.data ?? []);
      setCompletedIds(new Set((cRes.data ?? []).map(c => c.quest_id)));
    } catch (e) {
      console.error('[CoachSideQuestScreen]', e);
    }
    setLoading(false);
  }, [classId, student.id]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]));

  // ── Toggle ────────────────────────────────────────────────────────────────

  async function toggleQuest(quest) {
    setToggling(true);
    const done = completedIds.has(quest.id);
    try {
      if (done) {
        const { error: delErr } = await supabase
          .from('student_quest_completions')
          .delete()
          .eq('student_id', student.id)
          .eq('quest_id', quest.id);
        if (delErr) throw delErr;

        setCompletedIds(prev => { const s = new Set(prev); s.delete(quest.id); return s; });
      } else {
        const { error: insErr } = await supabase
          .from('student_quest_completions')
          .insert({ student_id: student.id, quest_id: quest.id });
        if (insErr) throw insErr;

        setCompletedIds(prev => new Set([...prev, quest.id]));
      }
    } catch (e) {
      console.error('[CoachSideQuestScreen] toggleQuest:', e);
    }
    setToggling(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={SL.accent} />
      </View>
    );
  }

  const doneCount = quests.filter(q => completedIds.has(q.id)).length;
  const earnedLvl = quests
    .filter(q => completedIds.has(q.id))
    .reduce((s, q) => s + (q.lvl_reward ?? 0), 0);

  const confirmBarVisible = pendingQuest !== null;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.title}>SIDE QUESTS</Text>
        <Text style={styles.subtitle}>{student.full_name?.toUpperCase()}</Text>
        <Text style={styles.statsText}>
          {doneCount}/{quests.length} · +{earnedLvl} LVL earned
        </Text>
        <View style={styles.divider} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.body,
          confirmBarVisible && { paddingBottom: 160 },
        ]}
      >
        {quests.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No side quests for this class.</Text>
          </View>
        ) : quests.map(quest => {
          const done = completedIds.has(quest.id);
          return (
            <TouchableOpacity
              key={quest.id}
              style={[styles.questCard, done && styles.questCardDone]}
              onPress={() => setPendingQuest(quest)}
              disabled={toggling}
              activeOpacity={0.75}
            >
              <Text style={[styles.questName, done && styles.questNameDone]}>
                {quest.name}
              </Text>
              <View style={styles.questRight}>
                {done ? (
                  <View style={styles.doneBadge}>
                    <Text style={styles.doneBadgeText}>✓ DONE</Text>
                  </View>
                ) : (
                  <View style={styles.rewardBadge}>
                    <Text style={styles.rewardText}>+{quest.lvl_reward ?? 0} LVL</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Confirmation bar ── */}
      {pendingQuest && (
        <View style={styles.confirmBar}>
          <Text style={styles.confirmText}>
            {completedIds.has(pendingQuest.id)
              ? `Remove "${pendingQuest.name}"? (−${pendingQuest.lvl_reward ?? 0} LVL)`
              : `Mark "${pendingQuest.name}" done? (+${pendingQuest.lvl_reward ?? 0} LVL)`
            }
          </Text>
          <View style={styles.confirmButtons}>
            <TouchableOpacity
              style={styles.confirmCancel}
              onPress={() => setPendingQuest(null)}
              disabled={toggling}
            >
              <Text style={styles.confirmCancelText}>CANCEL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.confirmOk}
              disabled={toggling}
              onPress={() => {
                const q = pendingQuest;
                setPendingQuest(null);
                toggleQuest(q);
              }}
            >
              {toggling
                ? <ActivityIndicator color={SL.bg} size="small" />
                : <Text style={styles.confirmOkText}>CONFIRM</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg, position: 'relative' },

  header: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 20,
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
  statsText: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.muted,
    letterSpacing: 1,
    marginTop: 6,
    textAlign: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: SL.accent,
    opacity: 0.3,
    marginTop: 16,
  },

  body: { paddingTop: 12, paddingBottom: 48 },

  // Quest cards
  questCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  questCardDone: {
    backgroundColor: 'rgba(76,175,80,0.08)',
    borderColor: SL.green,
    borderLeftWidth: 3,
    borderLeftColor: SL.green,
  },
  questName: {
    flex: 1,
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.text,
    letterSpacing: 1,
  },
  questNameDone: { color: SL.green },
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

  empty: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyText: {
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
});
