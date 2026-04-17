import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { F } from '../constants/fonts';
import { supabase } from '../lib/supabase';

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

export default function HomeScreen() {
  const [profile,   setProfile]   = useState(null);
  const [className, setClassName] = useState(null);
  const [workouts,  setWorkouts]  = useState([]);
  const [expTotal,  setExpTotal]  = useState(0);
  const [loading,   setLoading]   = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profileData } = await supabase
        .from('profiles')
        .select('full_name, current_lvl, total_exp, prestige_count, class_id')
        .eq('id', user.id)
        .single();

      if (!profileData) return;
      setProfile(profileData);

      const [classRes, overridesRes, expRes] = await Promise.all([
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
      ]);

      setClassName(classRes.data?.name ?? null);
      setExpTotal(expRes.count ?? 0);

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

  const allDone  = workouts.length > 0 && workouts.every(w => w.completed);
  const lvl      = profile?.current_lvl   ?? 0;
  const prestige = profile?.prestige_count ?? 0;
  const lvlPct  = Math.min(lvl / 100, 1);

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
            {/* LVL card */}
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{lvl}</Text>
              <Text style={styles.statLabel}>LEVEL</Text>
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, { width: `${(lvlPct * 100).toFixed(1)}%` }]} />
              </View>
              <Text style={styles.progressLabel}>{lvl} / 100</Text>
            </View>

            {/* EXP card */}
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{expTotal}</Text>
              <Text style={styles.statLabel}>EXP</Text>
              <Text style={styles.statSub}>EXPERIENCE</Text>
            </View>
          </View>

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
    fontSize: 11,
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
    fontSize: 44,
    color: SL.accent,
    letterSpacing: 4,
    textAlign: 'center',
  },
  className: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.gold,
    letterSpacing: 3,
    marginTop: 6,
  },
  prestigeStars: {
    fontSize: 18,
    color: SL.gold,
    letterSpacing: 4,
    marginTop: 6,
  },

  // ── Stats row ─────────────────────────────────────────────────────────────

  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 28,
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
    fontSize: 48,
    color: SL.accent,
    letterSpacing: 2,
    lineHeight: 56,
  },
  statLabel: {
    fontFamily: F.bodyMed,
    fontSize: 11,
    color: SL.muted,
    letterSpacing: 2,
    textAlign: 'center',
  },
  statSub: {
    fontFamily: F.bodyMed,
    fontSize: 9,
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
    fontSize: 11,
    color: SL.muted,
    letterSpacing: 1.5,
    marginTop: 2,
  },

  // ── Today's Missions ──────────────────────────────────────────────────────

  sectionLabel: {
    fontFamily: F.bodyMed,
    fontSize: 12,
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
    fontSize: 14,
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
    fontSize: 20,
    color: SL.text,
    letterSpacing: 1.5,
  },
  missionPurpose: {
    fontFamily: F.bodyMed,
    fontSize: 13,
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
    fontSize: 12,
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
    fontSize: 12,
    color: SL.muted,
    letterSpacing: 2,
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
    fontSize: 22,
    color: SL.green,
    letterSpacing: 4,
  },
});
