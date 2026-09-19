import { useCallback, useState } from 'react';
import {
  View, Text, Image, StyleSheet, ScrollView, Pressable, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { supabase } from '../lib/supabase';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import { useTourTarget } from '../lib/tourTargets';
import { useTour } from '../context/TourContext';
import { TUTORIAL_ENABLED } from '../constants/flags';
import { uploadAvatar } from '../lib/profile';

// ─── PROFILE (player tab) ───────────────────────────────────────────────────
// The tab was PERSONAL, then THE SYSTEM, and since 2026-09-04 it reads PROFILE.
// The route is still named `Personal` internally (the tab bar, the guided tour
// and every `navigate('Personal')` call key off that name) — only the label the
// player reads changed.
//
// This tab isn't about the training; it's the gaming layer around it. A portrait
// the player uploads, then a list of panels in HomeScreen's panel language — each
// in its own colour so they read as different things, not one repeated box.
//
// TWO LISTS, ONE SCREEN. Since 2026-09-18 the four nodes are split in two, and
// pressing THE SYSTEM swaps the list IN PLACE (the `section` state below) rather
// than pushing a route — the portrait and the name stay put, only the panels
// change, and the header's BACK pill walks back out to the root list:
//
//   ROOT list
//     1. PLAYER CARD (ice) — opens HunterStatusScreen (the card itself: portrait,
//        LVL/class/prestige, PLAYER & GOALS, signature move). That screen used to
//        hang off the deleted community group roster; the PROFILE tab is where it
//        belongs. PLAYER & GOALS (`profiles.bio` / `profiles.end_goal`) used to
//        be its own panel HERE — on 2026-09-06 it moved ONTO the card, above the
//        signature move, where the player's own words belong.
//     2. THE 4-WEEK PLAN (ember) — the SPECIAL node, added 2026-09-18. The four
//        weeks the coach writes to carry a new disciple from their first day to
//        their first check-up cycle; see screens/FourWeekPlanScreen.js and
//        supabase/migrations/20260919_four_week_plan.sql. It is the only node on
//        this tab painted WARM, because it is the only one whose content was
//        written for this player by name — and the coach AUTHORS it from this
//        very screen's admin copy (AdminDashboard → player → PROFILE), so the
//        plan is written inside the page it is read in.
//     3. THE SYSTEM (purple) — no longer a locked node: it is the DOOR to the
//        second list. Everything that isn't ready yet lives behind it, so the root
//        list reads as live nodes instead of one live node with three
//        [coming soon...] boxes stacked under it.
//
//   THE SYSTEM list — what's behind the door, still all coming soon
//     1. TUTORIAL (gold) — replays the guided walkthrough (components/GuidedTour),
//        the same thing HomeScreen's TUTORIAL pill starts. Gated by
//        TUTORIAL_ENABLED (constants/flags) — while the tour is switched off for
//        release this node still SHOWS, locked, so the player knows it exists.
//     2. COMMON LANGUAGE (jade) — the app's vocabulary in one place (LVL, class,
//        prestige, quest, combo, the shapes). Last, because it is the thing you go
//        LOOK something up in, not somewhere you start.
//   The coach's online course (nutrition, sleep, recovery) lands in this list too
//   once it's recorded.
//
// None of them carries a blurb: the title says it, and a paragraph under each one
// turned the page into a wall of explanation.
//
// The admin reads the SAME screen for any player — see the adminView note below.
//
// The portrait is the SAME avatar as the Player Card (`profiles.avatar_url`) —
// one picture per player, editable from either place.

// The house panel palette, same values HomeScreen's mission/quest panels use —
// this screen is chrome, not a new theme.
const ACCENT = C.deepBlue;          // house accent — frame, header, panel bars
const PANEL  = '#070d1a';           // panel ground
const BORDER = '#1a3a5c';           // panel edge
// Each node panel carries its OWN colour so the four read as four different
// things at a glance, not one repeated box:
//   • PLAYER CARD → ICE. The same near-white icy blue the Player Card screen
//     itself is painted in (HunterStatusScreen's ACCENT), so the panel and the
//     screen behind it are obviously the same object.
//   • TUTORIAL    → GOLD. The tour's own 'gold' tone (GuidedTour's TONES.gold):
//     a guide, warm against the two cold panels around it, and the one thing on
//     this screen that talks rather than shows.
//   • 4-WEEK PLAN → EMBER. The ONE warm colour on a screen of cold ones, because
//     it is the one node addressed to this player personally. The colour alone
//     carries it — an earlier cut added a SPECIAL MISSION tag over the title and
//     it was noise: the row already reads as the odd one out.
//   • THE SYSTEM  → PURPLE. Off the app's whole cold-blue chrome on purpose: it
//     opens a different LAYER of the product, not another screen of this one.
//   • COMMON LANGUAGE → JADE. The last colour that isn't already spoken for here,
//     and far enough from the ice at the top that the four bars never read as one
//     gradient running down the screen.
const ICE       = '#CDF3FF';        // PLAYER CARD — bar, title, chevron
const ICE_EDGE  = '#3d7f9e';        // its border — the ice one step down, so the box isn't a glare
const GOLD      = '#FFD166';        // TUTORIAL — bar, title, chevron
const GOLD_EDGE = '#5c4620';        // its border — gold dimmed, not a bright rim
const PURPLE     = '#A970FF';       // THE SYSTEM — bar + title
const PURPLE_EDGE = '#3d2a66';      // its border
const JADE      = '#1FD79A';        // COMMON LANGUAGE — bar + title
const JADE_EDGE = '#1d4a3d';        // its border
const EMBER        = '#FF8A3D';     // 4-WEEK PLAN — bar, title, chevron
const EMBER_EDGE   = '#5c3312';     // its border — ember dimmed, not a bright rim

// Initials fallback when a player has no portrait — first letter of up to two
// name words (e.g. "Gal Ben Hamo" → "GB"). Same rule as the Player Card.
function initialsOf(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

export default function PersonalScreen({ navigation, route }) {
  // ADMIN VIEW. The same screen doubles as the admin's read of ONE player's
  // profile, reached from MANAGE PLAYER (AdminDashboard → player → PROFILE).
  // The admin stack passes `studentId` (or a whole `player` row); the player's
  // own tab passes nothing, and the screen resolves the signed-in user instead.
  // Every write from the admin copy (portrait, notes) leans on the admin-override
  // RLS policies in 20260621_admin_manage_players.sql.
  const viewedId  = route?.params?.studentId ?? route?.params?.player?.id ?? null;
  const adminView = !!viewedId;

  // Element the guided tour measures + points its arrow at. Only the player's
  // OWN tab registers it — the admin copy must not steal the tour's target.
  const tourSystemRef = useTourTarget('personal.system');

  // Replaying the walkthrough from here. The tour drives the tabs itself, so it
  // doesn't matter that we start it from PROFILE — it navigates to Home on its
  // own first step. Hidden for the admin's copy: the admin reading a player's
  // profile has no business launching that player's tutorial.
  const { openTour } = useTour();
  const tutorialLive = TUTORIAL_ENABLED && !adminView;

  // Which list the panels show: 'root' (PLAYER CARD · THE SYSTEM) or 'system'
  // (what sits behind THE SYSTEM). A plain state swap, NOT a route — the portrait
  // and the name above the list belong to both lists, and pushing a second screen
  // would rebuild them (and reload the profile) for a list of two panels.
  const [section, setSection] = useState('root');

  const [me, setMe] = useState(null);            // { id, fullName, avatarUrl }
  const [loading, setLoading] = useState(true);
  const [busyAvatar, setBusyAvatar] = useState(false);

  const [errorMsg, setErrorMsg] = useState('');

  const load = useCallback(async () => {
    try {
      let id = viewedId;
      if (!id) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setLoading(false); return; }
        id = user.id;
      }
      const { data: p } = await supabase
        .from('profiles').select('full_name, avatar_url').eq('id', id).maybeSingle();
      setMe({ id, fullName: p?.full_name ?? null, avatarUrl: p?.avatar_url ?? null });
    } catch (e) {
      console.error('[PersonalScreen] load:', e);
    }
    setLoading(false);
  }, [viewedId]);

  // Coming back to the tab always lands on the ROOT list. Leaving the tab from
  // inside THE SYSTEM and returning to it later would otherwise drop the player
  // straight into the inner list with no memory of how they got there.
  useFocusEffect(useCallback(() => { load(); return () => setSection('root'); }, [load]));

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

  return (
    <ScreenFrame fill>
      <View style={styles.card}>
        {/* Inside THE SYSTEM the header becomes that list's own title and BACK
            walks out to the root list first — only from there does it leave the
            screen at all (the admin's copy). */}
        <ScreenHeader
          title={
            section === 'system' ? 'THE SYSTEM'
              : adminView ? 'PLAYER PROFILE'
                : 'PROFILE'
          }
          onBack={
            section === 'system' ? () => setSection('root')
              : adminView ? () => navigation.goBack()
                : undefined
          }
        />

        <ScrollView
        contentContainerStyle={styles.body}
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

              {/* ── The panels — the app's standard ice-panel language ──
                  Two lists behind one `section` state; see the note up top. ── */}
              <View style={styles.panels}>
                {section === 'root' ? (
                  <>
                    {/* PLAYER CARD (ice) — the status card + signature move */}
                    <Pressable
                      style={({ pressed }) => [styles.panel, styles.panelIce, pressed && styles.panelPressed]}
                      onPress={() => navigation.navigate('HunterStatus', { userId: me?.id })}
                    >
                      <View style={styles.panelHeader}>
                        <View style={[styles.panelHeaderBar, styles.panelHeaderBarIce]} />
                        <Text style={[styles.panelHeaderText, styles.panelHeaderTextIce, styles.panelHeaderFill]} numberOfLines={1}>
                          PLAYER CARD
                        </Text>
                        <Text style={[styles.panelArrow, styles.panelArrowIce]}>›</Text>
                      </View>
                    </Pressable>

                    {/* 4-WEEK PLAN (ember) — the special node. The coach's
                        onboarding runway; the admin copy of this screen is also
                        where the coach WRITES it, which is why the node carries
                        the viewed player's id straight through. */}
                    <Pressable
                      style={({ pressed }) => [styles.panel, styles.panelPlan, pressed && styles.panelPressed]}
                      onPress={() => navigation.navigate('FourWeekPlan', adminView ? { studentId: me?.id } : undefined)}
                    >
                      <View style={styles.panelHeader}>
                        <View style={[styles.panelHeaderBar, styles.panelHeaderBarPlan]} />
                        <Text style={[styles.panelHeaderText, styles.panelHeaderTextPlan, styles.panelHeaderFill]} numberOfLines={1}>
                          4-WEEK PLAN
                        </Text>
                        <Text style={[styles.panelArrow, styles.panelArrowPlan]}>›</Text>
                      </View>
                    </Pressable>

                    {/* THE SYSTEM (purple) — the door to the second list. It used
                        to be a [coming soon...] node itself; now it OPENS, and the
                        things that aren't ready live inside it. The tour still
                        points its arrow here. */}
                    <Pressable
                      style={({ pressed }) => [styles.panel, styles.panelSystem, pressed && styles.panelPressed]}
                      onPress={() => setSection('system')}
                      ref={adminView ? undefined : tourSystemRef}
                      collapsable={false}
                    >
                      <View style={styles.panelHeader}>
                        <View style={[styles.panelHeaderBar, styles.panelHeaderBarSystem]} />
                        <Text style={[styles.panelHeaderText, styles.panelHeaderTextSystem, styles.panelHeaderFill]} numberOfLines={1}>
                          THE SYSTEM
                        </Text>
                        <Text style={[styles.panelArrow, styles.panelArrowSystem]}>›</Text>
                      </View>
                    </Pressable>
                  </>
                ) : (
                  <>
                    {/* TUTORIAL (gold) — replays the guided walkthrough. Live it is
                        a pressable node with a chevron, exactly like the Player
                        Card; while TUTORIAL_ENABLED is off it wears the locked
                        treatment in its own gold. */}
                    {tutorialLive ? (
                      <Pressable
                        style={({ pressed }) => [styles.panel, styles.panelGold, pressed && styles.panelPressed]}
                        onPress={openTour}
                      >
                        <View style={styles.panelHeader}>
                          <View style={[styles.panelHeaderBar, styles.panelHeaderBarGold]} />
                          <Text style={[styles.panelHeaderText, styles.panelHeaderTextGold, styles.panelHeaderFill]} numberOfLines={1}>
                            TUTORIAL
                          </Text>
                          <Text style={[styles.panelArrow, styles.panelArrowGold]}>›</Text>
                        </View>
                      </Pressable>
                    ) : (
                      <View style={[styles.panel, styles.panelGold, styles.panelGoldLocked]}>
                        <View style={styles.panelHeader}>
                          <View style={[styles.panelHeaderBar, styles.panelHeaderBarGold]} />
                          <Text style={[styles.panelHeaderText, styles.panelHeaderTextGold]} numberOfLines={1}>
                            TUTORIAL
                          </Text>
                          <Text style={[styles.soon, styles.soonGold, styles.panelHeaderFill]} numberOfLines={1}>[coming soon...]</Text>
                        </View>
                      </View>
                    )}

                    {/* COMMON LANGUAGE (jade) — locked; the app's vocabulary.
                        The words the System speaks — LVL, class, prestige, quest,
                        combo, the shapes — in one place, so a player can look one
                        up instead of guessing. Locked until the entries are
                        written; same [coming soon...] treatment, its own jade. */}
                    <View style={[styles.panel, styles.panelJade]}>
                      <View style={styles.panelHeader}>
                        <View style={[styles.panelHeaderBar, styles.panelHeaderBarJade]} />
                        <Text style={[styles.panelHeaderText, styles.panelHeaderTextJade]} numberOfLines={1}>
                          COMMON LANGUAGE
                        </Text>
                        <Text style={[styles.soon, styles.soonJade, styles.panelHeaderFill]} numberOfLines={1}>[coming soon...]</Text>
                      </View>
                    </View>
                  </>
                )}
              </View>

              {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
            </>
          )}
        </ScrollView>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1 },
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

  // ── The panels ──
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

  // A panel that GOES somewhere — same box, a chevron instead of a chip, and a
  // press state. The Player Card is the one of the four that opens a screen (the
  // Tutorial joins it whenever TUTORIAL_ENABLED is flipped on).
  // It carries no blurb: the title and the chevron already say what it is.
  panelPressed: { opacity: 0.7 },
  panelArrow: { fontFamily: F.heading, fontSize: 26, color: ACCENT, marginTop: -4 },

  // ── PLAYER CARD — the ice panel ──
  panelIce:           { borderColor: ICE_EDGE, shadowColor: ICE, shadowOpacity: 0.22 },
  panelHeaderBarIce:  { backgroundColor: ICE, shadowColor: ICE },
  panelHeaderTextIce: {
    color: ICE,
    textShadowColor: 'rgba(205,243,255,0.35)',
    textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
  },
  panelArrowIce:      { color: ICE },

  // ── TUTORIAL — the gold panel ──
  // Warm between two cold panels, and one notch brighter than THE SYSTEM when
  // it's live, because this one actually opens.
  panelGold:           { borderColor: GOLD_EDGE, shadowColor: GOLD, shadowOpacity: 0.20 },
  panelGoldLocked:     { shadowOpacity: 0.14 },   // dimmer while the tour is switched off
  panelHeaderBarGold:  { backgroundColor: GOLD, shadowColor: GOLD },
  panelHeaderTextGold: {
    color: GOLD,
    textShadowColor: 'rgba(255,209,102,0.32)',
    textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
  },
  panelArrowGold:      { color: GOLD },

  // ── COMMON LANGUAGE — the jade panel ──
  // Green-teal: the only warm-neutral left that isn't already spoken for, and far
  // enough from the ice above it that the four bars never read as a gradient.
  // Its title is the longest on the screen, so unlike the others it is allowed to
  // SHRINK (and starts a size down) — otherwise it shoves [coming soon...] off
  // the row on a narrow phone.
  panelJade:           { borderColor: JADE_EDGE, shadowColor: JADE, shadowOpacity: 0.16 },
  panelHeaderBarJade:  { backgroundColor: JADE, shadowColor: JADE, shadowOpacity: 0.7 },
  panelHeaderTextJade: {
    color: JADE, fontSize: 19, flexShrink: 1,
    textShadowColor: 'rgba(31,215,154,0.30)',
    textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
  },

  // ── 4-WEEK PLAN — the ember panel ──
  // The only warm node on the tab. Its glow is the strongest in the root list
  // on purpose: a new player's eye
  // should land here first, because this is the node that tells them what to
  // actually DO next.
  panelPlan: { borderColor: EMBER_EDGE, shadowColor: EMBER, shadowOpacity: 0.26 },
  panelHeaderBarPlan: { backgroundColor: EMBER, shadowColor: EMBER },
  panelHeaderTextPlan: {
    color: EMBER,
    textShadowColor: 'rgba(255,138,61,0.35)',
    textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
  },
  panelArrowPlan: { color: EMBER },
  // ── THE SYSTEM — the purple panel ──
  // Purple instead of the house blue: it opens a different layer of the product,
  // not another screen of this one. It was the LOCKED node until 2026-09-18 (soft
  // glow, muted [coming soon...] chip); now it is a live door, so it carries a
  // chevron and the same press state the Player Card does — the glow stays a
  // notch under the ice above it so the two don't compete at the top of the list.
  panelSystem: { borderColor: PURPLE_EDGE, shadowColor: PURPLE, shadowOpacity: 0.20 },
  panelHeaderBarSystem: { backgroundColor: PURPLE, shadowColor: PURPLE, shadowOpacity: 0.7 },
  panelHeaderTextSystem: {
    color: PURPLE,
    textShadowColor: 'rgba(169,112,255,0.30)',
    textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
  },
  panelArrowSystem: { color: PURPLE },
  // The [coming soon...] chip. Its base colour is a muted purple left over from
  // when THE SYSTEM wore it; every node that still shows the chip overrides it
  // with its own tone below.
  soon: { fontFamily: F.bodyMed, fontSize: 13, color: '#6b52a3', letterSpacing: 1 },
  soonGold: { color: '#8a6f3a' },   // the same muted chip, in the tutorial's gold
  soonJade: { color: '#3f7f68' },   // ditto, in the glossary's jade

  error: {
    fontFamily: F.bodyMed, fontSize: 14, color: '#FF6B6B', letterSpacing: 0.4,
    textAlign: 'center', marginTop: 16, lineHeight: 20,
  },
});
