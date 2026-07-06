import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Pressable, Image } from 'react-native';
import { useCoach } from '../context/CoachContext';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { CARD_H, CARD_W } from '../constants/layout';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import { ShimmerText, ShimmerRing, BLUE } from '../components/Shimmer';

// ─── Screen ───────────────────────────────────────────────────────────────────
// Admin-as-coach hub. Reached by tapping a player on the AdminDashboard roster.
// It seeds the shared CoachContext with the tapped player so the existing
// self-coach screens (Manage workouts / daily quests) act on THAT player, and
// routes the level/class/quest screens with an explicit `studentId` param.
//
// NOTE: every write from here requires the admin-override RLS policies in
// `supabase/migrations/20260621_admin_manage_players.sql`. Without them the DB
// rejects an admin editing another player's rows.

// Tone palette per action — each tile is colour-coded so the four destinations
// read at a glance (accent week, gold progression, accent training, green dailies).
const TONE = {
  accent: { line: C.deepBlue, glow: 'rgba(74,158,191,0.55)', tint: 'rgba(74,158,191,0.07)' },
  gold:   { line: '#FFD700',  glow: 'rgba(255,215,0,0.50)',  tint: 'rgba(255,215,0,0.06)'  },
  green:  { line: '#4CAF50',  glow: 'rgba(76,175,80,0.50)',  tint: 'rgba(76,175,80,0.06)'  },
};

export default function PlayerAdminScreen({ navigation, route }) {
  const player = route.params?.player ?? null;
  const { setSelectedStudent } = useCoach();

  // Point the self-coach screens at this player (idempotent — AdminDashboard also
  // sets it before navigating, this guards a direct/remounted entry).
  useEffect(() => {
    if (player) setSelectedStudent(player);
  }, [player, setSelectedStudent]);

  const actions = [
    {
      key: 'week',
      icon: '◷',
      tone: 'accent',
      label: 'CURRENT WEEK',
      desc: 'Their live schedule & completions',
      onPress: () => navigation.navigate('WorkoutsList', { studentId: player?.id }),
    },
    {
      key: 'skills',
      icon: '✦',
      tone: 'gold',
      label: 'SKILLS · CLASS · LEVEL',
      desc: 'Class, level, prestige & quest trees',
      onPress: () => navigation.navigate('SkillsList', { studentId: player?.id }),
    },
    {
      key: 'workouts',
      icon: '⚔',
      tone: 'accent',
      label: 'WORKOUTS · SCHEDULE',
      desc: 'Weekly plan, create & assign workouts',
      onPress: () => navigation.navigate('Manage'),
    },
    {
      key: 'quests',
      icon: '◈',
      tone: 'green',
      label: 'DAILY QUESTS',
      desc: 'Daily quest list & completions',
      onPress: () => navigation.navigate('DailyQuest', { student: player }),
    },
  ];

  return (
    <ScreenFrame maxWidth={CARD_W}>
      <View style={styles.card}>
        <ScreenHeader title="MANAGE PLAYER" onBack={() => navigation.goBack()} />

        <View style={styles.body}>
          <PlayerHero
            name={player?.full_name || '(no name)'}
            avatar={player?.avatar_url || null}
          />

          <View style={styles.actions}>
            {actions.map((a, i) => (
              <ActionTile key={a.key} index={i} {...a} />
            ))}
          </View>
        </View>
      </View>
    </ScreenFrame>
  );
}

// ─── Player hero ────────────────────────────────────────────────────────────
// The "amazing top": a HUD identity block. A ringed avatar (rotating gradient
// ShimmerRing + breathing halo), the player's name running a per-glyph colour
// sweep, and a live "MANAGING ACCOUNT" status with a pulsing dot.
const PlayerHero = ({ name, avatar }) => {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const enter = useRef(new Animated.Value(0)).current;
  const halo = useRef(new Animated.Value(0)).current;
  const dot = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, friction: 7, tension: 55 }).start();

    const haloLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(halo, { toValue: 1, duration: 1700, useNativeDriver: true }),
        Animated.timing(halo, { toValue: 0, duration: 1700, useNativeDriver: true }),
      ])
    );
    const dotLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(dot, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(dot, { toValue: 0, duration: 700, useNativeDriver: true }),
      ])
    );
    haloLoop.start();
    dotLoop.start();
    return () => { haloLoop.stop(); dotLoop.stop(); };
  }, [enter, halo, dot]);

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] });
  const haloScale = halo.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const haloOp = halo.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.12] });
  const dotOp = dot.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
  const dotScale = dot.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.25] });

  return (
    <Animated.View style={[styles.hero, { opacity: enter, transform: [{ translateY }] }]}>
      <View style={styles.avatarWrap}>
        {/* Breathing halo behind the avatar. */}
        <Animated.View style={[styles.halo, { opacity: haloOp, transform: [{ scale: haloScale }] }]} />
        <View style={styles.avatar}>
          {avatar ? (
            <Image source={{ uri: avatar }} style={styles.avatarImg} resizeMode="cover" />
          ) : (
            <Text style={styles.avatarInitial}>{initial}</Text>
          )}
        </View>
        {/* Rotating gradient ring sitting on the avatar edge. */}
        <ShimmerRing size={AVATAR} thickness={3} colors={BLUE} active duration={3200} />
      </View>

      <View style={styles.nameRow}>
        <ShimmerText text={name} style={styles.name} colors={BLUE} active duration={2200} numberOfLines={1} />
      </View>

      <View style={styles.statusRow}>
        <Animated.View style={[styles.liveDot, { opacity: dotOp, transform: [{ scale: dotScale }] }]} />
        <Text style={styles.statusText}>MANAGING ACCOUNT</Text>
      </View>
    </Animated.View>
  );
};

// ─── Action tile ────────────────────────────────────────────────────────────
// One tappable destination, styled like a game-menu entry: HUD corner brackets,
// an index number, an icon badge, label + description, and a chevron. Owns:
//   • entrance  — staggered slide-up + fade-in cascade on mount (the "reload")
//   • press     — scale-down + chevron slide on press-in/out
//   • breathe   — an ambient pulse on the leading accent bar + chevron nudge
const ActionTile = ({ index, icon, tone, label, desc, onPress }) => {
  const t = TONE[tone] ?? TONE.accent;
  const enter = useRef(new Animated.Value(0)).current;   // 0 → 1 entrance
  const press = useRef(new Animated.Value(0)).current;   // 0 idle → 1 pressed
  const breathe = useRef(new Animated.Value(0)).current; // 0 ↔ 1 ambient loop

  useEffect(() => {
    // Staggered entrance — each tile resolves a beat after the one above it.
    Animated.sequence([
      Animated.delay(220 + index * 95),
      Animated.spring(enter, { toValue: 1, useNativeDriver: true, friction: 7, tension: 60 }),
    ]).start();

    // Ambient breathing glow, offset per tile so the column shimmers out of phase.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(index * 220),
        Animated.timing(breathe, { toValue: 1, duration: 1900, useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 1900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [enter, breathe, index]);

  const onIn = () =>
    Animated.spring(press, { toValue: 1, useNativeDriver: true, friction: 6, tension: 220 }).start();
  const onOut = () =>
    Animated.spring(press, { toValue: 0, useNativeDriver: true, friction: 5, tension: 180 }).start();

  // Compose entrance + press transforms.
  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [26, 0] });
  const scale = Animated.multiply(
    enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }),
    press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] })
  );
  const barScaleY = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1] });
  const chevronX = Animated.add(
    breathe.interpolate({ inputRange: [0, 1], outputRange: [0, 5] }),
    press.interpolate({ inputRange: [0, 1], outputRange: [0, 6] })
  );

  const cornerC = { borderColor: t.line };
  const idx = String(index + 1).padStart(2, '0');

  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY }, { scale }] }}>
      <Pressable onPress={onPress} onPressIn={onIn} onPressOut={onOut}>
        <Animated.View
          style={[
            styles.tile,
            { borderColor: t.line, backgroundColor: t.tint, shadowColor: t.line },
          ]}
        >
          {/* HUD corner brackets. */}
          <View style={[styles.corner, styles.cornerTL, cornerC]} />
          <View style={[styles.corner, styles.cornerTR, cornerC]} />
          <View style={[styles.corner, styles.cornerBL, cornerC]} />
          <View style={[styles.corner, styles.cornerBR, cornerC]} />

          {/* Leading accent bar — breathes vertically. */}
          <Animated.View
            style={[styles.bar, { backgroundColor: t.line, transform: [{ scaleY: barScaleY }] }]}
          />
          <View style={[styles.iconWrap, { borderColor: t.line }]}>
            <Text style={[styles.icon, { color: t.line, textShadowColor: t.glow }]}>{icon}</Text>
          </View>
          <View style={styles.tileText}>
            <Text style={[styles.label, { color: C.text, textShadowColor: t.glow }]} numberOfLines={1}>
              {label}
            </Text>
            <Text style={styles.desc} numberOfLines={1}>{desc}</Text>
          </View>
          <Text style={[styles.idx, { color: t.line }]}>{idx}</Text>
          <Animated.Text style={[styles.chevron, { color: t.line, transform: [{ translateX: chevronX }] }]}>
            ›
          </Animated.Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
};

const AVATAR = 84;

const styles = StyleSheet.create({
  card: { height: CARD_H },
  body: { flex: 1, width: '100%', paddingHorizontal: 22, paddingTop: 18 },

  // ── Hero ──
  hero: { alignItems: 'center', marginBottom: 26 },
  avatarWrap: { width: AVATAR, height: AVATAR, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2,
    backgroundColor: C.deepBlue,
  },
  avatar: {
    width: AVATAR - 10, height: AVATAR - 10, borderRadius: (AVATAR - 10) / 2,
    backgroundColor: '#08172a',
    borderWidth: 1, borderColor: 'rgba(74,158,191,0.4)',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: {
    fontFamily: F.heading,
    fontSize: 34,
    color: '#E8F4FF',
    textShadowColor: 'rgba(150,220,255,0.9)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
  },

  nameRow: { marginTop: 16, alignItems: 'center', justifyContent: 'center' },
  name: {
    fontFamily: F.heading,
    fontSize: 32,
    letterSpacing: 4,
    textTransform: 'uppercase',
    textAlign: 'center',
  },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  liveDot: {
    width: 9, height: 9, borderRadius: 4.5,
    backgroundColor: '#4CAF50',
    shadowColor: '#4CAF50', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 6,
  },
  statusText: {
    fontFamily: F.bodyMed, fontSize: 15, letterSpacing: 3,
    color: '#6fae8a', textTransform: 'uppercase',
  },
  actions: { gap: 16, marginTop: 4 },

  // ── Tile ──
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1.5,
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 18,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
  },
  // HUD corner brackets — L-shaped ticks pinned to each corner.
  corner: { position: 'absolute', width: 12, height: 12, opacity: 0.65 },
  cornerTL: { top: 7, left: 7, borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: 5 },
  cornerTR: { top: 7, right: 7, borderTopWidth: 2, borderRightWidth: 2, borderTopRightRadius: 5 },
  cornerBL: { bottom: 7, left: 7, borderBottomWidth: 2, borderLeftWidth: 2, borderBottomLeftRadius: 5 },
  cornerBR: { bottom: 7, right: 7, borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: 5 },

  // Leading vertical accent bar (transform-origin defaults to center, so it
  // breathes symmetrically).
  bar: {
    position: 'absolute',
    left: 0, top: 10, bottom: 10,
    width: 4,
    borderTopRightRadius: 4, borderBottomRightRadius: 4,
  },
  iconWrap: {
    width: 46, height: 46, borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 6,
  },
  icon: {
    fontSize: 22,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
  tileText: { flex: 1 },
  label: {
    fontFamily: F.heading,
    fontSize: 20,
    letterSpacing: 2,
    textTransform: 'uppercase',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  desc: {
    fontFamily: F.bodyMed,
    fontSize: 13.5,
    color: '#4a6a8a',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  idx: {
    fontFamily: F.heading,
    fontSize: 13,
    letterSpacing: 2,
    opacity: 0.5,
  },
  chevron: {
    fontFamily: F.heading,
    fontSize: 30,
    marginLeft: 2,
  },
});
