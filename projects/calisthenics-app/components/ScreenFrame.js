import { useContext, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import { C } from '../constants/colors';
import { ShimmerFrame, BLUE } from './Shimmer';
import FrameShatter from './FrameShatter';
import HoloBuild from './HoloBuild';
import { consumeHoloEntry } from '../lib/holoEntry';

// Outer horizontal padding (each side) reserved around the framed box. Screens
// that size content off the window width (e.g. the gallery grid) import this so
// their layout matches the framed inner width.
export const FRAME_PAD = 12;

// Wraps a screen's content in one centered, max-width, animated "cool frame" —
// a rounded border that slowly sweeps the palette (the Skills / Challenges look).
//
//   • Default (hug) mode: the frame wraps the content TIGHTLY (no dead space) and
//     is centered both horizontally and vertically; it scrolls if the content is
//     taller than the screen. Pass plain content as children.
//   • fill mode: the frame fills the screen height and the child manages its own
//     scroll/layout (used for the gallery's FlatList, which can't nest in a
//     ScrollView).
//
// The frame is drawn ON TOP of the content edges so an opaque child background
// can't paint over it; it's non-interactive (taps pass through).
// `overlay` renders inside the framed box (clipped to its rounded corners),
// above the content but below the border — used for effects that must stay
// contained to the card, e.g. the login deviation glitch.
//
// `shatter`: when true, the solid border is replaced by FrameShatter (the frame
// breaks into falling bricks) and the box clip is lifted so all the shattering
// pieces can spill outside the card.
// `ready`: when the screen's own data is still loading, pass `false` so the
// hologram-build entrance holds (the card stays covered) until the content —
// and therefore the card's final size — is settled.
// `ghost`: renders the frame CHROMELESS — transparent background, no border, no
// glow. Used when the screen is stacked as a transparentModal directly over an
// identical framed screen (Workouts ⇄ Manage forge swipe): the screen underneath
// provides the bg + border + hero, and this one overlays only its own content,
// so the two bodies can cross-swipe inside what reads as ONE card.
export default function ScreenFrame({ children, overlay = null, shatter = false, ready = true, colors = BLUE, maxWidth = 1100, duration = 4200, fill = false, holoEntry = true, ghost = false }) {
  const [size, setSize] = useState(null);
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
  const onLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => prev || { width, height });
  };
  const border = ghost
    ? null
    : shatter && size
      ? <FrameShatter width={size.width} height={size.height} />
      : <ShimmerFrame style={styles.border} colors={colors} radius={18} thickness={4} duration={duration} active />;

  // The border is overlaid as a sibling of the content-clip (not a child) so the
  // card's rounded `overflow:hidden` — needed to clip the screen content — can't
  // shave the frame thin at the corners. The content gets its own rounded clip.
  if (fill) {
    return (
      <View style={[styles.outerFill, ghost && styles.ghostBg]}>
        <View style={[styles.frameBox, styles.frameBoxFill, { maxWidth }, shatter && styles.framedOpen, ghost && styles.ghostBox]} onLayout={onLayout}>
          <View style={[styles.contentClipFill, shatter && styles.framedOpen, ghost && styles.ghostBg]}>
            {children}
            {overlay}
            {holo && <HoloBuild ready={ready} />}
          </View>
          {border}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.outer, ghost && styles.ghostBg]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.frameBox, { maxWidth }, shatter && styles.framedOpen, ghost && styles.ghostBox]} onLayout={onLayout}>
          <View style={[styles.contentClip, shatter && styles.framedOpen, ghost && styles.ghostBg]}>
            {children}
            {overlay}
            {holo && <HoloBuild ready={ready} />}
          </View>
          {border}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Hug + center mode ──
  outer: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  // flexGrow + center → centered when shorter than the screen, scrolls (from the
  // top, no clipping) when taller.
  scrollContent: {
    flexGrow: 1, justifyContent: 'center', alignItems: 'center',
    paddingVertical: 18, paddingHorizontal: FRAME_PAD,
  },
  // Outer box: holds the rounded content-clip + the non-clipped border overlay.
  // overflow VISIBLE so the border (a sibling) is never clipped at the corners.
  // The glow lives here (the inner clip would clip its own shadow).
  frameBox: {
    width: '100%', borderRadius: 18,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 18,
  },
  // The screen content, clipped to rounded corners (this is the only clip).
  contentClip: {
    width: '100%', borderRadius: 18, overflow: 'hidden', backgroundColor: C.bg,
  },
  // During the collapse, let the shattering pieces spill outside the card.
  framedOpen: { overflow: 'visible', backgroundColor: 'transparent' },
  // Ghost mode — see the prop doc above: transparent bg, no glow (border is
  // skipped separately). The screen underneath supplies all the chrome.
  ghostBg:  { backgroundColor: 'transparent' },
  ghostBox: { shadowOpacity: 0 },

  // ── Fill mode ──
  outerFill: { flex: 1, backgroundColor: C.bg, paddingHorizontal: FRAME_PAD, paddingVertical: 12, alignItems: 'center' },
  frameBoxFill: { flex: 1, alignSelf: 'center' },
  contentClipFill: {
    flex: 1, width: '100%', alignSelf: 'center', borderRadius: 18, overflow: 'hidden', backgroundColor: C.bg,
  },

  border: {
    ...StyleSheet.absoluteFillObject, borderRadius: 18,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12,
  },
});
