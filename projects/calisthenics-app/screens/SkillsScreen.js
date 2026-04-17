import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
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

export default function SkillsScreen() {
  const [profile,     setProfile]     = useState(null);
  const [classData,   setClassData]   = useState(null);
  const [quests,      setQuests]      = useState([]);
  const [completions, setCompletions] = useState(new Set());
  const [loading,     setLoading]     = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profileData } = await supabase
        .from('profiles')
        .select('full_name, class_id, current_lvl, total_exp, prestige_count')
        .eq('id', user.id)
        .single();

      if (!profileData) return;
      setProfile(profileData);

      if (!profileData.class_id) { setLoading(false); return; }

      const [classRes, questsRes, completionsRes] = await Promise.all([
        supabase
          .from('classes')
          .select('*')
          .eq('id', profileData.class_id)
          .single(),
        supabase
          .from('class_quests')
          .select('*')
          .eq('class_id', profileData.class_id)
          .order('quest_type')
          .order('chain')
          .order('order_index'),
        supabase
          .from('student_quest_completions')
          .select('quest_id')
          .eq('student_id', user.id),
      ]);

      setClassData(classRes.data ?? null);
      setQuests(questsRes.data ?? []);
      setCompletions(new Set((completionsRes.data ?? []).map(c => c.quest_id)));
    } catch (e) {
      console.error('[SkillsScreen] fetchData:', e);
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]));

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={SL.accent} />
      </View>
    );
  }

  const lvl      = profile?.current_lvl   ?? 0;
  const exp      = profile?.total_exp     ?? 0;
  const prestige = profile?.prestige_count ?? 0;
  const lvlPct   = Math.min(lvl / 100, 1);

  const mainQuests = quests.filter(q => q.quest_type === 'main');
  const sideQuests = quests.filter(q => q.quest_type === 'side');
  const chains     = [...new Set(mainQuests.map(q => q.chain).filter(Boolean))];

  const mainLvl = mainQuests.filter(q => completions.has(q.id)).reduce((s, q) => s + q.lvl_reward, 0);
  const sideLvl = sideQuests.filter(q => completions.has(q.id)).reduce((s, q) => s + q.lvl_reward, 0);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.body}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.playerName}>{profile?.full_name?.toUpperCase() ?? '—'}</Text>
          {classData && (
            <View style={styles.classBadge}>
              <Text style={styles.classBadgeText}>{classData.name?.toUpperCase()}</Text>
            </View>
          )}
        </View>

        {prestige > 0 && (
          <Text style={styles.prestigeStars}>{'★'.repeat(prestige)}</Text>
        )}

        <Text style={styles.lvlNumber}>LVL {lvl}</Text>
        <Text style={styles.expText}>{exp} EXP</Text>

        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${(lvlPct * 100).toFixed(1)}%` }]} />
        </View>
        <Text style={styles.progressLabel}>{lvl} / 100</Text>

        {lvl >= 80 && (
          <View style={styles.prestigeBanner}>
            <Text style={styles.prestigeBannerText}>✨ PRESTIGE AVAILABLE</Text>
          </View>
        )}
        <View style={styles.headerDivider} />
      </View>

      {/* ── No class ── */}
      {!classData ? (
        <View style={styles.noClass}>
          <Text style={styles.noClassText}>NO CLASS ASSIGNED YET</Text>
          <Text style={styles.noClassSub}>Your coach will assign your class.</Text>
        </View>
      ) : (
        <>
          {/* ── Main Quests ── */}
          <Text style={styles.sectionLabel}>MAIN QUESTS</Text>

          {chains.map(chain => {
            const chainQuests = mainQuests.filter(q => q.chain === chain);
            return (
              <View key={chain} style={styles.chainBlock}>
                <Text style={styles.chainLabel}>{chain.toUpperCase()}</Text>
                {chainQuests.map((quest, i) => {
                  const done     = completions.has(quest.id);
                  const prevDone = i === 0 || completions.has(chainQuests[i - 1].id);
                  const locked   = !done && !prevDone;
                  return (
                    <View
                      key={quest.id}
                      style={[
                        styles.questCard,
                        done   && styles.questCardDone,
                        locked && styles.questCardLocked,
                      ]}
                    >
                      <Text style={[
                        styles.questName,
                        done   && styles.questNameDone,
                        locked && styles.questNameMuted,
                      ]}>
                        {locked ? '🔒  ' : ''}{quest.name}
                      </Text>
                      <View style={styles.questRight}>
                        {done ? (
                          <View style={styles.doneBadge}>
                            <Text style={styles.doneBadgeText}>✓ DONE</Text>
                          </View>
                        ) : (
                          <View style={[styles.rewardBadge, locked && { opacity: 0.4 }]}>
                            <Text style={styles.rewardText}>+{quest.lvl_reward} LVL</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })}

          {/* ── Side Quests ── */}
          <Text style={[styles.sectionLabel, { marginTop: 28 }]}>SIDE QUESTS</Text>
          <View style={styles.sideGrid}>
            {sideQuests.map(quest => {
              const done = completions.has(quest.id);
              return (
                <View key={quest.id} style={[styles.sideCard, done && styles.sideCardDone]}>
                  <Text style={[styles.sideName, done && styles.sideNameDone]} numberOfLines={2}>
                    {quest.name}
                  </Text>
                  {done
                    ? <Text style={styles.sideDone}>✓ DONE</Text>
                    : <Text style={styles.sideReward}>+{quest.lvl_reward} LVL</Text>
                  }
                </View>
              );
            })}
          </View>

          {/* ── Total ── */}
          <View style={styles.totalCard}>
            <Text style={styles.totalTitle}>TOTAL: {lvl} / 100 LVL</Text>
            <Text style={styles.totalBreakdown}>
              {mainLvl} from main quests  ·  {sideLvl} from side quests
            </Text>
          </View>
        </>
      )}

      <View style={{ height: 56 }} />
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg },
  body:      { paddingBottom: 40 },

  // ── Header ──────────────────────────────────────────────────────────────────

  header: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 28,
    alignItems: 'center',
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  playerName: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.text,
    letterSpacing: 3,
    textAlign: 'center',
  },
  classBadge: {
    borderWidth: 1.5,
    borderColor: SL.gold,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  classBadgeText: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: SL.gold,
    letterSpacing: 2,
  },
  prestigeStars: {
    fontSize: 20,
    color: SL.gold,
    letterSpacing: 4,
    marginBottom: 4,
  },
  lvlNumber: {
    fontFamily: F.heading,
    fontSize: 64,
    color: SL.accent,
    letterSpacing: 4,
    lineHeight: 72,
    marginTop: 4,
  },
  expText: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 2,
    marginBottom: 16,
  },
  progressBarBg: {
    width: '100%',
    height: 6,
    backgroundColor: SL.border,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: SL.accent,
    borderRadius: 3,
  },
  progressLabel: {
    fontFamily: F.bodyMed,
    fontSize: 13,
    color: SL.muted,
    letterSpacing: 1.5,
  },
  prestigeBanner: {
    marginTop: 14,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: SL.gold,
    borderRadius: 6,
    backgroundColor: 'rgba(255,215,0,0.08)',
  },
  prestigeBannerText: {
    fontFamily: F.heading,
    fontSize: 16,
    color: SL.gold,
    letterSpacing: 3,
  },
  headerDivider: {
    height: 1,
    backgroundColor: SL.border,
    alignSelf: 'stretch',
    marginTop: 24,
    opacity: 0.6,
  },

  // ── No class ────────────────────────────────────────────────────────────────

  noClass: {
    paddingVertical: 60,
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 32,
  },
  noClassText: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.muted,
    letterSpacing: 3,
    textAlign: 'center',
  },
  noClassSub: {
    fontFamily: F.bodyMed,
    fontSize: 15,
    color: SL.muted,
    letterSpacing: 0.5,
    textAlign: 'center',
    opacity: 0.7,
  },

  // ── Section labels ───────────────────────────────────────────────────────────

  sectionLabel: {
    fontFamily: F.bodyMed,
    fontSize: 13,
    color: SL.muted,
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 12,
    marginHorizontal: 16,
  },

  // ── Main quest chains ────────────────────────────────────────────────────────

  chainBlock: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  chainLabel: {
    fontFamily: F.heading,
    fontSize: 14,
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
  questNameDone: { color: SL.green },
  questNameMuted: { color: SL.muted },
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

  // ── Side quests ──────────────────────────────────────────────────────────────

  sideGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 10,
  },
  sideCard: {
    width: '47%',
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    padding: 16,
    gap: 8,
    justifyContent: 'space-between',
    minHeight: 90,
  },
  sideCardDone: {
    backgroundColor: 'rgba(76,175,80,0.08)',
    borderColor: SL.green,
  },
  sideName: {
    fontFamily: F.heading,
    fontSize: 16,
    color: SL.text,
    letterSpacing: 1,
  },
  sideNameDone: { color: SL.green },
  sideDone: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: SL.green,
    letterSpacing: 2,
  },
  sideReward: {
    fontFamily: F.bodyMed,
    fontSize: 13,
    color: SL.accent,
    letterSpacing: 1.5,
  },

  // ── Total ────────────────────────────────────────────────────────────────────

  totalCard: {
    marginHorizontal: 16,
    marginTop: 28,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    padding: 20,
    alignItems: 'center',
    gap: 6,
  },
  totalTitle: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.accent,
    letterSpacing: 3,
  },
  totalBreakdown: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.muted,
    letterSpacing: 1,
    textAlign: 'center',
  },
});
