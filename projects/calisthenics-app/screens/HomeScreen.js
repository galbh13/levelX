import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { F } from '../constants/fonts';
import { supabase } from '../lib/supabase';
import { computeLvl } from '../lib/computeLvl';
import { israelToday } from '../lib/israelDate';

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
  const [expTotal,       setExpTotal]       = useState(0);
  const [pendingCheckup,      setPendingCheckup]      = useState(null);
  const [coachResponseCheckup, setCoachResponseCheckup] = useState(null);
  const [dailyQuests,    setDailyQuests]    = useState([]);
  const [doneTodayIds,   setDoneTodayIds]   = useState(new Set());
  const [dqLifetime,     setDqLifetime]     = useState(0);
  const [loading,        setLoading]        = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profileData } = await supabase
        .from('profiles')
        .select('full_name, total_exp, prestige_count, class_id')
        .eq('id', user.id)
        .single();

      if (!profileData) return;
      setProfile(profileData);

      const israelDay = israelToday();
      const [classRes, overridesRes, expRes, checkupRes, coachResponseRes, lvlVal, dqRes, dqDoneRes, dqLifetimeRes] = await Promise.all([
        profileData.class_id
          ? supabase.from('classes').select('name').eq('id', profileData.class_id).single()
          : Promise.resolve({ data: null }),
        supabase
          .from('workout_override_workouts')
          .select('id, workout_id, completed')
          .eq('student_id', user.id)
          .eq('specific_date', TODAY),
        supabase
          .from('workout_override_workouts')
          .select('*', { count: 'exact', head: true })
          .eq('student_id', user.id)
          .eq('completed', true),
        supabase
          .from('checkups')
          .select('*')
          .eq('student_id', user.id)
          .eq('status', 'pending')
          .order('scheduled_date', { ascending: true })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('checkups')
          .select('id, scheduled_date, coach_response, responded_at, response_is_read')
          .eq('student_id', user.id)
          .not('coach_response', 'is', null)
          .order('responded_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
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
        supabase
          .from('daily_quest_completions')
          .select('*', { count: 'exact', head: true })
          .eq('student_id', user.id),
      ]);

      setClassName(classRes.data?.name ?? null);
      setLvl(lvlVal ?? 0);
      const dqLifetimeCount = dqLifetimeRes.count ?? 0;
      setDqLifetime(dqLifetimeCount);
      setExpTotal((expRes.count ?? 0) * 5 + dqLifetimeCount);
      setDailyQuests(dqRes.data ?? []);
      setDoneTodayIds(new Set((dqDoneRes.data ?? []).map(r => r.daily_quest_id)));
      setPendingCheckup(checkupRes.data ?? null);
      setCoachResponseCheckup(
        coachResponseRes.data?.response_is_read === false ? coachResponseRes.data : null
      );

      const overrides = overridesRes.data ?? [];
      if (overrides.length === 0) { setWorkouts([]); setLoading(false); return; }

      const workoutIds = overrides.map(o => o.workout_id);
      const { data: workoutRows } = await supabase
        .from('workouts')
        .select('id, title, purpose')
        .in('id', workoutIds);

      const workoutsById = Object.fromEntries((workoutRows ?? []).map(w => [w.id, w]));
      const merged = overrides
        .map(o => ({ ...workoutsById[o.workout_id], overrideId: o.id, completed: o.completed ?? false }))
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
    const nextLifetime = isDone ? Math.max(0, dqLifetime - 1) : dqLifetime + 1;
    setDqLifetime(nextLifetime);
    setExpTotal(prev => Math.max(0, prev + (isDone ? -1 : 1)));

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

  const allDone  = workouts.length > 0 && workouts.every(w => w.completed);
  const prestige = profile?.prestige_count ?? 0;
  const lvlPct   = Math.min(lvl / 100, 1);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.body}>

      {/* Sign Out */}
      <TouchableOpacity style={styles.signOutBtn} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.signOutText}>SIGN OUT</Text>
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator size="large" color={SL.accent} style={{ marginTop: 80 }} />
      ) : (
        <>
          {/* ── Hero ── */}
          <View style={styles.hero}>
            <Text style={styles.playerName}>{profile?.full_name?.toUpperCase() ?? '—'}</Text>
            {className && (
              <Text style={styles.className}>{className.toUpperCase()}</Text>
            )}
            {prestige > 0 && (
              <Text style={styles.prestigeStars}>{'⭐'.repeat(prestige)}</Text>
            )}
          </View>

          {/* ── LVL & EXP ── */}
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{lvl}</Text>
              <Text style={styles.statLabel}>LEVEL</Text>
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, { width: `${(lvlPct * 100).toFixed(1)}%` }]} />
              </View>
              <Text style={styles.progressLabel}>{lvl} / 100</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{expTotal}</Text>
              <Text style={styles.statLabel}>EXP</Text>
              <Text style={styles.statSub}>EXPERIENCE</Text>
            </View>
          </View>

          {/* ── Checkup Alert Banner ── */}
          {pendingCheckup && (
            <TouchableOpacity
              style={styles.checkupAlert}
              onPress={() => navigation.navigate('Checkup', { checkup: pendingCheckup })}
              activeOpacity={0.8}
            >
              <View style={styles.checkupAlertLeft} />
              <View style={styles.checkupAlertBody}>
                <Text style={styles.checkupAlertTitle}>📋 CHECKUP AWAITS</Text>
                <Text style={styles.checkupAlertSub}>
                  {pendingCheckup.scheduled_date <= TODAY
                    ? 'Your checkup is due — complete it now.'
                    : `Scheduled for ${pendingCheckup.scheduled_date}`}
                </Text>
              </View>
              <Text style={styles.checkupAlertArrow}>→</Text>
            </TouchableOpacity>
          )}

          {/* ── Coach Response Alert ── */}
          {coachResponseCheckup && (
            <TouchableOpacity
              style={styles.coachResponseAlert}
              onPress={() => navigation.navigate('CoachResponse', { checkup: coachResponseCheckup })}
              activeOpacity={0.8}
            >
              <View style={styles.coachResponseAlertLeft} />
              <View style={styles.checkupAlertBody}>
                <Text style={styles.coachResponseAlertTitle}>💬 NEW COACH FEEDBACK</Text>
                <Text style={styles.checkupAlertSub}>Your coach left a response — tap to read it.</Text>
              </View>
              <Text style={styles.coachResponseAlertArrow}>→</Text>
            </TouchableOpacity>
          )}

          {/* ── Today's Missions ── */}
          <Text style={styles.sectionLabel}>TODAY'S MISSIONS</Text>

          {workouts.length === 0 ? (
            <View style={styles.restDay}>
              <Text style={styles.restDayText}>REST DAY</Text>
              <Text style={styles.restDaySub}>Recovery is part of the program.</Text>
            </View>
          ) : (
            <>
              {workouts.map(workout => (
                <View
                  key={workout.overrideId}
                  style={[
                    styles.missionCard,
                    workout.completed && { borderColor: SL.green },
                  ]}
                >
                  <View style={[
                    styles.missionAccent,
                    workout.completed && { backgroundColor: SL.green },
                  ]} />
                  <View style={styles.missionBody}>
                    <Text style={styles.missionTitle}>{workout.title?.toUpperCase()}</Text>
                    {workout.purpose ? (
                      <Text style={styles.missionPurpose}>{workout.purpose}</Text>
                    ) : null}
                  </View>
                  {workout.completed ? (
                    <View style={styles.doneBadge}>
                      <Text style={styles.doneBadgeText}>✓ DONE</Text>
                    </View>
                  ) : (
                    <View style={styles.pendingBadge}>
                      <Text style={styles.pendingBadgeText}>PENDING</Text>
                    </View>
                  )}
                </View>
              ))}

              {allDone && (
                <View style={styles.allDoneBanner}>
                  <Text style={styles.allDoneText}>⚔ ALL MISSIONS COMPLETE</Text>
                </View>
              )}
            </>
          )}

          {/* ── Daily Quests ── */}
          {dailyQuests.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: 24 }]}>DAILY QUESTS</Text>
              {dailyQuests.map(q => {
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
                    <Text style={[styles.dqExp, done && { color: SL.green }]}>+1 EXP</Text>
                  </TouchableOpacity>
                );
              })}
            </>
          )}
        </>
      )}

      <View style={{ height: 80 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg },
  body:      { paddingHorizontal: 20, paddingTop: 60 },

  signOutBtn: {
    alignSelf: 'flex-end',
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  signOutText: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: SL.accent,
    letterSpacing: 2,
  },

  // ── Hero ──────────────────────────────────────────────────────────────────

  hero: {
    alignItems: 'center',
    paddingVertical: 28,
  },
  playerName: {
    fontFamily: F.heading,
    fontSize: 64,
    color: SL.accent,
    letterSpacing: 4,
    textAlign: 'center',
  },
  className: {
    fontFamily: F.bodyMed,
    fontSize: 22,
    color: SL.gold,
    letterSpacing: 4,
    marginTop: 6,
  },
  prestigeStars: {
    fontSize: 20,
    color: SL.gold,
    letterSpacing: 4,
    marginTop: 6,
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
    borderRadius: 4,
    padding: 16,
    alignItems: 'center',
    gap: 4,
  },
  statNumber: {
    fontFamily: F.heading,
    fontSize: 72,
    color: SL.accent,
    letterSpacing: 2,
    lineHeight: 80,
  },
  statLabel: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 2,
    textAlign: 'center',
  },
  statSub: {
    fontFamily: F.bodyMed,
    fontSize: 15,
    color: SL.muted,
    letterSpacing: 1.5,
    opacity: 0.6,
    textAlign: 'center',
  },
  progressBg: {
    width: '100%',
    height: 4,
    backgroundColor: SL.border,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: SL.accent,
    borderRadius: 2,
  },
  progressLabel: {
    fontFamily: F.bodyMed,
    fontSize: 17,
    color: SL.muted,
    letterSpacing: 1.5,
    marginTop: 2,
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
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    marginBottom: 10,
    overflow: 'hidden',
  },
  missionAccent: {
    width: 3,
    alignSelf: 'stretch',
    backgroundColor: SL.accent,
  },
  missionBody: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 4,
  },
  missionTitle: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.text,
    letterSpacing: 1.5,
  },
  missionPurpose: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 0.5,
  },
  doneBadge: {
    marginRight: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(76,175,80,0.12)',
    borderWidth: 1,
    borderColor: SL.green,
    borderRadius: 4,
  },
  doneBadgeText: {
    fontFamily: F.heading,
    fontSize: 14,
    color: SL.green,
    letterSpacing: 2,
  },
  pendingBadge: {
    marginRight: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: SL.muted,
    borderRadius: 4,
    opacity: 0.5,
  },
  pendingBadgeText: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.muted,
    letterSpacing: 2,
  },

  // ── Daily Quests ──────────────────────────────────────────────────────────

  dqCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  dqCardDone: {
    borderColor: SL.green,
  },
  dqCheckbox: {
    width: 22,
    height: 22,
    borderWidth: 1.5,
    borderColor: SL.muted,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dqCheckboxDone: {
    backgroundColor: SL.green,
    borderColor: SL.green,
  },
  dqCheckMark: {
    fontFamily: F.heading,
    color: SL.bg,
    fontSize: 14,
  },
  dqTitle: {
    flex: 1,
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.text,
    letterSpacing: 0.5,
  },
  dqTitleDone: {
    color: SL.muted,
    textDecorationLine: 'line-through',
  },
  dqExp: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: SL.muted,
    letterSpacing: 1.5,
  },

  allDoneBanner: {
    marginTop: 8,
    paddingVertical: 16,
    borderWidth: 1.5,
    borderColor: SL.green,
    borderRadius: 4,
    alignItems: 'center',
    backgroundColor: 'rgba(76,175,80,0.07)',
  },
  allDoneText: {
    fontFamily: F.heading,
    fontSize: 24,
    color: SL.green,
    letterSpacing: 4,
  },
});
