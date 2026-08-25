import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, Pressable, ActivityIndicator, ScrollView, Image,
  Modal, TextInput,
} from 'react-native';
import { useCoach } from '../context/CoachContext';
import { supabase } from '../lib/supabase';
import { JOBS, DEFAULT_JOB } from '../lib/jobs';
import { deletePlayer } from '../lib/invites';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { CARD_W } from '../constants/layout';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import { ShimmerRing, BLUE } from '../components/Shimmer';

// ─── Screen ───────────────────────────────────────────────────────────────────
// Admin-as-coach hub. Reached by tapping a player on the AdminDashboard roster.
// It seeds the shared CoachContext with the tapped player so the existing
// self-coach screens (Manage workouts / daily quests) act on THAT player, and
// routes the level/class/quest screens with an explicit `studentId` param.
//
// NOTE: every write from here requires the admin-override RLS policies in
// `supabase/migrations/20260621_admin_manage_players.sql`. Without them the DB
// rejects an admin editing another player's rows.

// One accent — ice blue — across the whole hub, matching the ADMIN screen's
// title and BACK pill. Every row carries the same accent handle + label, so the
// page reads clean and uniform rather than a patchwork of gold/green/blue.
const ACCENT = C.deepBlue;

export default function PlayerAdminScreen({ navigation, route }) {
  const player = route.params?.player ?? null;
  const { setSelectedStudent } = useCoach();

  // The player's JOB (which class ladder they progress through). Seeded from the
  // roster row and switched here by the admin.
  const [job, setJob] = useState(player?.job ?? DEFAULT_JOB);
  const [switching, setSwitching] = useState(false);
  const [jobError, setJobError] = useState(null);

  // The player's portrait — the SAME avatar_url shown on their Player Card. The
  // roster row that seeds `player` doesn't carry it, so fetch it here.
  const [avatarUrl, setAvatarUrl] = useState(player?.avatar_url ?? null);

  // Their email = their username. Shown under the name so this hub answers
  // "who IS this account" without a trip to the Supabase dashboard.
  const [email, setEmail] = useState(player?.email ?? null);

  const [deleteOpen, setDeleteOpen] = useState(false);

  // Point the self-coach screens at this player (idempotent — AdminDashboard also
  // sets it before navigating, this guards a direct/remounted entry).
  useEffect(() => {
    if (player) setSelectedStudent(player);
  }, [player, setSelectedStudent]);

  useEffect(() => {
    if (!player?.id) return;
    let alive = true;
    supabase
      .from('profiles')
      .select('avatar_url, email')
      .eq('id', player.id)
      .single()
      .then(({ data }) => {
        if (!alive || !data) return;
        setAvatarUrl(data.avatar_url ?? null);
        setEmail(data.email ?? null);
      });
    return () => { alive = false; };
  }, [player?.id]);

  // Switch the player's job. A job is a self-contained class ladder, so we also
  // re-point their class_id at the target job's FIRST class (their old class
  // belongs to the other job's ladder). Quest completions are keyed per quest, so
  // switching back later restores the player's progress in that job untouched.
  async function switchJob(target) {
    if (!player?.id || target === job || switching) return;
    const prev = job;
    setJobError(null);
    setJob(target);          // optimistic — the thumb moves immediately
    setSwitching(true);
    try {
      const { data: firstClass, error: classErr } = await supabase
        .from('classes')
        .select('id')
        .eq('job', target)
        .order('order_index', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (classErr) throw classErr;
      const { error } = await supabase
        .from('profiles')
        .update({ job: target, class_id: firstClass?.id ?? null })
        .eq('id', player.id);
      if (error) throw error;
      // Keep the in-memory player + shared CoachContext in sync so re-entering
      // the hub (or the self-coach screens) reflects the new job.
      if (player) { player.job = target; player.class_id = firstClass?.id ?? null; }
    } catch (e) {
      console.error('[PlayerAdminScreen] switchJob:', e);
      setJob(prev);          // revert the thumb — the write did NOT stick
      setJobError(e?.message || 'Could not change job. Try again.');
    }
    setSwitching(false);
  }

  const actions = [
    {
      key: 'coachchat',
      label: 'COACH CHAT',
      desc: 'Direct 1-on-1 message with this player',
      onPress: () => navigation.navigate('CoachChat', { player, isAdmin: true }),
    },
    {
      key: 'checkup',
      label: 'CHECK-UP',
      desc: 'Review, feedback & customize their check-up',
      onPress: () => navigation.navigate('PlayerCheckup', { player }),
    },
    {
      key: 'money',
      label: 'MONEY & MEMBERSHIP',
      desc: 'Dates, plan, payments, lifetime value & churn risk',
      onPress: () => navigation.navigate('PlayerBilling', { player }),
    },
    {
      key: 'week',
      label: 'WORKOUTS MANAGEMENT',
      desc: 'Their live schedule & completions',
      onPress: () => navigation.navigate('WorkoutsList', { studentId: player?.id }),
    },
    {
      key: 'skills',
      label: 'SKILLS · CLASS · LEVEL',
      desc: 'Class, level, prestige & quest trees',
      onPress: () => navigation.navigate('SkillsList', { studentId: player?.id }),
    },
    // WORKOUTS · SCHEDULE and DAILY QUESTS are intentionally omitted here — both
    // are reachable from WORKOUTS MANAGEMENT (WorkoutsScreen → Training Forge / daily
    // quests), so separate hub tiles were redundant.
  ];

  return (
    <ScreenFrame fill maxWidth={CARD_W}>
      <View style={styles.card}>
        <ScreenHeader title="MANAGE PLAYER" onBack={() => navigation.goBack()} />

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          showsVerticalScrollIndicator={false}
        >
          <PlayerHero name={player?.full_name || '(no name)'} email={email} avatarUrl={avatarUrl} />

          {/* JOB switch — which class ladder this player trains. Admin-only. */}
          <View style={styles.jobBlock}>
            <View style={styles.jobLabelRow}>
              <Text style={styles.jobLabel}>JOB</Text>
              {switching && <ActivityIndicator size="small" color={ACCENT} />}
            </View>
            <JobSwitch jobs={JOBS} value={job} disabled={switching} onSelect={switchJob} />
            {jobError && <Text style={styles.jobError}>{jobError}</Text>}
          </View>

          <View style={styles.actions}>
            {actions.map((a, i) => (
              <ActionTile key={a.key} index={i} {...a} />
            ))}
          </View>

          {/* DANGER ZONE — the only destructive action in the app. Deliberately
              last, in red, behind a typed confirmation. See DeleteModal. */}
          <View style={styles.dangerZone}>
            <Pressable style={styles.dangerBtn} onPress={() => setDeleteOpen(true)}>
              <Text style={styles.dangerBtnText}>DELETE PLAYER</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>

      <DeleteModal
        visible={deleteOpen}
        player={player}
        email={email}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          setDeleteOpen(false);
          // The roster refetches on focus, so going back is enough to drop them.
          setSelectedStudent(null);
          navigation.navigate('AdminDashboard');
        }}
      />
    </ScreenFrame>
  );
}

// ─── Delete modal ───────────────────────────────────────────────────────────
// The account cascade is irreversible and takes the player's payment history
// with it, so this asks for the word DELETE typed out — a tap alone, however
// confirmed, is too cheap for something with no undo.
const DeleteModal = ({ visible, player, email, onClose, onDeleted }) => {
  const [typed, setTyped] = useState('');
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState(null);

  // Reset every time it opens — a half-typed DELETE must not survive a cancel.
  useEffect(() => {
    if (visible) { setTyped(''); setBusy(false); setError(null); }
  }, [visible]);

  const armed = typed.trim().toUpperCase() === 'DELETE' && !busy;

  async function confirm() {
    if (!armed || !player?.id) return;
    setBusy(true);
    setError(null);
    try {
      await deletePlayer({ userId: player.id });
      onDeleted();
    } catch (e) {
      console.error('[PlayerAdminScreen] deletePlayer:', e);
      setError(e?.message || 'Could not delete this player. Try again.');
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>DELETE PLAYER</Text>

          <Text style={styles.modalBody}>
            <Text style={styles.modalStrong}>{player?.full_name || '(no name)'}</Text>
            {email ? ` (${email})` : ''} and everything attached to them will be
            gone for good. There is no undo.
          </Text>

          <Text style={styles.modalLabel}>TYPE DELETE TO CONFIRM</Text>
          <TextInput
            style={styles.modalInput}
            value={typed}
            onChangeText={setTyped}
            placeholder="DELETE"
            placeholderTextColor="#3a5a7a"
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
          />

          {error && <Text style={styles.modalError}>{error}</Text>}

          <View style={styles.modalActions}>
            <Pressable style={styles.modalCancel} onPress={onClose} disabled={busy}>
              <Text style={styles.modalCancelText}>CANCEL</Text>
            </Pressable>
            <Pressable
              style={[styles.modalConfirm, !armed && styles.modalConfirmOff]}
              onPress={confirm}
              disabled={!armed}
            >
              {busy
                ? <ActivityIndicator size="small" color={C.alarmRed} />
                : <Text style={styles.modalConfirmText}>DELETE</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

// ─── Player hero ────────────────────────────────────────────────────────────
// The "amazing top": a HUD identity block. A ringed avatar (rotating gradient
// ShimmerRing + breathing halo) and the player's name.
const PlayerHero = ({ name, email, avatarUrl }) => {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const enter = useRef(new Animated.Value(0)).current;
  const halo = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, friction: 7, tension: 55 }).start();

    const haloLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(halo, { toValue: 1, duration: 1700, useNativeDriver: true }),
        Animated.timing(halo, { toValue: 0, duration: 1700, useNativeDriver: true }),
      ])
    );
    haloLoop.start();
    return () => { haloLoop.stop(); };
  }, [enter, halo]);

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] });
  const haloScale = halo.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const haloOp = halo.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.12] });

  return (
    <Animated.View style={[styles.hero, { opacity: enter, transform: [{ translateY }] }]}>
      <View style={styles.avatarWrap}>
        {/* Breathing halo behind the avatar. */}
        <Animated.View style={[styles.halo, { opacity: haloOp, transform: [{ scale: haloScale }] }]} />
        <View style={styles.avatar}>
          {avatarUrl
            ? <Image source={{ uri: avatarUrl }} style={styles.avatarImg} resizeMode="cover" />
            : <Text style={styles.avatarInitial}>{initial}</Text>}
        </View>
        {/* Rotating gradient ring sitting on the avatar edge. */}
        <ShimmerRing size={AVATAR} thickness={3} colors={BLUE} active duration={3200} />
      </View>

      <View style={styles.nameRow}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        {email ? <Text style={styles.heroEmail} numberOfLines={1}>{email}</Text> : null}
      </View>
    </Animated.View>
  );
};

// ─── Job switch ───────────────────────────────────────────────────────────────
// A compact row of one-word pill buttons — the selected job lights up (accent
// border + glow), the rest sit muted. Small and clean; tapping one switches.
// Sized to its content (not full width), so it stays light against the hero.
const JobSwitch = ({ jobs, value, onSelect, disabled }) => (
  <View style={styles.jobSwitch}>
    {jobs.map((j) => {
      const selected = j.key === value;
      return (
        <Pressable
          key={j.key}
          onPress={() => onSelect(j.key)}
          disabled={disabled}
          style={[styles.jobPill, selected && styles.jobPillSelected]}
        >
          <Text style={[styles.jobPillText, selected && styles.jobPillTextSelected]}>
            {j.label}
          </Text>
        </Pressable>
      );
    })}
  </View>
);

// ─── Action tile ────────────────────────────────────────────────────────────
// One tappable destination — a clean menu row: a single accent handle as the
// anchor (identical on every row — no icons, no numbers), then the label +
// description and a chevron. Single accent, so the four rows read as one calm,
// uniform set. Owns:
//   • entrance  — staggered slide-up + fade-in cascade on mount
//   • press     — a subtle scale-down + chevron nudge (no layout shift)
const ActionTile = ({ index, label, desc, onPress }) => {
  const enter = useRef(new Animated.Value(0)).current;   // 0 → 1 entrance
  const press = useRef(new Animated.Value(0)).current;   // 0 idle → 1 pressed

  useEffect(() => {
    // Staggered entrance — each row resolves a beat after the one above it.
    Animated.sequence([
      Animated.delay(200 + index * 80),
      Animated.spring(enter, { toValue: 1, useNativeDriver: true, friction: 8, tension: 60 }),
    ]).start();
  }, [enter, index]);

  const onIn = () =>
    Animated.spring(press, { toValue: 1, useNativeDriver: true, friction: 6, tension: 220 }).start();
  const onOut = () =>
    Animated.spring(press, { toValue: 0, useNativeDriver: true, friction: 5, tension: 180 }).start();

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [22, 0] });
  const scale = Animated.multiply(
    enter.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }),
    press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.98] })
  );
  const chevronX = press.interpolate({ inputRange: [0, 1], outputRange: [0, 5] });

  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY }, { scale }] }}>
      <Pressable onPress={onPress} onPressIn={onIn} onPressOut={onOut}>
        <View style={styles.tile}>
          {/* Uniform accent handle — the same anchor on every row. */}
          <View style={styles.handle} />
          <View style={styles.tileText}>
            <Text style={styles.label} numberOfLines={1}>{label}</Text>
            <Text style={styles.desc} numberOfLines={1}>{desc}</Text>
          </View>
          <Animated.Text style={[styles.chevron, { transform: [{ translateX: chevronX }] }]}>
            ›
          </Animated.Text>
        </View>
      </Pressable>
    </Animated.View>
  );
};

const AVATAR = 128;

const styles = StyleSheet.create({
  card: { flex: 1 },
  body: { flex: 1, width: '100%' },
  bodyContent: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 28 },

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
    color: '#FFFFFF',
    textShadowColor: 'rgba(180,225,255,0.55)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },

  actions: { gap: 16, marginTop: 4 },

  heroEmail: {
    fontFamily: F.bodyMed,
    fontSize: 13,
    letterSpacing: 0.6,
    color: ACCENT,
    marginTop: 8,
    opacity: 0.9,
  },

  // ── Danger zone ──
  // Set apart by a rule and its own red accent so it can never be mistaken for
  // one more navigation tile.
  dangerZone: {
    marginTop: 34,
    paddingTop: 22,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,42,60,0.28)',
  },
  dangerBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.alarmRed,
    backgroundColor: 'rgba(255,42,60,0.08)',
  },
  dangerBtnText: {
    fontFamily: F.heading,
    fontSize: 16,
    color: C.alarmRed,
    letterSpacing: 2.5,
  },

  // ── Delete modal ──
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,5,12,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: C.surface,
    borderWidth: 2,
    borderColor: C.alarmRed,
    borderRadius: 14,
    padding: 26,
    gap: 14,
  },
  modalTitle: {
    fontFamily: F.heading,
    fontSize: 22,
    color: C.alarmRed,
    letterSpacing: 3,
    textAlign: 'center',
  },
  modalBody: {
    fontFamily: F.body,
    fontSize: 14,
    lineHeight: 21,
    color: C.text,
    letterSpacing: 0.3,
  },
  modalStrong: { fontFamily: F.bodyMed, color: '#FFFFFF' },
  modalLabel: {
    fontFamily: F.heading,
    fontSize: 12,
    color: '#4a6a8a',
    letterSpacing: 2,
    marginTop: 4,
  },
  modalInput: {
    borderWidth: 1.5,
    borderColor: 'rgba(255,42,60,0.45)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: F.bodyMed,
    fontSize: 16,
    letterSpacing: 3,
    color: C.text,
    backgroundColor: '#0a1424',
  },
  modalError: {
    fontFamily: F.body,
    fontSize: 12,
    color: C.alarmRed,
    letterSpacing: 0.3,
  },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 6 },
  modalCancel: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(74,158,191,0.35)',
  },
  modalCancelText: {
    fontFamily: F.heading,
    fontSize: 14,
    color: '#8fb3cc',
    letterSpacing: 2,
  },
  modalConfirm: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.alarmRed,
    backgroundColor: 'rgba(255,42,60,0.12)',
  },
  modalConfirmOff: { opacity: 0.4 },
  modalConfirmText: {
    fontFamily: F.heading,
    fontSize: 14,
    color: C.alarmRed,
    letterSpacing: 2,
  },

  // ── Job switch ──
  jobBlock: { marginBottom: 22 },
  jobLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  jobLabel: {
    fontFamily: F.heading,
    fontSize: 15,
    color: '#4a6a8a',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  // Compact one-word pill buttons — hug their content, sit left-aligned.
  jobSwitch: {
    flexDirection: 'row',
    gap: 10,
  },
  jobPill: {
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(74,158,191,0.28)',
    backgroundColor: C.surface,
  },
  jobPillSelected: {
    borderColor: ACCENT,
    borderWidth: 1.5,
    backgroundColor: 'rgba(74,158,191,0.16)',
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
  },
  jobPillText: {
    fontFamily: F.heading,
    fontSize: 14,
    color: '#4a6a8a',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  jobPillTextSelected: {
    color: C.text,
    textShadowColor: 'rgba(74,158,191,0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  jobError: {
    fontFamily: F.body,
    fontSize: 12,
    color: C.alarmRed,
    marginTop: 8,
    letterSpacing: 0.3,
  },

  // ── Tile — a clean menu row, single accent ──
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(74,158,191,0.30)',
    backgroundColor: C.surface,
    paddingVertical: 20,
    paddingLeft: 22,
    paddingRight: 20,
    gap: 20,
    overflow: 'hidden',
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
  },
  // Uniform accent handle — a short rounded bar, identical on every row. The
  // single splash of colour that anchors the label (replaces the numeral).
  handle: {
    width: 4,
    height: 34,
    borderRadius: 2,
    backgroundColor: ACCENT,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
  },
  tileText: { flex: 1 },
  label: {
    fontFamily: F.heading,
    fontSize: 19,
    color: C.text,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  desc: {
    fontFamily: F.bodyMed,
    fontSize: 13,
    color: '#5a7a9a',
    letterSpacing: 0.4,
    marginTop: 5,
  },
  chevron: {
    fontFamily: F.heading,
    fontSize: 26,
    color: ACCENT,
    marginLeft: 2,
  },
});
