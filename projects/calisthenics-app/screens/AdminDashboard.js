import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Animated, Easing, Modal, TextInput,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useCoach } from '../context/CoachContext';
import { useAdminNotify } from '../context/AdminNotifyContext';
import { prestigeStars } from '../lib/prestige';
import {
  invitePlayer, isValidEmail, isValidPhone, isValidBirthday, normalizePhone, STARTER_PASSWORD,
} from '../lib/invites';
import { DEFAULT_JOB } from '../lib/jobs';
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
  alert:     '#E11D48',   // "you owe someone a reply" red
  jade:      '#1FD79A',   // "unread — just look at it" green
};

const STAGGER = 70;   // ms between consecutive row entrances
const MAX_STAGGER_ROWS = 9; // cap cumulative delay so long rosters don't crawl in

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatJoinDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// Prestige count → roman numeral (counts are small; a lookup covers it).
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const roman = (n) => ROMAN[n] ?? String(n);

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

// ─── Notification button ───────────────────────────────────────────────────────
// A top-bar pill that carries a pulsing dot + count while its queue is non-empty
// (check-ups awaiting a reply, unread chat messages). At zero it reads exactly
// like the plain pills beside it, so the dot is the whole signal.
function NotifyBtn({ label, count, tone = 'alert', onPress }) {
  const color = tone === 'jade' ? SL.jade : SL.alert;
  const live = count > 0;

  // Slow breathe on the dot so an unattended queue keeps catching the eye.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!live) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [live, pulse]);
  const dotScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });

  return (
    <TapScale
      style={[styles.topBarBtn, live && { borderColor: color, shadowColor: color, backgroundColor: 'rgba(255,255,255,0.03)' }]}
      onPress={onPress}
    >
      <Text style={[styles.topBarBtnText, live && { color }]} numberOfLines={1}>{label}</Text>
      {live ? (
        <Animated.View
          style={[
            styles.notifyDot,
            { backgroundColor: color, shadowColor: color, transform: [{ scale: dotScale }] },
          ]}
        >
          <Text style={styles.notifyDotText}>{count > 9 ? '9+' : count}</Text>
        </Animated.View>
      ) : null}
    </TapScale>
  );
}

// ─── Invite modal ──────────────────────────────────────────────────────────────
// The coach's "new disciple" flow: type an email + full name + phone + birthday,
// and the `invite-player` edge function creates the account and emails them their
// credentials. Everything privileged happens server-side (see lib/invites.js);
// this is purely the form + its three states (form → sending → sent).
//
// Phone and birthday are asked for here because this is the ONE moment the coach
// has them in hand. They land on `profiles` as the player's GLOBAL contact
// details — the same two values the BUSINESS card shows — and the phone is
// repeated back on the success card ready to paste into WhatsApp.
function InviteModal({ visible, onClose, onInvited }) {
  const [email,    setEmail]    = useState('');
  const [fullName, setFullName] = useState('');
  const [phone,    setPhone]    = useState('');
  const [birthday, setBirthday] = useState('');
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState('');
  const [done,     setDone]     = useState(null); // { email, phone, emailed, warning }

  // Reopening is always a blank slate — a stale success card or error from the
  // last invite must never greet the next one.
  useEffect(() => {
    if (visible) {
      setEmail(''); setFullName(''); setPhone(''); setBirthday('');
      setError(''); setDone(null); setBusy(false);
    }
  }, [visible]);

  // Birthday is the one optional field — a coach who doesn't know it yet can
  // fill it in later on the business card. A half-typed date still blocks.
  const canSubmit =
    isValidEmail(email) && fullName.trim().length > 0 &&
    isValidPhone(phone) && isValidBirthday(birthday) && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      const res = await invitePlayer({ email, fullName, phone, birthday });
      setDone({
        email: email.trim().toLowerCase(),
        phone: res?.phone || normalizePhone(phone),
        emailed: res?.emailed !== false,
        warning: res?.warning,
      });
      onInvited?.();                      // refresh the roster behind the modal
    } catch (e) {
      setError(e?.message || 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{done ? 'PLAYER IS IN' : 'NEW PLAYER'}</Text>
          <View style={styles.modalRule} />

          {done ? (
            <>
              <Text style={styles.modalBody}>
                <Text style={styles.modalStrong}>{done.email}</Text> now has an account and
                can sign in with the starter password below. They will be asked to set
                their own password the first time they log in.
              </Text>

              <View style={styles.credBox}>
                <Text style={styles.credLabel}>PASSWORD</Text>
                <Text style={styles.credValue}>{STARTER_PASSWORD}</Text>
                {/* Repeated back for the other half of onboarding: adding them
                    to the WhatsApp community. */}
                <Text style={[styles.credLabel, styles.credLabelSpaced]}>PHONE · ADD TO WHATSAPP</Text>
                <Text style={styles.credPhone}>{done.phone}</Text>
              </View>

              <Text style={[styles.modalNote, done.emailed ? styles.noteOk : styles.noteWarn]}>
                {done.emailed
                  ? '✓ Welcome email sent.'
                  : (done.warning || 'The welcome email did not send — pass the details on yourself.')}
              </Text>

              <TapScale style={[styles.modalBtn, styles.modalBtnPrimary]} onPress={onClose}>
                <Text style={styles.modalBtnPrimaryText}>DONE</Text>
              </TapScale>
            </>
          ) : (
            <>
              <Text style={styles.fieldLabel}>EMAIL</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="player@email.com"
                placeholderTextColor={SL.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                editable={!busy}
              />

              <Text style={styles.fieldLabel}>FULL NAME</Text>
              <TextInput
                style={styles.input}
                value={fullName}
                onChangeText={setFullName}
                placeholder="Their name"
                placeholderTextColor={SL.muted}
                autoCapitalize="words"
                editable={!busy}
              />

              {/* The WhatsApp number. Required — adding them to the community is
                  part of onboarding, and this is the only moment the coach has
                  the number to hand. */}
              <Text style={styles.fieldLabel}>PHONE</Text>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                placeholder="+972 50 000 0000"
                placeholderTextColor={SL.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="phone-pad"
                editable={!busy}
              />

              {/* Optional — the coach can fill it in later on the business card.
                  Same YYYY-MM-DD shape that card uses, because it's the same
                  value: profiles.birthday. */}
              <Text style={styles.fieldLabel}>BIRTHDAY · OPTIONAL</Text>
              <TextInput
                style={styles.input}
                value={birthday}
                onChangeText={setBirthday}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={SL.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                editable={!busy}
                onSubmitEditing={submit}
              />

              {error ? <Text style={styles.modalError}>{error}</Text> : null}

              <View style={styles.modalActions}>
                <TapScale style={styles.modalBtn} onPress={busy ? undefined : onClose} disabled={busy}>
                  <Text style={styles.modalBtnText}>CANCEL</Text>
                </TapScale>
                <TapScale
                  style={[styles.modalBtn, styles.modalBtnPrimary, !canSubmit && styles.modalBtnOff]}
                  onPress={submit}
                  disabled={!canSubmit}
                >
                  {busy
                    ? <ActivityIndicator size="small" color={SL.accent} />
                    : <Text style={styles.modalBtnPrimaryText}>CREATE &amp; EMAIL</Text>}
                </TapScale>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
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
          <View style={styles.nameRow}>
            <Text style={[styles.playerName, styles.nameFlex]} numberOfLines={1}>
              {player.full_name || '(no name)'}
            </Text>
            {stars > 0 ? (
              <View style={styles.prestigeMini}>
                <View style={styles.prestigeMiniGem} />
                <View style={styles.prestigeMiniInner} />
                <Text style={styles.prestigeMiniNum}>{roman(stars)}</Text>
              </View>
            ) : null}
          </View>
          {/* The email IS the username — showing it here is what makes the
              roster a usable account list (who is who, which test address is
              which) without opening every player. */}
          <Text style={styles.playerEmail} numberOfLines={1}>{player.email || '(no email)'}</Text>
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
  const { checkups, unreadChats, refresh: refreshNotify } = useAdminNotify();
  const [players,    setPlayers]    = useState([]);
  const [classNames, setClassNames] = useState({}); // class_id → name
  const [classOrder, setClassOrder] = useState({}); // class_id → order_index
  const [jobCounts,  setJobCounts]  = useState({}); // job → class count
  const [loading,    setLoading]    = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);

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
          .select('id, full_name, email, class_id, prestige_count, created_at, job')
          .eq('role', 'player')
          .order('created_at', { ascending: true }),
        supabase
          .from('classes')
          .select('id, name, order_index, job'),
      ]);

      const classes = classesRes.data ?? [];
      setPlayers(playersRes.data ?? []);
      setClassNames(Object.fromEntries(classes.map(c => [c.id, c.name])));
      setClassOrder(Object.fromEntries(classes.map(c => [c.id, c.order_index])));
      // Class count per job — stars are scoped to the player's own job ladder.
      const counts = {};
      classes.forEach(c => { const j = c.job ?? 'static'; counts[j] = (counts[j] ?? 0) + 1; });
      setJobCounts(counts);
    } catch (e) {
      console.error('[AdminDashboard] fetchData exception:', e);
    }
  }, []);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  // Returning to the dashboard re-checks both queues so a just-answered check-up
  // or a just-read chat drops its dot immediately.
  // Returning also re-reads the roster itself — a player deleted from
  // PlayerAdminScreen must not linger on the list behind it.
  useFocusEffect(useCallback(() => { refreshNotify(); fetchData(); }, [refreshNotify, fetchData]));

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
          {/* The whole onboarding flow: email + name → account created + welcome
              email sent from the business Gmail. See lib/invites.js. */}
          <TapScale
            style={[styles.topBarBtn, styles.inviteBtn]}
            onPress={() => setInviteOpen(true)}
          >
            <Text style={[styles.topBarBtnText, styles.inviteBtnText]} numberOfLines={1}>＋ NEW PLAYER</Text>
          </TapScale>

          <TapScale
            style={styles.topBarBtn}
            onPress={() => navigation.navigate('ExerciseGallery')}
          >
            <Text style={styles.topBarBtnText} numberOfLines={1}>GALLERY</Text>
          </TapScale>

          <TapScale
            style={styles.topBarBtn}
            onPress={() => navigation.navigate('CheckupTemplates')}
          >
            <Text style={styles.topBarBtnText} numberOfLines={1}>CHECKUP EDITOR</Text>
          </TapScale>

          {/* The money view of the same roster — MRR, what came in this month,
              who owes, who's about to quit. Admin-only end to end. */}
          <TapScale
            style={[styles.topBarBtn, styles.businessBtn]}
            onPress={() => navigation.navigate('Business')}
          >
            <Text style={[styles.topBarBtnText, styles.businessBtnText]} numberOfLines={1}>BUSINESS</Text>
          </TapScale>

          {/* The two "someone is waiting on you" buttons. Each wears a dot while
              its queue isn't empty — red for check-ups you owe a reply to, jade
              for chat messages you haven't read yet. */}
          <NotifyBtn
            label="CHECK-UP INBOX"
            count={checkups}
            tone="alert"
            onPress={() => navigation.navigate('CheckupInbox')}
          />

          <NotifyBtn
            label="CHAT NOTES"
            count={unreadChats}
            tone="jade"
            onPress={() => navigation.navigate('ChatNotes')}
          />

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
                  stars={prestigeStars({
                    orderIndex: classOrder[player.class_id] ?? 0,
                    classCount: jobCounts[player.job ?? DEFAULT_JOB] ?? null,
                  })}
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

      <InviteModal
        visible={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={fetchData}
      />
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
  // Five actions wrap into a 2-per-row grid so they never crowd a phone width
  // (GALLERY · CHECKUP EDITOR / CHECK-UP INBOX · CHAT NOTES / SIGN OUT).
  topBarButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignSelf: 'stretch',
    justifyContent: 'space-between',
    gap: 8,
  },
  topBarBtn: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 0,
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
  // Count badge pinned to the pill's top-right corner — the "check this out"
  // marker. Sits half-outside the pill so it reads as an alert, not a label.
  notifyDot: {
    position: 'absolute',
    top: -7,
    right: -6,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 6,
  },
  notifyDotText: {
    fontFamily: F.heading,
    fontSize: 12,
    color: '#050912',
    letterSpacing: 0.5,
  },

  // ＋ NEW PLAYER — the one CREATE action on the bar, so it wears the gold
  // treasure accent to sit apart from the navigation pills beside it.
  inviteBtn: {
    borderColor: SL.gold,
    backgroundColor: 'rgba(255,215,0,0.08)',
    shadowColor: SL.gold,
  },
  inviteBtnText: { color: SL.gold },

  // BUSINESS wears the jade "money" accent so it reads as a different KIND of
  // action from the training buttons beside it.
  businessBtn: {
    borderColor: SL.jade,
    backgroundColor: 'rgba(31,215,154,0.08)',
    shadowColor: SL.jade,
  },
  businessBtnText: { color: SL.jade },

  // ─── Invite modal ───────────────────────────────────────────────────────────
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,5,12,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 600,
    backgroundColor: SL.panel,
    borderWidth: 2,
    borderColor: SL.border,
    borderRadius: 18,
    padding: 40,
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.35, shadowRadius: 20,
  },
  modalTitle: {
    fontFamily: F.heading,
    fontSize: 34,
    color: SL.gold,
    letterSpacing: 6,
    textAlign: 'center',
  },
  modalRule: {
    height: 2,
    backgroundColor: SL.border,
    marginTop: 18,
    marginBottom: 26,
  },
  modalBody: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    lineHeight: 25,
    color: SL.text,
    marginBottom: 26,
  },
  modalStrong: { fontFamily: F.body, color: SL.gold },
  fieldLabel: {
    fontFamily: F.heading,
    fontSize: 14,
    color: SL.accent,
    letterSpacing: 3,
    marginBottom: 10,
  },
  input: {
    backgroundColor: SL.panelAlt,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 17,
    fontFamily: F.body,
    fontSize: 19,
    color: SL.text,
    marginBottom: 22,
  },
  modalError: {
    fontFamily: F.body,
    fontSize: 15,
    lineHeight: 22,
    color: SL.alert,
    marginBottom: 18,
  },
  modalActions: { flexDirection: 'row', gap: 14, marginTop: 6 },
  modalBtn: {
    flex: 1,
    borderWidth: 2,
    borderColor: SL.border,
    borderRadius: 999,
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 60,
  },
  modalBtnText: {
    fontFamily: F.heading,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 2.5,
  },
  modalBtnPrimary: {
    borderColor: SL.accent,
    backgroundColor: 'rgba(74,158,191,0.12)',
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 10,
  },
  modalBtnPrimaryText: {
    fontFamily: F.heading,
    fontSize: 16,
    color: SL.accent,
    letterSpacing: 2.5,
  },
  modalBtnOff: { opacity: 0.4 },

  // Success card — the starter password stays readable so the coach can pass it
  // on by hand if the email never lands.
  credBox: {
    backgroundColor: SL.panelAlt,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 12,
    paddingVertical: 22,
    alignItems: 'center',
    marginBottom: 24,
  },
  credLabel: {
    fontFamily: F.heading,
    fontSize: 13,
    color: SL.muted,
    letterSpacing: 3,
    marginBottom: 9,
  },
  credValue: {
    fontFamily: F.heading,
    fontSize: 30,
    color: SL.gold,
    letterSpacing: 6,
  },
  // The phone sits under the password in the same box — same readout, quieter
  // ink, because the password is the one the player is waiting on.
  credLabelSpaced: {
    marginTop: 20,
  },
  credPhone: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.accent,
    letterSpacing: 3,
  },
  modalNote: {
    fontFamily: F.body,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 26,
  },
  noteOk:   { color: SL.jade },
  noteWarn: { color: SL.alert },

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
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameFlex: { flexShrink: 1 },
  playerName: {
    fontFamily: F.heading,
    fontSize: 26,
    color: SL.text,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  // Prestige medallion (roster) — a gold gem holding the count as a roman numeral,
  // matching the Player Card's prestige crest. Sized to sit beside the 26px name.
  prestigeMini: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 4 },
  prestigeMiniGem: {
    position: 'absolute', width: 32, height: 32, borderRadius: 7,
    borderWidth: 2, borderColor: SL.gold, backgroundColor: 'rgba(255,215,0,0.06)',
    transform: [{ rotate: '45deg' }],
    shadowColor: SL.gold, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.85, shadowRadius: 14, elevation: 5,
  },
  prestigeMiniInner: {
    position: 'absolute', width: 22, height: 22, borderRadius: 5,
    borderWidth: 1.2, borderColor: SL.gold, opacity: 0.4, transform: [{ rotate: '45deg' }],
  },
  prestigeMiniNum: {
    fontFamily: F.displayHeavy, fontSize: 15, color: SL.gold, letterSpacing: 0.5,
    textShadowColor: 'rgba(255,215,0,0.85)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8,
  },
  playerEmail: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.accent,
    letterSpacing: 0.5,
    opacity: 0.85,
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
  cardChevron: {
    fontFamily: F.heading,
    fontSize: 30,
    color: SL.accent,
    marginLeft: 14,
    marginTop: -2,
  },
});
