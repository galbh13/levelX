import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { prestigeStars } from '../lib/prestige';
import { F } from '../constants/fonts';
import ScreenFrame from '../components/ScreenFrame';
import { ShimmerFrame } from '../components/Shimmer';

// Fiery wine→ember ramp for the live CHALLENGES button — crimson rising into
// orange/amber so the sweep reads like glowing fire. The hues are analogous
// (all warm), so the gradient transitions are smooth rather than jumpy.
const FIRE = ['#8B1538', '#C81E45', '#FF1E3C', '#FF5C2A', '#FF9A2E'];

const SL = {
  bg:        '#050912',
  panel:     '#070d1a',
  panelAlt:  '#0a1424',
  border:    '#1a3a5c',
  accent:    '#4A9EBF',
  text:      '#E8F4FF',
  muted:     '#4a6a8a',
  gold:      '#FFD700',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatJoinDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// ─── Screen ───────────────────────────────────────────────────────────────────
//
// Since the self-coach refactor there is no coach role and no player→coach
// assignment to manage. Admin is now a lightweight overview: a read-only roster
// of all players plus access to the shared exercise gallery.

export default function AdminDashboard({ navigation }) {
  const [players,    setPlayers]    = useState([]);
  const [classNames, setClassNames] = useState({}); // class_id → name
  const [classOrder, setClassOrder] = useState({}); // class_id → order_index
  const [classCount, setClassCount] = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [playersRes, classesRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, class_id, prestige_count, created_at')
          .eq('role', 'player')
          .order('created_at', { ascending: true }),
        supabase
          .from('classes')
          .select('id, name, order_index'),
      ]);

      const classes = classesRes.data ?? [];
      setPlayers(playersRes.data ?? []);
      setClassNames(Object.fromEntries(classes.map(c => [c.id, c.name])));
      setClassOrder(Object.fromEntries(classes.map(c => [c.id, c.order_index])));
      setClassCount(classes.length || null);
    } catch (e) {
      console.error('[AdminDashboard] fetchData exception:', e);
    }
  }, []);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  async function refresh() {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }

  return (
    <ScreenFrame maxWidth={1100} duration={5200} ready={!loading}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <TouchableOpacity
            style={styles.topBarBtn}
            onPress={() => navigation.navigate('ExerciseGallery')}
            activeOpacity={0.8}
          >
            <Text style={styles.topBarBtnText}>GALLERY</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.challengesBtn}
            onPress={() => navigation.navigate('Challenges')}
            activeOpacity={0.85}
          >
            <ShimmerFrame
              style={styles.challengesFrame}
              colors={FIRE}
              radius={22}
              thickness={3}
              duration={5200}
              active
            />
            <Text style={styles.challengesText}>CHALLENGES</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.pageTitle}>ADMIN</Text>

        <View style={styles.topBarRight}>
          <TouchableOpacity
            style={styles.topBarBtn}
            onPress={() => supabase.auth.signOut()}
            activeOpacity={0.8}
          >
            <Text style={styles.topBarBtnText}>SIGN OUT</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Body is always the same height (section header + fixed-height list area)
          so the card never resizes when the player data loads — the roster just
          scrolls inside its fixed region. */}
      <View style={styles.body}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>PLAYERS</Text>
          <View style={styles.sectionPill}>
            <Text style={styles.sectionPillText}>{loading ? '—' : players.length}</Text>
          </View>
        </View>

        <View style={styles.listArea}>
          {loading ? (
            <View style={styles.listCenter}>
              <ActivityIndicator size="large" color={SL.accent} />
            </View>
          ) : players.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>No players yet.</Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {players.map(player => {
                const stars = prestigeStars({ orderIndex: classOrder[player.class_id] ?? 0, classCount });
                return (
                <View key={player.id} style={styles.playerCard}>
                  <View style={styles.cardLeft}>
                    <Text style={styles.playerName}>
                      {player.full_name || '(no name)'}
                      {stars > 0 ? ` ${'★'.repeat(stars)}` : ''}
                    </Text>
                    <Text style={styles.joinDate}>Joined {formatJoinDate(player.created_at)}</Text>
                  </View>
                  <View style={styles.classBadge}>
                    <Text style={styles.classBadgeText}>
                      {classNames[player.class_id] ?? 'NO CLASS'}
                    </Text>
                  </View>
                </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </ScreenFrame>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 28,
    paddingHorizontal: 28,
    paddingTop: 30,
    paddingBottom: 26,
    borderBottomWidth: 2,
    borderBottomColor: SL.border,
  },
  // Both sides flex equally so the centered title is truly centered regardless of
  // how wide each side's buttons are.
  topBarLeft: { flex: 1, flexDirection: 'row', gap: 12, justifyContent: 'flex-start' },
  topBarRight: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  pageTitle: {
    fontFamily: F.heading,
    fontSize: 56,
    color: SL.accent,
    letterSpacing: 10,
    textTransform: 'uppercase',
  },
  topBarBtn: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 24,
    backgroundColor: 'rgba(74,158,191,0.10)',
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 10,
  },
  topBarBtnText: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.accent,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },

  // ── CHALLENGES button — fire-gradient sweep on the border + ember glow ──
  challengesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 22,
    borderColor: 'transparent',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,70,40,0.12)',
    shadowColor: '#FF4D2A', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 16,
  },
  challengesFrame: { ...StyleSheet.absoluteFillObject, borderRadius: 22 },
  challengesText: {
    fontFamily: F.heading,
    fontSize: 18,
    color: '#FF9A52',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },

  body: { paddingHorizontal: 28, paddingTop: 30, paddingBottom: 30 },

  // Fixed-height list region → the card is always the same size regardless of
  // how many players load (spinner / empty / roster all occupy this same box;
  // longer rosters scroll inside it). Keeps the hologram-build box from resizing.
  listArea: { height: 520 },
  listCenter: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Section headers
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 22,
  },
  sectionTitle: {
    fontFamily: F.heading,
    fontSize: 30,
    color: SL.text,
    letterSpacing: 5,
    textTransform: 'uppercase',
  },
  sectionPill: {
    backgroundColor: 'rgba(74,158,191,0.12)',
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 4,
    minWidth: 50,
    alignItems: 'center',
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 8,
  },
  sectionPillText: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.accent,
    letterSpacing: 1,
  },

  emptyBox: {
    backgroundColor: SL.panel,
    borderWidth: 2,
    borderColor: SL.border,
    borderRadius: 4,
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.muted,
    letterSpacing: 2,
    textAlign: 'center',
  },

  // Player card
  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 12,
    padding: 22,
    marginBottom: 14,
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.18, shadowRadius: 12,
  },
  cardLeft: { flex: 1, gap: 6 },
  playerName: {
    fontFamily: F.heading,
    fontSize: 26,
    color: SL.text,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  joinDate: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 1.5,
  },
  classBadge: {
    backgroundColor: 'rgba(255,215,0,0.08)',
    borderWidth: 1.5,
    borderColor: SL.gold,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 6,
    shadowColor: SL.gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.35, shadowRadius: 8,
  },
  classBadgeText: {
    fontFamily: F.heading,
    fontSize: 17,
    color: SL.gold,
    letterSpacing: 2,
  },
});
