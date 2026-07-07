import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Animated, Easing,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useCoach } from '../context/CoachContext';
import { prestigeStars } from '../lib/prestige';
import { F } from '../constants/fonts';
import { CARD_H, CARD_W } from '../constants/layout';
import ScreenFrame from '../components/ScreenFrame';

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

const STAGGER = 70;   // ms between consecutive row entrances
const MAX_STAGGER_ROWS = 9; // cap cumulative delay so long rosters don't crawl in

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatJoinDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// Count-up that animates 0 → target once `run` flips true (used for the roster
// tally pill so the number ticks up as the list materializes).
function useCountUp(target, run, duration = 800) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!run) { setVal(0); return; }
    const v = new Animated.Value(0);
    const id = v.addListener(({ value }) => setVal(Math.round(value)));
    Animated.timing(v, {
      toValue: target, duration,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start();
    return () => v.removeListener(id);
  }, [run, target, duration]);
  return val;
}

// ─── Animated press wrapper ─────────────────────────────────────────────────────
// Subtle scale-down on press (HIG/MD `scale-feedback`) used by every tappable
// surface so the whole dashboard reacts to touch consistently.
function TapScale({ children, onPress, style, down = 0.97, disabled = false }) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (toValue, bounciness) =>
    Animated.spring(scale, { toValue, bounciness, speed: 40, useNativeDriver: true }).start();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onPressIn={() => !disabled && to(down, 0)}
      onPressOut={() => !disabled && to(1, 6)}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

// ─── Roster row ─────────────────────────────────────────────────────────────────
function PlayerRow({ player, index, rankLabel, className, stars, onPress }) {
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const delay = STAGGER * Math.min(index, MAX_STAGGER_ROWS);
    Animated.timing(enter, {
      toValue: 1, duration: 460, delay,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
  }, [enter, index]);

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [22, 0] });
  const translateX = enter.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] });

  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY }, { translateX }] }}>
      <TapScale onPress={onPress} style={styles.playerCard}>
        <View style={styles.rankChip}>
          <Text style={styles.rankText}>{rankLabel}</Text>
        </View>

        <View style={styles.cardLeft}>
          <Text style={styles.playerName} numberOfLines={1}>
            {player.full_name || '(no name)'}
            {stars > 0 ? <Text style={styles.stars}>{` ${'★'.repeat(stars)}`}</Text> : null}
          </Text>
          <Text style={styles.joinDate}>Joined {formatJoinDate(player.created_at)}</Text>
        </View>

        <View style={styles.classBadge}>
          <Text style={styles.classBadgeText}>{className ?? 'NO CLASS'}</Text>
        </View>
        <Text style={styles.cardChevron}>›</Text>
      </TapScale>
    </Animated.View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
//
// Since the self-coach refactor there is no coach role and no player→coach
// assignment to manage. Admin is now a lightweight overview: a read-only roster
// of all players plus access to the shared exercise gallery.

export default function AdminDashboard({ navigation }) {
  const { setSelectedStudent } = useCoach();
  const [players,    setPlayers]    = useState([]);
  const [classNames, setClassNames] = useState({}); // class_id → name
  const [classOrder, setClassOrder] = useState({}); // class_id → order_index
  const [classCount, setClassCount] = useState(null);
  const [loading,    setLoading]    = useState(true);

  const count = useCountUp(players.length, !loading);

  // Looping breathe on the tally pill — a quiet HUD "alive" pulse.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (loading) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [loading, pulse]);
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  // Header entrance — title + actions ease in together, slightly ahead of the rows.
  const head = useRef(new Animated.Value(0)).current;
  // Title underline sweeps open (scaleX) once data has settled.
  const underline = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(head, {
      toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
  }, [head]);
  useEffect(() => {
    if (loading) return;
    Animated.timing(underline, {
      toValue: 1, duration: 640, delay: 120, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
  }, [loading, underline]);
  const headTranslate = head.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] });

  const fetchData = useCallback(async () => {
    try {
      const [playersRes, classesRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, class_id, prestige_count, created_at, avatar_url')
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

  return (
    <ScreenFrame maxWidth={CARD_W} duration={5200} ready={!loading}>
      <View style={styles.card}>
      {/* Top bar — title on its own row, the actions share the row below
          (each flex:1 so they always fit one line on any phone width). */}
      <Animated.View style={[styles.topBar, { opacity: head, transform: [{ translateY: headTranslate }] }]}>
        <View style={styles.titleWrap}>
          <Text style={styles.pageTitle}>ADMIN</Text>
          <Animated.View style={[styles.titleUnderline, { transform: [{ scaleX: underline }] }]} />
        </View>

        <View style={styles.topBarButtons}>
          <TapScale
            style={styles.topBarBtn}
            onPress={() => navigation.navigate('ExerciseGallery')}
          >
            <Text style={styles.topBarBtnText} numberOfLines={1}>GALLERY</Text>
          </TapScale>

          <TapScale
            style={[styles.topBarBtn, styles.signOutBtn]}
            onPress={() => supabase.auth.signOut()}
          >
            <View style={styles.powerIcon}>
              <View style={styles.powerRing} />
              <View style={styles.powerStem} />
            </View>
            <Text style={styles.topBarBtnText} numberOfLines={1}>SIGN OUT</Text>
          </TapScale>
        </View>
      </Animated.View>

      {/* Body is always the same height (section header + fixed-height list area)
          so the card never resizes when the player data loads — the roster just
          scrolls inside its fixed region. */}
      <View style={styles.body}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>PLAYERS</Text>
          <Animated.View style={[styles.sectionPill, { transform: [{ scale: pulseScale }] }]}>
            <Text style={styles.sectionPillText}>{loading ? '—' : count}</Text>
          </Animated.View>
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
              {players.map((player, i) => (
                <PlayerRow
                  key={player.id}
                  player={player}
                  index={i}
                  rankLabel={String(i + 1).padStart(2, '0')}
                  className={classNames[player.class_id]}
                  stars={prestigeStars({ orderIndex: classOrder[player.class_id] ?? 0, classCount })}
                  onPress={() => {
                    setSelectedStudent(player);
                    navigation.navigate('PlayerAdmin', { player });
                  }}
                />
              ))}
            </ScrollView>
          )}
        </View>
      </View>
      </View>
    </ScreenFrame>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Top bar — vertical stack: ADMIN title on top, the actions in a row below.
  topBar: {
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 16,
    paddingTop: 30,
    paddingBottom: 22,
    borderBottomWidth: 2,
    borderBottomColor: SL.border,
  },
  titleWrap: { alignItems: 'center', gap: 10 },
  pageTitle: {
    fontFamily: F.heading,
    fontSize: 56,
    color: SL.accent,
    letterSpacing: 10,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  // Accent bar under the title that sweeps open on entrance (scaleX 0→1).
  titleUnderline: {
    width: 160,
    height: 3,
    borderRadius: 2,
    backgroundColor: SL.accent,
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 8,
  },
  // GALLERY pinned to the left edge, SIGN OUT to the right edge of the row.
  topBarButtons: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    justifyContent: 'space-between',
    gap: 8,
  },
  topBarBtn: {
    minWidth: 170,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 24,
    backgroundColor: 'rgba(74,158,191,0.10)',
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 10,
  },
  topBarBtnText: {
    fontFamily: F.heading,
    fontSize: 14,
    color: SL.accent,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  // SIGN OUT pill — same ice-glow pill, but laid out as a row so the power
  // glyph sits before the label.
  signOutBtn: {
    gap: 8,
  },
  // Power symbol drawn from primitives (no icon font): a ring with a vertical
  // stem through its top center — the universal power/exit glyph.
  powerIcon: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  powerRing: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: SL.accent,
  },
  powerStem: {
    position: 'absolute',
    top: -1,
    width: 2.5,
    height: 8,
    borderRadius: 1.5,
    backgroundColor: SL.accent,
  },

  // Fixed card height so the frame matches the other cards (Gallery/Weekly Plan).
  card: { height: CARD_H },
  body: { flex: 1, paddingHorizontal: 28, paddingTop: 30, paddingBottom: 30 },

  // Fills the remaining card height → the card is always the same size regardless
  // of how many players load (spinner / empty / roster all occupy this same box;
  // longer rosters scroll inside it).
  listArea: { flex: 1 },
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
  // HUD rank index — a glowing ice token at the head of each row.
  rankChip: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: SL.accent,
    backgroundColor: 'rgba(74,158,191,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 18,
  },
  rankText: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.accent,
    letterSpacing: 1,
  },
  cardLeft: { flex: 1, gap: 6 },
  playerName: {
    fontFamily: F.heading,
    fontSize: 26,
    color: SL.text,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  stars: { color: SL.gold },
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
  cardChevron: {
    fontFamily: F.heading,
    fontSize: 30,
    color: SL.accent,
    marginLeft: 14,
    marginTop: -2,
  },
});
