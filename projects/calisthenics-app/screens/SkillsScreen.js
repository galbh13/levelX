import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Modal,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { computeLvlFromData, computeClassMaxFromData } from '../lib/computeLvl';
import { evaluatePrestige, tier2SideChains, prestigeStars } from '../lib/prestige';
import { F } from '../constants/fonts';
import { ShimmerText, ShimmerFill, BLUE, GOLD } from '../components/Shimmer';

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

export default function SkillsScreen({ navigation }) {
  const [profile,     setProfile]     = useState(null);
  const [classData,   setClassData]   = useState(null);
  const [quests,      setQuests]      = useState([]);
  const [completions, setCompletions] = useState(new Set());
  const [loading,     setLoading]     = useState(true);

  // Self-service class management
  const [userId,      setUserId]      = useState(null);
  const [allClasses,  setAllClasses]  = useState([]);
  const [classListOpen, setClassListOpen] = useState(false);
  const [assigning,   setAssigning]   = useState(false);
  const [showPrestige, setShowPrestige] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const [{ data: profileData }, { data: classesData }] = await Promise.all([
        supabase
          .from('profiles')
          .select('full_name, class_id, prestige_count')
          .eq('id', user.id)
          .single(),
        supabase
          .from('classes')
          .select('*')
          .order('order_index'),
      ]);

      if (!profileData) return;
      setProfile(profileData);
      setAllClasses(classesData ?? []);

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

  // ── Self-service: assign own class ──────────────────────────────────────────

  async function handleAssignClass(cls) {
    if (!userId) return;
    setAssigning(true);
    const { error } = await supabase
      .from('profiles')
      .update({ class_id: cls.id })
      .eq('id', userId);
    setAssigning(false);
    setClassListOpen(false);
    if (error) { console.error('[SkillsScreen] assign class:', error); return; }
    setLoading(true);
    fetchData();
  }

  // ── Self-service: prestige (advance to next class) ──────────────────────────
  // Quest completions are intentionally preserved across prestige so computed
  // per-class LVL auto-restores if the player ever returns to a class.

  async function handlePrestige() {
    if (!userId) return;
    try {
      const currentClass = allClasses.find(c => c.id === profile?.class_id);
      const nextClass    = allClasses.find(c => c.order_index === (currentClass?.order_index ?? 0) + 1);

      // Already at the final class — there's nothing to advance into, so don't
      // touch anything (this is what used to inflate the counter past the class count).
      if (!nextClass) {
        alert('You are already at the highest class.');
        return;
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          prestige_count: (profile?.prestige_count ?? 0) + 1, // legacy history; stars derive from class
          class_id:       nextClass.id,
        })
        .eq('id', userId);
      if (error) throw error;

      setLoading(true);
      fetchData();
    } catch (e) {
      console.error('[SkillsScreen] prestige:', e);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={SL.accent} />
      </View>
    );
  }

  const lvl        = computeLvlFromData(quests, completions);
  // Per-class scaling: max is the sum of every quest reward; the prestige line is
  // a configurable column (falls back to 80 for classes that predate it).
  const maxLvl     = computeClassMaxFromData(quests);
  const prestigeAt = classData?.prestige_at ?? 80;
  const lvlPct     = maxLvl > 0 ? Math.min(lvl / maxLvl, 1) : 0;
  const prestigePct = maxLvl > 0 ? Math.min((prestigeAt / maxLvl) * 100, 100) : 0;

  // Prestige is gated on THREE kinds of requirement (level + main quests +
  // 1 Tier II skill), evaluated declaratively per class. `prestigeReady.ok`
  // replaces the old `lvl >= prestigeAt` check everywhere below.
  const prestigeReady = evaluatePrestige({
    orderIndex:   classData?.order_index ?? 0,
    quests,
    completedIds: completions,
    lvl,
    prestigeAt,
  });

  // Stars = classes overcome (current order_index, +1 if the final class is fully met).
  const prestige = prestigeStars({
    orderIndex:    classData?.order_index ?? 0,
    classCount:    allClasses.length,
    finalClassMet: prestigeReady.ok,
  });

  // Build one entry per unique chain
  const mainChains = [...new Set(
    quests.filter(q => q.quest_type === 'main').map(q => q.chain).filter(Boolean)
  )];
  const sideChains = [...new Set(
    quests.filter(q => q.quest_type === 'side').map(q => q.chain).filter(Boolean)
  )];

  // Classify side-quest chains by tier (shared rule with lib/prestige): a chain
  // is Tier 2 when any of its quests is gated by a prerequisite in a DIFFERENT
  // chain (the cross-chain gate).
  const tier2Chains     = new Set(tier2SideChains(quests));
  const tier1SideChains = sideChains.filter(c => !tier2Chains.has(c));
  const tier2SideCh     = sideChains.filter(c =>  tier2Chains.has(c));

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

  const renderChainCard = (chain, questType) => {
    const { total, completed, earnedLvl } = chainStats(chain, questType);
    const complete = total > 0 && completed === total;
    return (
      <TouchableOpacity
        key={chain}
        style={styles.chainCard}
        onPress={() => openTree(chain, questType)}
        activeOpacity={0.75}
      >
        <View style={styles.chainCardInner}>
          <View style={{ flex: 1 }}>
            {complete ? (
              <ShimmerText text={chain.toUpperCase()} style={styles.chainCardTitle} colors={BLUE} direction="ltr" active />
            ) : (
              <Text style={styles.chainCardTitle}>{chain.toUpperCase()}</Text>
            )}
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

        <ShimmerText text={`LVL ${lvl}`} style={styles.lvlNumber} active={prestigeReady.ok} />

        <View style={styles.progressBarContainer}>
          <View style={styles.progressBarBg}>
            <ShimmerFill
              style={[styles.progressBarFill, { width: `${lvlPct * 100}%` }]}
              active={prestigeReady.ok}
            />
          </View>
          <View style={[styles.prestigeMarker, { left: `${prestigePct}%` }]}>
            <View style={styles.prestigeMarkerGem} />
            <View style={styles.prestigeMarkerStem} />
            <View style={styles.prestigeMarkerBadge}>
              <Text style={styles.prestigeMarkerLabel}>{prestigeAt}</Text>
            </View>
          </View>
        </View>
        <Text style={[styles.barLabel, prestigeReady.ok && { color: SL.gold }]}>
          {prestigeReady.ok
            ? '⭐ PRESTIGE UNLOCKED'
            : lvl >= prestigeAt
              ? `${lvl} / ${maxLvl} · finish remaining requirements`
              : `${lvl} / ${maxLvl} · ${prestigeAt - lvl} LVL until prestige`
          }
        </Text>

        <View style={styles.headerDivider} />
      </View>

      {/* ── Class management + prestige status (same row) ── */}
      <View style={styles.classRow}>
        <View style={styles.classCol}>
          <TouchableOpacity
            style={styles.manageClassBtn}
            onPress={() => setClassListOpen(o => !o)}
            activeOpacity={0.85}
          >
            <Text style={styles.manageClassBtnText}>
              {classData ? '⚙ CHANGE CLASS' : '+ ASSIGN CLASS'}
            </Text>
            <Text style={styles.manageClassChevron}>{classListOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {/* Inline class list (fills the space; replaces the old modal) */}
          {classListOpen && (
            <View style={styles.classList}>
              {allClasses.map(cls => {
                const selected = cls.id === profile?.class_id;
                return (
                  <TouchableOpacity
                    key={cls.id}
                    style={[styles.classOption, selected && styles.classOptionSelected]}
                    onPress={() => handleAssignClass(cls)}
                    disabled={assigning}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.classOptionName, selected && styles.classOptionNameSelected]}>
                      {cls.name}{selected ? '  ✓' : ''}
                    </Text>
                    {cls.description ? (
                      <Text style={styles.classOptionDesc}>{cls.description}</Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {classData && (
        prestigeReady.ok ? (
          <View style={styles.prestigeBanner}>
            <View style={styles.prestigeBannerTitleWrap}>
              <ShimmerText
                text="⚡ PRESTIGE AVAILABLE"
                style={styles.prestigeBannerTitle}
                colors={GOLD}
                direction="ltr"
                active
              />
            </View>
            <Text style={styles.prestigeBannerSub}>
              All requirements met. Advance to the next class — your quest history is kept.
            </Text>
            <TouchableOpacity
              style={styles.prestigeActionBtn}
              onPress={() => setShowPrestige(true)}
              activeOpacity={0.85}
            >
              <ShimmerFill style={styles.prestigeActionGlow} colors={GOLD} active />
              <ShimmerText
                text="⚡ PRESTIGE NOW"
                style={styles.prestigeActionText}
                colors={GOLD}
                direction="ltr"
                active
              />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.reqCard}>
            <Text style={styles.reqCardTitle}>PRESTIGE REQUIREMENTS</Text>
            {prestigeReady.checks.map(c => (
              <View key={c.key}>
                <View style={styles.reqRow}>
                  <Text style={[styles.reqMark, c.ok ? styles.reqMarkOk : styles.reqMarkPending]}>
                    {c.ok ? '✓' : '○'}
                  </Text>
                  <Text style={[styles.reqLabel, c.ok && styles.reqLabelOk]}>{c.label}</Text>
                  <Text style={[styles.reqDetail, c.ok && styles.reqLabelOk]}>{c.detail}</Text>
                </View>

                {/* Per-requirement breakdown (main quests): exactly what's left */}
                {c.items?.map((it, i) => (
                  <View key={i} style={styles.reqSubRow}>
                    <Text style={[styles.reqSubMark, it.ok ? styles.reqMarkOk : styles.reqMarkPending]}>
                      {it.ok ? '✓' : '○'}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.reqSubLabel, it.ok && styles.reqLabelOk]}>{it.label}</Text>
                      {!it.ok && it.remaining?.length > 0 && (
                        <Text style={styles.reqRemaining}>
                          Still needed: {it.remaining.join(' · ')}
                        </Text>
                      )}
                    </View>
                    {it.detail ? (
                      <Text style={[styles.reqSubDetail, it.ok && styles.reqLabelOk]}>{it.detail}</Text>
                    ) : null}
                  </View>
                ))}
              </View>
            ))}
          </View>
        )
        )}
      </View>

      {/* ── No class ── */}
      {!classData ? (
        <View style={styles.noClass}>
          <Text style={styles.noClassText}>NO CLASS ASSIGNED YET</Text>
          <Text style={styles.noClassSub}>Tap ASSIGN CLASS above to begin your journey.</Text>
        </View>
      ) : (
        <View style={styles.questColumns}>
          {/* Main quests — left column */}
          <View style={styles.questColumn}>
            <Text style={styles.columnLabel}>MAIN QUESTS</Text>
            {mainChains.map(chain => renderChainCard(chain, 'main'))}
          </View>

          <View style={styles.columnDivider} />

          {/* Tier I side quests — middle column */}
          <View style={styles.questColumn}>
            <Text style={styles.columnLabel}>TIER I</Text>
            {tier1SideChains.map(chain => renderChainCard(chain, 'side'))}
          </View>

          <View style={styles.columnDivider} />

          {/* Tier II side quests — right column */}
          <View style={styles.questColumn}>
            <Text style={styles.columnLabel}>TIER II</Text>
            {tier2SideCh.map(chain => renderChainCard(chain, 'side'))}
          </View>
        </View>
      )}

      <View style={{ height: 56 }} />

      {/* ── Prestige confirm modal ── */}
      <Modal
        visible={showPrestige}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPrestige(false)}
      >
        <View style={[styles.modalOverlay, { justifyContent: 'center', paddingHorizontal: 24 }]}>
          <View style={styles.confirmBox}>
            <View style={styles.prestigeBannerTitleWrap}>
              <ShimmerText text="PRESTIGE?" style={styles.modalTitle} colors={GOLD} direction="ltr" active />
            </View>
            <Text style={styles.confirmText}>
              Advance to the next class? Your quest history will be kept.
            </Text>
            <View style={styles.confirmButtons}>
              <TouchableOpacity
                style={styles.confirmCancel}
                onPress={() => setShowPrestige(false)}
              >
                <Text style={styles.confirmCancelText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmOk}
                onPress={() => { setShowPrestige(false); handlePrestige(); }}
              >
                <ShimmerFill style={StyleSheet.absoluteFill} colors={GOLD} active />
                <Text style={styles.confirmOkText}>PRESTIGE</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg },
  // Centered, capped width — matches the Home page so the two read consistently.
  // One big ice-glow frame wraps the whole body (header + panels + quest columns).
  body: {
    width: '100%',
    maxWidth: 1440,
    alignSelf: 'center',
    marginTop: 16,
    marginBottom: 28,
    paddingHorizontal: 10,
    paddingBottom: 40,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 18,
    backgroundColor: SL.bg,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
  },

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
    fontSize: 32,
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
    fontSize: 22,
    color: SL.gold,
    letterSpacing: 2,
  },
  prestigeStars: {
    fontSize: 30,
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
  // Prestige threshold marker — a glowing gold gem sitting on the bar, a short
  // stem, and the level in a gold pill. width:0 keeps it centered exactly on the
  // threshold point (children center on the absolute left% line).
  prestigeMarker: {
    position: 'absolute',
    top: 4,
    width: 0,
    alignItems: 'center',
  },
  prestigeMarkerGem: {
    width: 11,
    height: 11,
    backgroundColor: SL.gold,
    borderRadius: 2,
    transform: [{ rotate: '45deg' }],
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  prestigeMarkerStem: {
    width: 2,
    height: 6,
    marginTop: 1,
    borderRadius: 1,
    backgroundColor: SL.gold,
    opacity: 0.5,
  },
  prestigeMarkerBadge: {
    marginTop: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: SL.gold,
    borderRadius: 4,
    backgroundColor: 'rgba(255,215,0,0.08)',
  },
  prestigeMarkerLabel: {
    fontFamily: F.bodyMed,
    fontSize: 15,
    color: SL.gold,
    letterSpacing: 1,
  },
  barLabel: {
    fontFamily: F.bodyMed,
    fontSize: 22,
    color: SL.muted,
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: 6,
  },
  classRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    marginTop: 16,
  },
  classCol: { flex: 1, gap: 10 },
  manageClassBtn: {
    alignSelf: 'stretch',
    minHeight: 46,
    flexDirection: 'row',
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: 'rgba(74,158,191,0.06)',
    // Soft ice-glow frame, matching the Home page panels.
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  manageClassBtnText: {
    fontFamily: F.heading,
    fontSize: 24,
    color: SL.accent,
    letterSpacing: 2,
    textAlign: 'center',
  },
  manageClassChevron: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.accent,
  },
  classList: {
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 12,
    backgroundColor: SL.panel,
    padding: 10,
  },

  prestigeBanner: {
    flex: 2,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderWidth: 1.5,
    borderColor: SL.gold,
    borderRadius: 12,
    backgroundColor: 'rgba(255,215,0,0.06)',
    // Soft gold glow frame, matching the Home page panels.
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
  },
  prestigeActionBtn: {
    marginTop: 12,
    height: 46,
    borderWidth: 1.5,
    borderColor: SL.gold,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,215,0,0.1)',
    overflow: 'hidden',
  },
  // Moving gold glow behind the PRESTIGE NOW label — kept low-opacity so the
  // gold text stays readable over it (same shimmer as the LVL gauge).
  prestigeActionGlow: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.25,
  },
  prestigeBannerTitleWrap: {
    alignItems: 'center',
  },
  prestigeActionText: {
    fontFamily: F.heading,
    fontSize: 32,
    color: SL.gold,
    letterSpacing: 3,
  },
  prestigeBannerTitle: {
    fontFamily: F.heading,
    fontSize: 30,
    color: SL.gold,
    letterSpacing: 3,
    textAlign: 'center',
    marginBottom: 6,
  },
  prestigeBannerSub: {
    fontFamily: F.bodyMed,
    fontSize: 24,
    color: SL.gold,
    opacity: 0.8,
    letterSpacing: 0.5,
    textAlign: 'center',
  },

  // ── Prestige requirements checklist (shown until all gates pass) ─────────────
  reqCard: {
    flex: 2,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 12,
    backgroundColor: SL.panel,
    // Soft ice-glow frame, matching the Home page panels.
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
  },
  reqCardTitle: {
    fontFamily: F.heading,
    fontSize: 26,
    color: SL.accent,
    letterSpacing: 3,
    marginBottom: 12,
  },
  reqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 12,
  },
  reqMark: {
    fontFamily: F.heading,
    fontSize: 26,
    width: 26,
    textAlign: 'center',
  },
  reqMarkOk:      { color: SL.accent },
  reqMarkPending: { color: SL.muted },
  reqLabel: {
    flex: 1,
    fontFamily: F.bodyMed,
    fontSize: 24,
    color: SL.text,
    letterSpacing: 0.5,
  },
  reqLabelOk: { color: SL.accent },
  reqDetail: {
    fontFamily: F.bodyMed,
    fontSize: 22,
    color: SL.muted,
    letterSpacing: 0.5,
  },

  // Indented per-requirement breakdown under a check (e.g. each main-quest group)
  reqSubRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 4,
    paddingLeft: 26,
    gap: 10,
  },
  reqSubMark: {
    fontFamily: F.heading,
    fontSize: 22,
    width: 22,
    textAlign: 'center',
  },
  reqSubLabel: {
    fontFamily: F.bodyMed,
    fontSize: 22,
    color: SL.text,
    letterSpacing: 0.5,
    opacity: 0.92,
  },
  reqSubDetail: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.muted,
    letterSpacing: 0.5,
  },
  reqRemaining: {
    fontFamily: F.bodyMed,
    fontSize: 19,
    color: SL.muted,
    letterSpacing: 0.3,
    marginTop: 2,
    lineHeight: 24,
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
    fontSize: 30,
    color: SL.muted,
    letterSpacing: 3,
    textAlign: 'center',
  },
  noClassSub: {
    fontFamily: F.bodyMed,
    fontSize: 25,
    color: SL.muted,
    letterSpacing: 0.5,
    textAlign: 'center',
    opacity: 0.7,
  },

  // ── Quest columns (main / tier I / tier II, side by side) ────────────────────

  questColumns: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 18,
    paddingHorizontal: 16,
    marginTop: 20,
  },
  questColumn: { flex: 1 },
  // Glowing ice-accent hairline between columns. `alignSelf: stretch` makes it
  // run the full height of the tallest column; the soft shadow gives the glow.
  columnDivider: {
    alignSelf: 'stretch',
    width: 2,
    borderRadius: 1,
    backgroundColor: SL.accent,
    opacity: 0.3,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 6,
  },
  columnLabel: {
    fontFamily: F.heading,
    fontSize: 30,
    color: SL.accent,
    letterSpacing: 3,
    textAlign: 'center',
    marginBottom: 14,
  },

  // ── Chain cards ──────────────────────────────────────────────────────────────

  chainCard: {
    marginBottom: 10,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 16,
    // Soft ice-glow frame, matching the Home page cards.
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
  },
  chainCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chainCardTitle: {
    fontFamily: F.heading,
    fontSize: 35,
    color: SL.text,
    letterSpacing: 3,
    marginBottom: 4,
  },
  chainCardMeta: {
    fontFamily: F.bodyMed,
    fontSize: 22,
    color: SL.muted,
    letterSpacing: 1,
  },
  chainCardChevron: {
    fontFamily: F.heading,
    fontSize: 34,
    color: SL.accent,
    marginLeft: 12,
    opacity: 0.7,
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
    fontSize: 30,
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
    fontSize: 30,
    color: SL.text,
    letterSpacing: 2,
  },
  classOptionNameSelected: { color: SL.gold },
  classOptionDesc: {
    fontFamily: F.bodyMed,
    fontSize: 24,
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
    fontSize: 26,
    color: SL.muted,
    letterSpacing: 2,
  },

  // ── Prestige confirm modal ──────────────────────────────────────────────────

  confirmBox: {
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.gold,
    borderRadius: 8,
    padding: 24,
    gap: 16,
  },
  confirmText: {
    fontFamily: F.bodyMed,
    fontSize: 22,
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
    height: 44,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmCancelText: {
    fontFamily: F.bodyMed,
    fontSize: 24,
    color: SL.muted,
    letterSpacing: 2,
  },
  confirmOk: {
    flex: 1,
    height: 44,
    backgroundColor: SL.gold,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  confirmOkText: {
    fontFamily: F.heading,
    fontSize: 24,
    color: SL.bg,
    letterSpacing: 2,
  },
});
