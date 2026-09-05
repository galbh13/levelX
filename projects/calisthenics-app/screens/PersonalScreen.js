import { useCallback, useState } from 'react';
import {
  View, Text, Image, StyleSheet, ScrollView, Pressable, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { supabase } from '../lib/supabase';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import PillButton from '../components/PillButton';
import { useTourTarget } from '../lib/tourTargets';
import {
  uploadAvatar, fetchPlayerNotes, savePlayerNotes, MAX_NOTE_CHARS,
} from '../lib/profile';

// ─── PROFILE (player tab) ───────────────────────────────────────────────────
// The tab was PERSONAL, then THE SYSTEM, and since 2026-09-04 it reads PROFILE.
// The route is still named `Personal` internally (the tab bar, the guided tour
// and every `navigate('Personal')` call key off that name) — only the label the
// player reads changed.
//
// This tab isn't about the training; it's the gaming layer around it. A portrait
// the player uploads, then three ICE PANELS (HomeScreen's panel language):
//   1. PLAYER & GOALS — two free-text fields (who you are · where you're going),
//      written and rewritten by the player. Stored on `profiles.bio` /
//      `profiles.end_goal` (migration 20260904_profile_bio_goal.sql).
//   2. PLAYER CARD — opens HunterStatusScreen (status card + signature move).
//      That screen used to hang off the deleted community group roster; the
//      PROFILE tab is where it belongs, and this is now its only entry point.
//   3. THE SYSTEM [coming soon...] — the locked node. The coach's online course
//      (nutrition, sleep, recovery) lands behind it once it's recorded; until
//      then it reads as a node that EXISTS and isn't open yet, rather than as an
//      empty screen.
//
// The portrait is the SAME avatar as the Player Card (`profiles.avatar_url`) —
// one picture per player, editable from either place.

// The house panel palette, same values HomeScreen's mission/quest panels use —
// this screen is chrome, not a new theme.
const ACCENT = C.deepBlue;          // house accent — frame, header, panel bars
const PANEL  = '#070d1a';           // panel ground
const BORDER = '#1a3a5c';           // panel edge
const LOCKED     = '#2c4a66';       // the coming-soon panel's dimmed accent (bar, rules)
const LOCKED_INK = '#4d7599';       // its TITLE — dimmer than the live panel, still readable

// Initials fallback when a player has no portrait — first letter of up to two
// name words (e.g. "Gal Ben Hamo" → "GB"). Same rule as the Player Card.
function initialsOf(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

// One field inside the PLAYER & GOALS node. Reads as a plain glowing line of
// text until the node is in edit mode, where it becomes the input — so the node
// is a profile first and a form second.
function NoteField({ label, hint, value, editing, onChangeText }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {editing ? (
        <>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={onChangeText}
            placeholder={hint}
            placeholderTextColor="#2a4a6a"
            multiline
            maxLength={MAX_NOTE_CHARS}
            textAlignVertical="top"
          />
          <Text style={styles.counter}>{value.length}/{MAX_NOTE_CHARS}</Text>
        </>
      ) : (
        <Text style={[styles.fieldText, !value && styles.fieldEmpty]}>
          {value || hint}
        </Text>
      )}
    </View>
  );
}

export default function PersonalScreen({ navigation }) {
  // Element the guided tour measures + points its arrow at.
  const tourSystemRef = useTourTarget('personal.system');

  const [me, setMe] = useState(null);            // { id, fullName, avatarUrl }
  const [loading, setLoading] = useState(true);
  const [busyAvatar, setBusyAvatar] = useState(false);

  const [bio, setBio] = useState('');
  const [endGoal, setEndGoal] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  // What was on the server when we last loaded/saved — CANCEL restores it.
  const [saved, setSaved] = useState({ bio: '', endGoal: '' });

  const load = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const [{ data: p }, notes] = await Promise.all([
        supabase.from('profiles').select('full_name, avatar_url').eq('id', user.id).maybeSingle(),
        fetchPlayerNotes(user.id),
      ]);
      setMe({ id: user.id, fullName: p?.full_name ?? null, avatarUrl: p?.avatar_url ?? null });
      setSaved(notes);
      // Never clobber something the player is in the middle of typing (the tab
      // reloads on every focus, and a tab switch mid-edit would eat the draft).
      setEditing(e => {
        if (!e) { setBio(notes.bio); setEndGoal(notes.endGoal); }
        return e;
      });
    } catch (e) {
      console.error('[PersonalScreen] load:', e);
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function pickAvatar() {
    if (!me?.id) return;
    setErrorMsg('');
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { setErrorMsg('Media library permission is required.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 0.8,
    });
    if (result.canceled) return;

    setBusyAvatar(true);
    try {
      const url = await uploadAvatar(me.id, result.assets[0]);
      setMe(m => ({ ...m, avatarUrl: url }));
    } catch (e) {
      setErrorMsg(e.message ?? 'Upload failed.');
    }
    setBusyAvatar(false);
  }

  async function save() {
    if (!me?.id) return;
    setSaving(true);
    setErrorMsg('');
    try {
      await savePlayerNotes(me.id, { bio, endGoal });
      const next = { bio: bio.trim(), endGoal: endGoal.trim() };
      setSaved(next);
      setBio(next.bio);
      setEndGoal(next.endGoal);
      setEditing(false);
    } catch (e) {
      setErrorMsg(e.message ?? 'Could not save.');
    }
    setSaving(false);
  }

  function cancel() {
    setBio(saved.bio);
    setEndGoal(saved.endGoal);
    setErrorMsg('');
    setEditing(false);
  }

  return (
    <ScreenFrame fill>
      <View style={styles.card}>
        <ScreenHeader title="PROFILE" />

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {loading ? (
              <View style={styles.center}><ActivityIndicator size="large" color={ACCENT} /></View>
            ) : (
              <>
                {/* ── Portrait — tap to upload / change ── */}
                <Pressable style={styles.portraitWrap} disabled={busyAvatar} onPress={pickAvatar}>
                  <View style={styles.portraitRing}>
                    {me?.avatarUrl ? (
                      <Image source={{ uri: me.avatarUrl }} style={styles.portrait} />
                    ) : (
                      <View style={[styles.portrait, styles.portraitEmpty]}>
                        <Text style={styles.portraitInitials}>{initialsOf(me?.fullName)}</Text>
                      </View>
                    )}
                    {busyAvatar && (
                      <View style={styles.portraitBusy}><ActivityIndicator color={ACCENT} /></View>
                    )}
                  </View>
                  {!busyAvatar && (
                    <Text style={styles.portraitHint}>
                      {me?.avatarUrl ? 'TAP TO CHANGE' : 'TAP TO ADD PHOTO'}
                    </Text>
                  )}
                </Pressable>

                <Text style={styles.name} numberOfLines={2}>
                  {me?.fullName?.toUpperCase() ?? '—'}
                </Text>

                {/* ── The two panels — the app's standard ice-panel language ── */}
                <View style={styles.panels}>

                  {/* PANEL 1 — PLAYER & GOALS (the player's own words) */}
                  <View style={styles.panel}>
                    <View style={styles.panelHeader}>
                      <View style={styles.panelHeaderBar} />
                      <Text style={[styles.panelHeaderText, styles.panelHeaderFill]} numberOfLines={1}>PLAYER & GOALS</Text>
                      {!editing && (
                        <PillButton
                          label={saved.bio || saved.endGoal ? 'EDIT' : '＋ WRITE'}
                          size="sm"
                          onPress={() => setEditing(true)}
                        />
                      )}
                    </View>
                    <View style={styles.panelDivider} />

                    <NoteField
                      label="PLAYER PROFILE"
                      hint="Who are you as a player? Where you started, what you train for, what drives you."
                      value={bio}
                      editing={editing}
                      onChangeText={setBio}
                    />
                    <View style={styles.fieldDivider} />
                    <NoteField
                      label="END GOAL"
                      hint="The one thing you're chasing. Name it — a skill, a hold, a number."
                      value={endGoal}
                      editing={editing}
                      onChangeText={setEndGoal}
                    />

                    {editing && (
                      <View style={styles.actions}>
                        <PillButton
                          label={saving ? 'SAVING…' : 'SAVE'}
                          tone="jade"
                          onPress={save}
                          loading={saving}
                        />
                        {!saving && (
                          <PillButton label="CANCEL" tone="muted" size="sm" onPress={cancel} />
                        )}
                      </View>
                    )}
                  </View>

                  {/* PANEL 2 — PLAYER CARD (the status card + signature move) */}
                  <Pressable
                    style={({ pressed }) => [styles.panel, styles.panelLink, pressed && styles.panelPressed]}
                    onPress={() => navigation.navigate('HunterStatus', { userId: me?.id })}
                  >
                    <View style={styles.panelHeader}>
                      <View style={styles.panelHeaderBar} />
                      <Text style={[styles.panelHeaderText, styles.panelHeaderFill]} numberOfLines={1}>
                        PLAYER CARD
                      </Text>
                      <Text style={styles.panelArrow}>›</Text>
                    </View>
                    <View style={styles.panelDivider} />
                    <Text style={styles.panelBlurb}>
                      Your status card — LVL, class and prestige — plus your signature move.
                    </Text>
                  </Pressable>

                  {/* PANEL 3 — THE SYSTEM (locked; the coach's course lands here) */}
                  <View style={[styles.panel, styles.panelLocked]} ref={tourSystemRef} collapsable={false}>
                    <View style={styles.panelHeader}>
                      <View style={[styles.panelHeaderBar, styles.panelHeaderBarLocked]} />
                      <Text style={[styles.panelHeaderText, styles.panelHeaderTextLocked]} numberOfLines={1}>
                        THE SYSTEM
                      </Text>
                      <Text style={[styles.soon, styles.panelHeaderFill]} numberOfLines={1}>[coming soon...]</Text>
                    </View>
                    <View style={[styles.panelDivider, styles.panelDividerLocked]} />
                    <Text style={styles.lockedText}>
                      Nutrition, sleep, recovery — everything around the training.
                    </Text>
                  </View>
                </View>

                {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1 },
  flex: { flex: 1 },
  body: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 34 },
  center: { paddingVertical: 60, alignItems: 'center' },

  // ── Portrait ──
  portraitWrap: { alignItems: 'center', marginTop: 4 },
  portraitRing: {
    width: 128, height: 128, borderRadius: 64,
    borderWidth: 2, borderColor: ACCENT,
    alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface,
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 20,
  },
  portrait: { width: 112, height: 112, borderRadius: 56 },
  portraitEmpty: {
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(74,158,191,0.10)',
  },
  portraitInitials: {
    fontFamily: F.heading, fontSize: 46, color: ACCENT, letterSpacing: 2,
    textShadowColor: 'rgba(74,158,191,0.6)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 14,
  },
  portraitBusy: {
    ...StyleSheet.absoluteFillObject, borderRadius: 64,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,9,18,0.55)',
  },
  portraitHint: { fontFamily: F.heading, fontSize: 12, color: '#4a6a8a', letterSpacing: 2, marginTop: 10 },
  name: {
    fontFamily: F.heading, fontSize: 30, color: '#FFFFFF', letterSpacing: 3,
    textAlign: 'center', marginTop: 14,
    textShadowColor: 'rgba(255,255,255,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 16,
  },

  // ── The two panels ──
  // Deliberately the SAME ice-panel language as HomeScreen's TODAY'S MISSIONS /
  // DAILY QUESTS: the dark panel over the app's border blue, a 4px accent bar
  // beside a big glow title, then a hairline divider. An earlier cut hung them
  // off a quest-tree spine with diamond gems — a second visual system for two
  // items, on a screen that isn't a tree.
  panels: { marginTop: 26, gap: 18 },
  panel: {
    backgroundColor: PANEL,
    borderWidth: 1.5, borderColor: BORDER, borderRadius: 12,
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 18,
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.18, shadowRadius: 16,
  },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  panelHeaderBar: {
    width: 4, height: 24, borderRadius: 2, backgroundColor: ACCENT,
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 6,
  },
  // Typography ONLY — no flex here. A `flex: 1` base that a variant then tries to
  // undo with flexGrow/flexBasis is a shorthand-vs-longhand fight whose winner
  // depends on the platform's style resolution; on web the shorthand won and the
  // locked title laid out at zero width (THE SYSTEM vanished, leaving a header
  // that read only "[coming soon...]"). Each panel opts INTO the fill instead.
  panelHeaderText: { fontFamily: F.heading, fontSize: 22, color: ACCENT, letterSpacing: 1 },
  panelHeaderFill: { flex: 1 },
  panelDivider: { height: 1, backgroundColor: BORDER, opacity: 0.6, marginTop: 14, marginBottom: 16 },

  // ── A field inside the PLAYER & GOALS node ──
  field: { gap: 8 },
  fieldLabel: { fontFamily: F.heading, fontSize: 12, color: '#4a6a8a', letterSpacing: 3 },
  fieldText: { fontFamily: F.bodyMed, fontSize: 15, color: C.text, letterSpacing: 0.3, lineHeight: 23 },
  fieldEmpty: { color: '#3a5a7a', fontStyle: 'italic' },
  fieldDivider: { height: 1, backgroundColor: ACCENT, opacity: 0.18, marginVertical: 16 },
  input: {
    fontFamily: F.bodyMed, fontSize: 15, color: C.text, letterSpacing: 0.3, lineHeight: 22,
    minHeight: 92, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(74,158,191,0.5)',
    backgroundColor: C.lockedBg, paddingHorizontal: 12, paddingVertical: 10,
  },
  counter: { fontFamily: F.bodyMed, fontSize: 11, color: '#2a4a6a', letterSpacing: 1, alignSelf: 'flex-end' },
  actions: { flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 18 },

  // A panel that GOES somewhere — same box, a chevron instead of a chip, and a
  // press state. The Player Card is the one of the three that opens a screen.
  panelLink: {},
  panelPressed: { opacity: 0.7 },
  panelArrow: { fontFamily: F.heading, fontSize: 26, color: ACCENT, marginTop: -4 },
  panelBlurb: {
    fontFamily: F.bodyMed, fontSize: 14, color: '#5a7a9a', letterSpacing: 0.3, lineHeight: 21,
  },

  // ── The locked panel ──
  // Same panel, one step down in every dimension — dimmer border, no glow, muted
  // ink — so it reads as "this exists and isn't open yet", not as a dead box.
  panelLocked: { borderColor: C.lockedBorder, shadowOpacity: 0 },
  panelHeaderBarLocked: { backgroundColor: LOCKED, shadowOpacity: 0 },
  // NOT `flex: 0` — in React Native that is grow 0 / shrink 0 / **basis 0**, so
  // the title measured zero width and THE SYSTEM disappeared entirely, leaving a
  // header that read only "[coming soon...]". Size to the text, shrink if needed.
  panelHeaderTextLocked: { color: LOCKED_INK },
  panelDividerLocked: { opacity: 0.35 },
  soon: { fontFamily: F.bodyMed, fontSize: 13, color: '#2a4a6a', letterSpacing: 1 },
  lockedText: {
    fontFamily: F.bodyMed, fontSize: 14, color: '#2a4a6a', letterSpacing: 0.3, lineHeight: 21,
  },

  error: {
    fontFamily: F.bodyMed, fontSize: 14, color: '#FF6B6B', letterSpacing: 0.4,
    textAlign: 'center', marginTop: 16, lineHeight: 20,
  },
});
