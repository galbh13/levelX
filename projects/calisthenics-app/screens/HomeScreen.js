import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { F } from '../constants/fonts';
import { supabase } from '../lib/supabase';
import { computeLvl, computeClassMax } from '../lib/computeLvl';
import { evaluatePrestige, prestigeStars } from '../lib/prestige';
import { israelToday } from '../lib/israelDate';
import { materializeDay } from '../lib/schedule';
import { ShimmerText, ShimmerFill, GOLD } from '../components/Shimmer';

const SL = {
  bg:     '#050912',
  panel:  '#070d1a',
  border: '#1a3a5c',
  accent: '#4A9EBF',
  text:   '#E8F4FF',
  muted:  '#4a6a8a',
  green:  '#4CAF50',
  gold:   '#FFD700',
};

const TODAY = new Date().toISOString().split('T')[0];

export default function HomeScreen({ navigation }) {
  const [profile,        setProfile]        = useState(null);
  const [className,      setClassName]      = useState(null);
  const [workouts,       setWorkouts]       = useState([]);
  const [lvl,            setLvl]            = useState(0);
  const [maxLvl,         setMaxLvl]         = useState(0);
  const [prestigeReady,  setPrestigeReady]  = useState(false);
  const [stars,          setStars]          = useState(0);
  const [dailyQuests,    setDailyQuests]    = useState([]);
  const [doneTodayIds,   setDoneTodayIds]   = useState(new Set());
  const [loading,        setLoading]        = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profileData } = await supabase
        .from('profiles')
        .select('full_name, prestige_count, class_id')
        .eq('id', user.id)
        .single();

      if (!profileData) return;
      setProfile(profileData);

      const israelDay = israelToday();
      const todayDow  = new Date(TODAY + 'T00:00:00').getDay();
      const [classRes, overridesRes, templateRes, lvlVal, dqRes, dqDoneRes, maxLvlVal, questsRes, complRes, classCountRes] = await Promise.all([
        profileData.class_id
          ? supabase.from('classes').select('name, prestige_at, order_index').eq('id', profileData.class_id).single()
          : Promise.resolve({ data: null }),
        supabase
          .from('workout_override_workouts')
          .select('id, workout_id, completed')
          .eq('student_id', user.id)
          .eq('specific_date', TODAY),
        supabase
          .from('weekly_workout_template')
          .select('workout_id')
          .eq('student_id', user.id)
          .eq('day_of_week', todayDow),
        computeLvl(user.id, profileData.class_id),
        supabase
          .from('daily_quests')
          .select('id, title')
          .eq('student_id', user.id)
          .eq('active', true)
          .order('created_at', { ascending: true }),
        supabase
          .from('daily_quest_completions')
          .select('daily_quest_id')
          .eq('student_id', user.id)
          .eq('completion_date', israelDay),
        computeClassMax(profileData.class_id),
        profileData.class_id
          ? supabase.from('class_quests').select('id, name, chain, quest_type, prerequisites').eq('class_id', profileData.class_id)
          : Promise.resolve({ data: [] }),
        supabase.from('student_quest_completions').select('quest_id').eq('student_id', user.id),
        supabase.from('classes').select('id', { count: 'exact', head: true }),
      ]);

      setClassName(classRes.data?.name ?? null);
      setLvl(lvlVal ?? 0);
      setMaxLvl(maxLvlVal ?? 0);

      // Gold bar = prestige actually AVAILABLE (full gate), not just the level
      // line. Same evaluator SkillsScreen uses.
      const prestigeEval = evaluatePrestige({
        orderIndex:   classRes.data?.order_index ?? 0,
        quests:       questsRes.data ?? [],
        completedIds: new Set((complRes.data ?? []).map(c => c.quest_id)),
        lvl:          lvlVal ?? 0,
        prestigeAt:   classRes.data?.prestige_at ?? 80,
      });
      setPrestigeReady(prestigeEval.ok);
      // Stars = classes overcome (current order_index, +1 if the final class is fully met).
      setStars(prestigeStars({
        orderIndex:    classRes.data?.order_index ?? 0,
        classCount:    classCountRes.count ?? null,
        finalClassMet: prestigeEval.ok,
      }));
      setDailyQuests(dqRes.data ?? []);
      setDoneTodayIds(new Set((dqDoneRes.data ?? []).map(r => r.daily_quest_id)));

      // Per-date override wins for today; otherwise fall back to the weekly skeleton.
      const overrides = overridesRes.data ?? [];
      const resolved = overrides.length > 0
        ? overrides.map(o => ({ workout_id: o.workout_id, overrideId: o.id, completed: o.completed ?? false }))
        : (templateRes.data ?? []).map(t => ({ workout_id: t.workout_id, overrideId: null, completed: false }));

      if (resolved.length === 0) { setWorkouts([]); setLoading(false); return; }

      const workoutIds = [...new Set(resolved.map(r => r.workout_id))];
      const { data: workoutRows } = await supabase
        .from('workouts')
        .select('id, title, purpose')
        .in('id', workoutIds);

      const workoutsById = Object.fromEntries((workoutRows ?? []).map(w => [w.id, w]));
      const merged = resolved
        .map(r => ({ ...workoutsById[r.workout_id], overrideId: r.overrideId, completed: r.completed }))
        .filter(w => w.id);

      setWorkouts(merged);
    } catch (e) {
      console.error('[HomeScreen] fetchData:', e);
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => {
    fetchData();
  }, [fetchData]));

  async function toggleDailyQuest(quest) {
    const isDone = doneTodayIds.has(quest.id);
    const today = israelToday();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Optimistic update
    const nextDone = new Set(doneTodayIds);
    if (isDone) nextDone.delete(quest.id); else nextDone.add(quest.id);
    setDoneTodayIds(nextDone);

    if (isDone) {
      const { error } = await supabase
        .from('daily_quest_completions')
        .delete()
        .eq('daily_quest_id', quest.id)
        .eq('student_id', user.id)
        .eq('completion_date', today);
      if (error) { console.error('[HomeScreen] uncheck daily quest:', error); await fetchData(); }
    } else {
      const { error } = await supabase
        .from('daily_quest_completions')
        .insert({
          daily_quest_id: quest.id,
          student_id: user.id,
          completion_date: today,
        });
      if (error) { console.error('[HomeScreen] check daily quest:', error); await fetchData(); }
    }
  }

  // Toggle a workout's completion straight from Home (same write WorkoutsScreen uses).
  async function toggleWorkout(workout) {
    // Real override row → just flip completed (optimistic).
    if (workout.overrideId) {
      const next = !workout.completed;
      setWorkouts(prev => prev.map(w =>
        w.overrideId === workout.overrideId ? { ...w, completed: next } : w
      ));
      const { error } = await supabase
        .from('workout_override_workouts')
        .update({ completed: next })
        .eq('id', workout.overrideId);
      if (error) {
        console.error('[HomeScreen] toggleWorkout:', error);
        setWorkouts(prev => prev.map(w =>
          w.overrideId === workout.overrideId ? { ...w, completed: !next } : w
        ));
      }
      return;
    }

    // Template-derived day — materialize today (keeping siblings), then mark done.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await materializeDay({
      studentId: user.id,
      coachId:   user.id,
      dateStr:   TODAY,
      templateWorkoutIds: workouts.map(w => w.id),
    });
    const { error } = await supabase
      .from('workout_override_workouts')
      .update({ completed: true })
      .eq('student_id', user.id)
      .eq('specific_date', TODAY)
      .eq('workout_id', workout.id);
    if (error) console.error('[HomeScreen] toggleWorkout materialize:', error);
    await fetchData();
  }

  const allDone      = workouts.length > 0 && workouts.every(w => w.completed);
  const lvlPct       = maxLvl > 0 ? Math.min(lvl / maxLvl, 1) : 0;
  const lvlPctLabel  = Math.round(lvlPct * 100);
  const toNext       = Math.max(0, maxLvl - lvl);
  const missionsDone = workouts.filter(w => w.completed).length;
  const dqDone       = dailyQuests.filter(q => doneTodayIds.has(q.id)).length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.body}>

      {/* Sign Out */}
      <TouchableOpacity
        style={styles.signOutBtn}
        activeOpacity={0.8}
        onPress={() => supabase.auth.signOut()}
      >
        <View style={styles.powerIcon}>
          <View style={styles.powerRing} />
          <View style={styles.powerStem} />
        </View>
        <Text style={styles.signOutText}>SIGN OUT</Text>
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator size="large" color={SL.accent} style={{ marginTop: 80 }} />
      ) : (
        <>
          {/* ── Hero ── */}
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>◆  PLAYER PROFILE  ◆</Text>
            <Text style={styles.playerName}>{profile?.full_name?.toUpperCase() ?? '—'}</Text>
            {className && (
              <View style={styles.classRow}>
                <View style={styles.classLine} />
                <Text style={styles.className}>{className.toUpperCase()}</Text>
                <View style={styles.classLine} />
              </View>
            )}
            {stars > 0 && (
              <Text style={styles.prestigeStars}>{'⭐'.repeat(stars)}</Text>
            )}
          </View>

          {/* ── LVL ── */}
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <View style={styles.levelTopRow}>
                <Text style={styles.levelKicker}>CURRENT LEVEL</Text>
                {prestigeReady ? (
                  <View style={styles.prestigePill}>
                    <ShimmerText
                      text="★ PRESTIGE READY"
                      style={styles.prestigePillText}
                      colors={GOLD}
                      sweep={false}
                      active
                    />
                  </View>
                ) : (
                  <View style={styles.pctPill}>
                    <Text style={styles.pctPillText}>{lvlPctLabel}%</Text>
                  </View>
                )}
              </View>

              <ShimmerText text={String(lvl)} style={styles.statNumber} active={prestigeReady} />
              <Text style={styles.statLabel}>LEVEL</Text>

              <View style={styles.progressBg}>
                <ShimmerFill
                  style={[styles.progressFill, { width: `${(lvlPct * 100).toFixed(1)}%` }]}
                  active={prestigeReady}
                />
              </View>

              <View style={styles.levelBottomRow}>
                <Text style={styles.progressLabel}>{lvl} / {maxLvl}</Text>
                <Text style={styles.toNextLabel}>
                  {toNext > 0 ? `${toNext} TO GO` : 'MAXED'}
                </Text>
              </View>
            </View>
          </View>

          {/* ── Today's Missions + Daily Quests (side by side) ── */}
          <View style={styles.sectionsRow}>

            {/* Left column — Today's Missions */}
            <View style={styles.sectionPanel}>
              <View style={styles.panelHeader}>
                <View style={styles.panelHeaderBar} />
                <Text style={styles.panelHeaderText}>TODAY'S MISSIONS</Text>
                {workouts.length > 0 && (
                  <View style={[styles.countChip, allDone && styles.countChipDone]}>
                    <Text style={[styles.countChipText, allDone && styles.countChipTextDone]}>
                      {missionsDone}/{workouts.length}
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.panelDivider} />

              {workouts.length === 0 ? (
                <View style={styles.restDay}>
                  <Text style={styles.restDayText}>REST DAY</Text>
                  <Text style={styles.restDaySub}>Recovery is part of the program.</Text>
                </View>
              ) : (
                <>
                  {workouts.map(workout => (
                    <TouchableOpacity
                      key={workout.overrideId}
                      style={[
                        styles.missionCard,
                        workout.completed && styles.missionCardDone,
                      ]}
                      onPress={() => toggleWorkout(workout)}
                      activeOpacity={0.8}
                    >
                      <View style={styles.missionAccent} />
                      <View style={styles.missionBody}>
                        <Text style={styles.missionTitle}>{workout.title?.toUpperCase()}</Text>
                        {workout.purpose ? (
                          <Text style={styles.missionPurpose}>{workout.purpose}</Text>
                        ) : null}
                      </View>
                      <View style={[
                        styles.missionCheckbox,
                        workout.completed && styles.missionCheckboxDone,
                      ]}>
                        {workout.completed && <Text style={styles.missionCheckMark}>✓</Text>}
                      </View>
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </View>

            {/* Right column — Daily Quests */}
            <View style={styles.sectionPanel}>
              <View style={styles.panelHeader}>
                <View style={styles.panelHeaderBar} />
                <Text style={styles.panelHeaderText}>DAILY QUESTS</Text>
                {dailyQuests.length > 0 && (
                  <View style={[styles.countChip, dqDone === dailyQuests.length && styles.countChipDone]}>
                    <Text style={[styles.countChipText, dqDone === dailyQuests.length && styles.countChipTextDone]}>
                      {dqDone}/{dailyQuests.length}
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.panelDivider} />

              {dailyQuests.length > 0 ? (
                dailyQuests.map(q => {
                  const done = doneTodayIds.has(q.id);
                  return (
                    <TouchableOpacity
                      key={q.id}
                      style={[styles.dqCard, done && styles.dqCardDone]}
                      onPress={() => toggleDailyQuest(q)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.dqCheckbox, done && styles.dqCheckboxDone]}>
                        {done && <Text style={styles.dqCheckMark}>✓</Text>}
                      </View>
                      <Text style={[styles.dqTitle, done && styles.dqTitleDone]}>
                        {q.title}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              ) : (
                <Text style={styles.emptyHint}>No daily quests yet.</Text>
              )}
            </View>
          </View>
        </>
      )}

      <View style={{ height: 80 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg },
  // Centered, capped width so the layout reads as a designed page on wide
  // desktops instead of stretching edge-to-edge.
  body: {
    paddingHorizontal: 20,
    paddingTop: 60,
    width: '100%',
    maxWidth: 1440,
    alignSelf: 'center',
  },

  signOutBtn: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 20,
    marginBottom: 10,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: SL.accent,
    backgroundColor: 'rgba(74,158,191,0.10)',
    // Ice-glow halo so it reads as a premium, tappable control.
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 12,
    elevation: 6,
  },
  signOutText: {
    fontFamily: F.heading,
    fontSize: 15,
    color: SL.accent,
    letterSpacing: 3,
  },
  // Power symbol drawn from primitives (no icon font): a ring with a vertical
  // stem through its top center — the universal power/exit glyph.
  powerIcon: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  powerRing: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: SL.accent,
  },
  powerStem: {
    position: 'absolute',
    top: -1,
    width: 2.5,
    height: 9,
    borderRadius: 1.5,
    backgroundColor: SL.accent,
  },

  // ── Hero ──────────────────────────────────────────────────────────────────

  hero: {
    alignItems: 'center',
    paddingVertical: 28,
  },
  heroKicker: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 6,
    marginBottom: 10,
  },
  playerName: {
    fontFamily: F.heading,
    fontSize: 76,
    color: SL.accent,
    letterSpacing: 4,
    textAlign: 'center',
    // Ice-glow halo behind the name.
    textShadowColor: 'rgba(74,158,191,0.55)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 22,
  },
  classRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 12,
  },
  classLine: {
    width: 44,
    height: 1.5,
    backgroundColor: SL.gold,
    opacity: 0.5,
  },
  className: {
    fontFamily: F.bodyMed,
    fontSize: 22,
    color: SL.gold,
    letterSpacing: 4,
  },
  prestigeStars: {
    fontSize: 20,
    color: SL.gold,
    letterSpacing: 4,
    marginTop: 8,
  },

  // ── Stats row ─────────────────────────────────────────────────────────────

  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 12,
    paddingHorizontal: 22,
    paddingVertical: 18,
    alignItems: 'center',
    gap: 4,
    // Soft ice-glow so the headline stat feels like the page's centerpiece.
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
  },
  levelTopRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  levelKicker: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 3,
  },
  pctPill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: SL.accent,
    backgroundColor: 'rgba(74,158,191,0.10)',
  },
  pctPillText: {
    fontFamily: F.heading,
    fontSize: 14,
    color: SL.accent,
    letterSpacing: 1,
  },
  prestigePill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: SL.gold,
    backgroundColor: 'rgba(255,215,0,0.10)',
  },
  prestigePillText: {
    fontFamily: F.heading,
    fontSize: 14,
    color: SL.gold,
    letterSpacing: 1,
  },
  statNumber: {
    fontFamily: F.heading,
    fontSize: 88,
    color: SL.accent,
    letterSpacing: 2,
    lineHeight: 96,
    textShadowColor: 'rgba(74,158,191,0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 24,
  },
  statLabel: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 2,
    textAlign: 'center',
  },
  progressBg: {
    width: '100%',
    height: 7,
    backgroundColor: SL.border,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 10,
    // Glow the whole track so the fill reads as energized.
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: SL.accent,
    borderRadius: 4,
  },
  levelBottomRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  progressLabel: {
    fontFamily: F.bodyMed,
    fontSize: 17,
    color: SL.muted,
    letterSpacing: 1.5,
  },
  toNextLabel: {
    fontFamily: F.heading,
    fontSize: 14,
    color: SL.accent,
    letterSpacing: 2,
  },

  // ── Checkup Alert Banner ──────────────────────────────────────────────────

  checkupAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    marginBottom: 20, 
    overflow: 'hidden',
  },
  checkupAlertLeft: {
    width: 4,
    alignSelf: 'stretch',
    backgroundColor: SL.gold,
  },
  checkupAlertBody: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 4,
  },
  checkupAlertTitle: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.gold,
    letterSpacing: 2,
  },
  checkupAlertSub: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.gold,
    letterSpacing: 0.5,
  },

  coachResponseAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.gold,
    borderRadius: 4,
    marginBottom: 20,
    overflow: 'hidden',
  },
  coachResponseAlertLeft: {
    width: 4,
    alignSelf: 'stretch',
    backgroundColor: SL.gold,
  },
  coachResponseAlertTitle: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.gold,
    letterSpacing: 2,
  },
  coachResponseAlertArrow: {
    fontFamily: F.heading,
    fontSize: 20,
    color: SL.gold,
    paddingRight: 14,
  },
  checkupAlertArrow: {
    fontFamily: F.heading,
    fontSize: 20,
    color: SL.gold,
    paddingRight: 14,
  },

  // ── Today's Missions ──────────────────────────────────────────────────────

  sectionLabel: {
    fontFamily: F.bodyMed,
    fontSize: 15,
    color: SL.muted,
    letterSpacing: 3,
    marginBottom: 12,
  },

  // Today's Missions + Daily Quests side by side, each in a glowing ice-panel
  sectionsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 18,
  },
  sectionPanel: {
    flex: 1,
    minHeight: 220,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  panelHeaderBar: {
    width: 4,
    height: 26,
    borderRadius: 2,
    backgroundColor: SL.accent,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  panelHeaderText: {
    flex: 1,
    fontFamily: F.heading,
    fontSize: 26,
    color: SL.accent,
    letterSpacing: 3,
  },
  // Live progress counter on the right of each panel header.
  countChip: {
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: SL.border,
    backgroundColor: 'rgba(74,158,191,0.08)',
  },
  countChipDone: {
    borderColor: SL.accent,
    backgroundColor: 'rgba(74,158,191,0.18)',
  },
  countChipText: {
    fontFamily: F.heading,
    fontSize: 16,
    color: SL.accent,
    letterSpacing: 1,
  },
  countChipTextDone: {
    color: SL.accent,
  },
  panelDivider: {
    height: 1,
    backgroundColor: SL.border,
    opacity: 0.6,
    marginBottom: 16,
  },
  emptyHint: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 0.5,
    opacity: 0.7,
    paddingVertical: 8,
  },

  restDay: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  restDayText: {
    fontFamily: F.heading,
    fontSize: 36,
    color: SL.muted,
    letterSpacing: 6,
  },
  restDaySub: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 0.5,
    opacity: 0.7,
  },

  missionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SL.bg,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 8,
    marginBottom: 12,
    overflow: 'hidden',
  },
  missionAccent: {
    width: 5,
    alignSelf: 'stretch',
    backgroundColor: SL.accent,
  },
  missionBody: {
    flex: 1,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 5,
  },
  missionTitle: {
    fontFamily: F.heading,
    fontSize: 26,
    color: SL.text,
    letterSpacing: 1.5,
  },
  missionPurpose: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 0.5,
  },
  missionCheckbox: {
    width: 30,
    height: 30,
    marginRight: 16,
    borderWidth: 1.5,
    borderColor: SL.muted,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Completed mission card — cool ice-glow instead of green.
  missionCardDone: {
    borderColor: SL.accent,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },
  missionCheckboxDone: {
    backgroundColor: SL.accent,
    borderColor: SL.accent,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
  },
  missionCheckMark: {
    fontFamily: F.heading,
    color: SL.bg,
    fontSize: 20,
  },

  // ── Daily Quests ──────────────────────────────────────────────────────────

  dqCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: SL.bg,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 8,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  dqCardDone: {
    borderColor: SL.accent,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  dqCheckbox: {
    width: 28,
    height: 28,
    borderWidth: 1.5,
    borderColor: SL.muted,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dqCheckboxDone: {
    backgroundColor: SL.accent,
    borderColor: SL.accent,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
  },
  dqCheckMark: {
    fontFamily: F.heading,
    color: SL.bg,
    fontSize: 18,
  },
  dqTitle: {
    flex: 1,
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.text,
    letterSpacing: 0.5,
  },
  dqTitleDone: {
    color: SL.muted,
    textDecorationLine: 'line-through',
  },

});
