import React, { useCallback, useState, useEffect, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity,
  Animated, Easing,
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

// ─── Animated tier divider ──────────────────────────────────────────────────
// Slides + fades in on mount with a slow looping glow, marking the Tier 1 → 2
// boundary in the side-quest list as a deliberate gate.

function TierDivider({ label }) {
  const reveal = useRef(new Animated.Value(0)).current;
  const glow   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(reveal, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reveal, glow]);

  const ruleOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.9] });

  return (
    <Animated.View
      style={[
        styles.tierRow,
        {
          opacity: reveal,
          transform: [
            { translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
          ],
        },
      ]}
    >
      <Animated.View style={[styles.tierRule, { opacity: ruleOpacity }]} />
      <Text style={styles.tierText}>{label}</Text>
      <Animated.View style={[styles.tierRule, { opacity: ruleOpacity }]} />
    </Animated.View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SkillsScreen({ navigation }) {
  const [profile,     setProfile]     = useState(null);
  const [classData,   setClassData]   = useState(null);
  const [quests,      setQuests]      = useState([]);
  const [completions, setCompletions] = useState(new Set());
  const [exp,         setExp]         = useState(0);
  const [loading,     setLoading]     = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profileData } = await supabase
        .from('profiles')
        .select('full_name, class_id, total_exp, prestige_count')
        .eq('id', user.id)
        .single();

      if (!profileData) return;
      setProfile(profileData);

      if (!profileData.class_id) { setLoading(false); return; }

      const [classRes, questsRes, completionsRes, expRes] = await Promise.all([
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
        supabase
          .from('workout_override_workouts')
          .select('*', { count: 'exact', head: true })
          .eq('student_id', user.id)
          .eq('completed', true),
      ]);

      setClassData(classRes.data ?? null);
      setQuests(questsRes.data ?? []);
      setCompletions(new Set((completionsRes.data ?? []).map(c => c.quest_id)));
      setExp(expRes.count ?? 0);
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

  const lvl      = computeLvlFromData(quests, completions);
  const prestige = profile?.prestige_count ?? 0;
  const lvlPct   = Math.min(lvl / 100, 1);

  // Build one entry per unique chain
  const mainChains = [...new Set(
    quests.filter(q => q.quest_type === 'main').map(q => q.chain).filter(Boolean)
  )];
  const sideChains = [...new Set(
    quests.filter(q => q.quest_type === 'side').map(q => q.chain).filter(Boolean)
  )];

  // Classify side-quest chains by tier: a chain is Tier 2 when any of its quests
  // is gated by a prerequisite in a DIFFERENT chain (the cross-chain gate).
  const sideQuests   = quests.filter(q => q.quest_type === 'side');
  const chainOfQuest = new Map(quests.map(q => [q.id, q.chain]));
  const isTier2Chain = (chain) =>
    sideQuests.some(q =>
      q.chain === chain &&
      (q.prerequisites ?? []).some(pid => {
        const pc = chainOfQuest.get(pid);
        return pc && pc !== chain;
      }),
    );
  const tier1SideChains = sideChains.filter(c => !isTier2Chain(c));
  const tier2SideChains = sideChains.filter(c =>  isTier2Chain(c));

  function chainStats(chain, questType) {
    const chainQuests = quests.filter(q => q.chain === chain && q.quest_type === questType);
    const completed   = chainQuests.filter(q => completions.has(q.id));
    return {
      total:     chainQuests.length,
      completed: completed.length,
      earnedLvl: completed.reduce((s, q) => s + (q.lvl_reward ?? 0), 0),
    };
  }

  function openTree(chain, questType) {
    navigation.navigate('QuestTree', {
      classId:   profile?.class_id,
      chain,
      questType,
    });
  }

  const renderSideCard = (chain) => {
    const { total, completed, earnedLvl } = chainStats(chain, 'side');
    return (
      <TouchableOpacity
        key={chain}
        style={styles.chainCard}
        onPress={() => openTree(chain, 'side')}
        activeOpacity={0.75}
      >
        <View style={styles.chainCardInner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.chainCardTitle}>{chain.toUpperCase()}</Text>
            <Text style={styles.chainCardMeta}>
              {completed}/{total} unlocked · +{earnedLvl} LVL
            </Text>
          </View>
          <Text style={styles.chainCardChevron}>›</Text>
        </View>
      </TouchableOpacity>
    );
  };

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

        <View style={styles.progressBarContainer}>
          <View style={styles.progressBarBg}>
            <View style={[
              styles.progressBarFill,
              { width: `${Math.min(lvl, 100)}%` },
              lvl >= 80 && { backgroundColor: SL.gold },
            ]} />
          </View>
          <View style={[styles.prestigeMarker, { left: '80%' }]}>
            <View style={styles.prestigeMarkerLine} />
            <Text style={styles.prestigeMarkerLabel}>80</Text>
          </View>
        </View>
        <Text style={[styles.barLabel, lvl >= 80 && { color: SL.gold }]}>
          {lvl >= 80
            ? '⭐ PRESTIGE UNLOCKED'
            : `${lvl} / 100 · ${80 - lvl > 0 ? `${80 - lvl} LVL until prestige` : 'prestige available'}`
          }
        </Text>

        <View style={styles.headerDivider} />
      </View>

      {/* ── Prestige banner ── */}
      {lvl >= 80 && (
        <View style={styles.prestigeBanner}>
          <Text style={styles.prestigeBannerTitle}>⚡ PRESTIGE AVAILABLE</Text>
          <Text style={styles.prestigeBannerSub}>
            You have reached LVL {lvl}. Contact your coach to advance to the next class.
          </Text>
        </View>
      )}

      {/* ── No class ── */}
      {!classData ? (
        <View style={styles.noClass}>
          <Text style={styles.noClassText}>NO CLASS ASSIGNED YET</Text>
          <Text style={styles.noClassSub}>Your coach will assign your class.</Text>
        </View>
      ) : (
        <>
          {/* ── Main Quest cards ── */}
          {mainChains.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>MAIN QUESTS</Text>
              {mainChains.map(chain => {
                const { total, completed, earnedLvl } = chainStats(chain, 'main');
                return (
                  <TouchableOpacity
                    key={chain}
                    style={styles.chainCard}
                    onPress={() => openTree(chain, 'main')}
                    activeOpacity={0.75}
                  >
                    <View style={styles.chainCardInner}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.chainCardTitle}>{chain.toUpperCase()}</Text>
                        <Text style={styles.chainCardMeta}>
                          {completed}/{total} unlocked · +{earnedLvl} LVL
                        </Text>
                      </View>
                      <Text style={styles.chainCardChevron}>›</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </>
          )}

          {/* ── Side Quest cards — grouped by tier ── */}
          {sideChains.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: 28 }]}>SIDE QUESTS</Text>

              {tier2SideChains.length > 0 && <TierDivider label="TIER I" />}
              {tier1SideChains.map(renderSideCard)}

              {tier2SideChains.length > 0 && (
                <>
                  <TierDivider label="TIER II" />
                  {tier2SideChains.map(renderSideCard)}
                </>
              )}
            </>
          )}
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
  progressBarContainer: {
    position: 'relative',
    height: 20,
    justifyContent: 'center',
    width: '100%',
  },
  progressBarBg: {
    height: 6,
    backgroundColor: SL.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: SL.accent,
    borderRadius: 3,
  },
  prestigeMarker: {
    position: 'absolute',
    alignItems: 'center',
    top: 0,
  },
  prestigeMarkerLine: {
    width: 2,
    height: 14,
    backgroundColor: SL.gold,
    borderRadius: 1,
  },
  prestigeMarkerLabel: {
    fontFamily: F.bodyMed,
    fontSize: 10,
    color: SL.gold,
    letterSpacing: 1,
    marginTop: 2,
  },
  barLabel: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: SL.muted,
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: 6,
  },
  prestigeBanner: {
    marginHorizontal: 16,
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderWidth: 1.5,
    borderColor: SL.gold,
    borderRadius: 4,
    backgroundColor: 'rgba(255,215,0,0.06)',
  },
  prestigeBannerTitle: {
    fontFamily: F.heading,
    fontSize: 20,
    color: SL.gold,
    letterSpacing: 3,
    textAlign: 'center',
    marginBottom: 6,
  },
  prestigeBannerSub: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.gold,
    opacity: 0.8,
    letterSpacing: 0.5,
    textAlign: 'center',
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

  // ── Animated tier divider (side-quest tiers) ─────────────────────────────────

  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 16,
    gap: 16,
  },
  tierRule: {
    flex: 1,
    height: 4,
    backgroundColor: SL.accent,
    borderRadius: 2,
  },
  tierText: {
    fontFamily: F.heading,
    fontSize: 28,
    color: SL.accent,
    letterSpacing: 7,
    textAlign: 'center',
  },

  // ── Chain cards ──────────────────────────────────────────────────────────────

  chainCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  chainCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chainCardTitle: {
    fontFamily: F.heading,
    fontSize: 20,
    color: SL.text,
    letterSpacing: 3,
    marginBottom: 4,
  },
  chainCardMeta: {
    fontFamily: F.bodyMed,
    fontSize: 13,
    color: SL.muted,
    letterSpacing: 1,
  },
  chainCardChevron: {
    fontFamily: F.heading,
    fontSize: 28,
    color: SL.accent,
    marginLeft: 12,
    opacity: 0.7,
  },
});
