import { useContext, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import { C } from '../constants/colors';
import { CARD_W, useAppInsets } from '../constants/layout';
import { ShimmerFrame, BLUE } from './Shimmer';
import HoloBuild from './HoloBuild';
import { consumeHoloEntry } from '../lib/holoEntry';

// Outer horizontal padding (each side) reserved around the framed box. Screens
// that size content off the window width (e.g. the gallery grid) import this so
// their layout matches the framed inner width.
export const FRAME_PAD = 12;
// Vertical margin above/below the card. Constant, exactly like FRAME_PAD.
export const FRAME_PAD_V = 12;
// THE card width. Every framed screen is this wide (capped by the window) —
// the old per-screen widths (560 / 640 / 720 / 900 / 920 / 1800) are what made
// the cards look mismatched next to each other on a wide screen.
export const FRAME_MAX_W = CARD_W;

// Wraps a screen's content in ONE fixed, full-screen, animated "cool frame" —
// a rounded border that slowly sweeps the palette (the Skills / Challenges look).
//
// THE FRAME IS THE SAME BOX ON EVERY SCREEN. It always fills the viewport
// (minus a constant margin) and its size NEVER depends on the content: a screen
// with two rows and a screen with forty draw the identical card, and the card
// does not resize as data loads, a tab switches, or a list grows. Content that
// is taller than the card scrolls INSIDE it.
//
//   • Default mode: the frame owns the scroll — children are laid out top-down
//     inside a ScrollView that fills the card.
//   • fill mode: the child manages its own scroll/layout (used for FlatLists,
//     inverted chat lists, the quest tree — anything that can't nest in a
//     ScrollView). Identical outer geometry, just no inner ScrollView.
//
// Do NOT give a screen's root child a fixed height to "make the card tall" —
// the card is already full height, and a fixed height only re-introduces the
// mismatch (it overflows a short phone and falls short of a tall one). Use
// `flexGrow: 1` when the content should stretch to the bottom.
//
// The frame is drawn ON TOP of the content edges so an opaque child background
// can't paint over it; it's non-interactive (taps pass through).
// `overlay` renders inside the framed box (clipped to its rounded corners),
// above the content but below the border — used for effects that must stay
// contained to the card, e.g. the login deviation glitch.
//
// `ready`: when the screen's own data is still loading, pass `false` so the
// hologram-build entrance holds (the card stays covered) until the content is
// settled.
// `ghost`: renders the frame CHROMELESS — transparent background, no border, no
// glow. Used when the screen is stacked as a transparentModal directly over an
// identical framed screen (Workouts ⇄ Manage forge swipe): the screen underneath
// provides the bg + border + hero, and this one overlays only its own content,
// so the two bodies can cross-swipe inside what reads as ONE card.
//
// `maxWidth` is deliberately NOT a per-screen styling knob any more: every card
// is FRAME_MAX_W wide. It survives in the signature only as an escape hatch —
// prefer leaving it alone.
export default function ScreenFrame({ children, overlay = null, ready = true, colors = BLUE, maxWidth = FRAME_MAX_W, duration = 4200, fill = false, holoEntry = true, ghost = false }) {
  // Keep the card clear of the status bar / notch (edge-to-edge on Android).
  const insets = useAppInsets();
  // Decide on the FIRST render (lazy initializer) so the build's covers are
  // painted immediately — otherwise the card flashes for a frame before they
  // appear. The first ScreenFrame to mount after login consumes the latch.
  // Screens that pass `holoEntry={false}` opt out entirely — they neither consume
  // nor play the build, so the latch is preserved for the real landing card.
  // All four tab screens mount together at app start (swipe pager, lazy:false),
  // so only the FOCUSED screen may consume the latch — otherwise an off-screen
  // tab plays the build invisibly and the landing card gets nothing.
  const navigation = useContext(NavigationContext);
  const [holo] = useState(
    () => holoEntry && (!navigation || navigation.isFocused()) && consumeHoloEntry()
  );
  const border = ghost
    ? null
    : <ShimmerFrame style={styles.border} colors={colors} radius={18} thickness={4} duration={duration} active />;

  // Default mode's scroll lives INSIDE the card, so scrolling moves the content
  // and never the frame.
  const body = fill ? children : (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );

  // ONE geometry for both modes: outer (full screen, constant margin) →
  // frameBox (flex, max-width, glow + border) → contentClip (rounded clip).
  // The border is overlaid as a sibling of the content-clip (not a child) so the
  // card's rounded `overflow:hidden` — needed to clip the screen content — can't
  // shave the frame thin at the corners.
  return (
    <View style={[styles.outer, { paddingTop: FRAME_PAD_V + insets.top }, ghost && styles.ghostBg]}>
      <View style={[styles.frameBox, { maxWidth }, ghost && styles.ghostBox]}>
        <View style={[styles.contentClip, ghost && styles.ghostBg]}>
          {body}
          {overlay}
          {holo && <HoloBuild ready={ready} />}
        </View>
        {border}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The screen behind the card: full bleed, constant margin on all four sides.
  outer: {
    flex: 1, backgroundColor: C.bg, alignItems: 'center',
    paddingHorizontal: FRAME_PAD, paddingVertical: FRAME_PAD_V,
  },
  // Outer box: holds the rounded content-clip + the non-clipped border overlay.
  // overflow VISIBLE so the border (a sibling) is never clipped at the corners.
  // The glow lives here (the inner clip would clip its own shadow).
  // flex: 1 → the card is always exactly as tall as the screen allows.
  frameBox: {
    flex: 1, width: '100%', alignSelf: 'center', borderRadius: 18,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 18,
  },
  // The screen content, clipped to rounded corners (this is the only clip).
  contentClip: {
    flex: 1, width: '100%', borderRadius: 18, overflow: 'hidden', backgroundColor: C.bg,
  },
  // Default mode's inner scroll: fills the card and scrolls only when the
  // content outgrows it — so the CARD never changes size, only the content does.
  scroll: { flex: 1, width: '100%' },
  scrollContent: { flexGrow: 1 },
  // Ghost mode — see the prop doc above: transparent bg, no glow (border is
  // skipped separately). The screen underneath supplies all the chrome.
  ghostBg:  { backgroundColor: 'transparent' },
  ghostBox: { shadowOpacity: 0 },

  border: {
    ...StyleSheet.absoluteFillObject, borderRadius: 18,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12,
  },
});
