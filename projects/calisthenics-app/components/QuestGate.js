import { useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, Animated, Easing, useWindowDimensions,
} from 'react-native';
import { F } from '../constants/fonts';
import { ShimmerFrame, ShimmerText } from './Shimmer';

// ─── Mission launcher ───────────────────────────────────────────────────────
// Replaces the old red-gate portal. Tapping today's mission no longer opens a
// spinning vortex — it opens the SYSTEM's own alert window, the same voice the
// daily-quest panel speaks in: ice-blue frame, dim backdrop, spaced capitals.
//
// What makes it feel like an event rather than a dialog:
//   • it SNAPS open (spring + a hairline that widens into the panel),
//   • a scan bar sweeps down the glass on open and every few seconds after,
//   • four corner brackets push outward as it lands,
//   • the live shimmer frame keeps the border breathing while it's up.
// Everything decorative is native-driver (opacity/transform only) and mounted
// only while the window is open, so nothing animates in the background.
const SL = {
  panel:  '#0a1322',
  border: '#1a3a5c',
  accent: '#4A9EBF',
  text:   '#E8F4FF',
  muted:  '#8FB4CC',
};

// The window wears the MISSION TYPE's colour end to end — frame, brackets, scan,
// header, title glow, chip and button all come off one hex, so a MAIN QUEST reads
// ice, ACCESSORIES gold, LEGS green, at a glance and before a word is read.
// Both palettes are built by walking that one colour toward black and white; the
// arrays loop (…l1, l2, l1…) so the shimmer sweep wraps without a seam.
const mix = (hex, target, amt) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map(v => Math.round(v + (target - v) * amt))
    .map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'));
  return '#' + ch.join('');
};
const dark  = (hex, amt) => mix(hex, 0, amt);
const light = (hex, amt) => mix(hex, 255, amt);
// Frame sweep: deep → base → bright → back down.
const framePalette = (hex) => [
  dark(hex, 0.62), dark(hex, 0.3), hex, light(hex, 0.3), light(hex, 0.55), light(hex, 0.3),
];
// Button label: near-white peaks over the colour, so it stays legible on the dark
// fill while still belonging to the mission's hue.
const enterPalette = (hex) => [
  light(hex, 0.65), '#FFFFFF', light(hex, 0.8), hex, light(hex, 0.45), light(hex, 0.7),
];

export default function QuestGate({
  visible,
  title,
  purpose,
  tagLabel,
  accent,
  live = false,
  onEnter,
  onClose,
}) {
  const anim = useRef(new Animated.Value(0)).current;   // open transition
  const scan = useRef(new Animated.Value(0)).current;   // repeating scan bar
  const beat = useRef(new Animated.Value(0)).current;   // header dot + glow
  const { width: winW } = useWindowDimensions();

  useEffect(() => {
    if (!visible) { anim.setValue(0); scan.setValue(0); beat.setValue(0); return; }
    const open = Animated.spring(anim, {
      toValue: 1, useNativeDriver: true, friction: 6.5, tension: 90,
    });
    // One sweep as it opens, then a slow repeat with a long dark gap between —
    // present, never strobing.
    const sweep = Animated.loop(Animated.sequence([
      Animated.timing(scan, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(scan, { toValue: 0, duration: 0, delay: 2600, useNativeDriver: true }),
    ]));
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(beat, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(beat, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    open.start(); sweep.start(); pulse.start();
    return () => { open.stop(); sweep.stop(); pulse.stop(); };
  }, [visible, anim, scan, beat]);

  const hot = accent || SL.accent;
  const frameColors = useMemo(() => framePalette(hot), [hot]);
  const enterColors = useMemo(() => enterPalette(hot), [hot]);
  // Panel width drives the scan travel and the bracket kick, so both scale with
  // the phone instead of being tuned for one screen.
  const panelW = Math.min(460, winW - 40);
  const panelH = 420;

  const cardOpacity = anim.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 1, 1] });
  const cardScale   = anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });
  const cardY       = anim.interpolate({ inputRange: [0, 1], outputRange: [26, 0] });
  // The panel opens out of a hairline: a bright line at full width that fades as
  // the body arrives behind it.
  const slitScaleY  = anim.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0.02, 0.5, 1] });
  const slitOpacity = anim.interpolate({ inputRange: [0, 0.3, 0.75], outputRange: [1, 0.5, 0] });
  const scanY       = scan.interpolate({ inputRange: [0, 1], outputRange: [-40, panelH] });
  const scanO       = scan.interpolate({ inputRange: [0, 0.12, 0.85, 1], outputRange: [0, 0.9, 0.35, 0] });
  const dotO        = beat.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] });
  const dotS        = beat.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1.3] });
  // Brackets settle outward as the window lands — the frame "locking on".
  const kick = (x, y) => ({
    opacity: anim,
    transform: [
      { translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [-x * 10, 0] }) },
      { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-y * 10, 0] }) },
    ],
  });

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <Animated.View
          style={[
            styles.frameOuter,
            { width: panelW, shadowColor: hot, opacity: cardOpacity, transform: [{ scale: cardScale }, { translateY: cardY }] },
          ]}
        >
          {/* The opening hairline. */}
          <Animated.View
            pointerEvents="none"
            style={[styles.slit, { backgroundColor: hot, opacity: slitOpacity, transform: [{ scaleY: slitScaleY }] }]}
          />

          <View style={styles.contentClip}>
            {/* Scan bar travelling down the glass. */}
            <Animated.View
              pointerEvents="none"
              style={[styles.scanBar, { opacity: scanO, transform: [{ translateY: scanY }] }]}
            >
              <View style={[styles.scanLine, { backgroundColor: hot, shadowColor: hot }]} />
              <View style={[styles.scanWash, { backgroundColor: hot }]} />
            </Animated.View>

            {/* Header — the system announcing itself. */}
            <View style={styles.headerRow}>
              <Animated.View
                style={[styles.headerDot, { backgroundColor: hot, shadowColor: hot, opacity: dotO, transform: [{ scale: dotS }] }]}
              />
              <Text style={[styles.headerText, { color: hot }]}>
                {live ? 'WORKOUT IN PROGRESS' : 'WORKOUT ALERT'}
              </Text>
            </View>
            <View style={styles.headerRule} />

            <Text
              style={[styles.title, { textShadowColor: hot + '99' }]}
              numberOfLines={3}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {title}
            </Text>

            {!!purpose && (
              <Text style={styles.purpose} numberOfLines={2}>{purpose}</Text>
            )}

            {!!tagLabel && (
              <View style={[styles.tag, { borderColor: hot + '77', backgroundColor: hot + '14' }]}>
                <Text style={[styles.tagText, { color: hot }]}>{tagLabel}</Text>
              </View>
            )}

            {/* The one hot control on the panel. */}
            <Pressable
              style={({ pressed }) => [
                styles.enterBtn,
                { borderColor: hot, shadowColor: hot, backgroundColor: dark(hot, 0.86) },
                pressed && styles.enterBtnPressed,
              ]}
              onPress={onEnter}
            >
              <ShimmerText
                text={live ? '▶ RESUME' : '▶ ENTER'}
                style={styles.enterText}
                colors={enterColors}
                active={!!visible}
              />
              <Text style={[styles.enterSub, { color: light(hot, 0.45) }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                WORKOUT MODE
              </Text>
            </Pressable>

            <Pressable
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.closeText}>DISMISS</Text>
            </Pressable>
          </View>

          {/* Corner brackets — drawn over the frame, locking on as it opens. */}
          <Animated.View pointerEvents="none" style={[styles.br, styles.brTL, { borderColor: hot }, kick(1, 1)]} />
          <Animated.View pointerEvents="none" style={[styles.br, styles.brTR, { borderColor: hot }, kick(-1, 1)]} />
          <Animated.View pointerEvents="none" style={[styles.br, styles.brBL, { borderColor: hot }, kick(1, -1)]} />
          <Animated.View pointerEvents="none" style={[styles.br, styles.brBR, { borderColor: hot }, kick(-1, -1)]} />

          {/* Live shimmer border in the mission's colour — the panel's signature. */}
          <ShimmerFrame
            style={styles.border}
            colors={frameColors}
            radius={22}
            thickness={2.5}
            duration={4200}
            active={!!visible}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

const R = 22;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(2,5,12,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  frameOuter: {
    maxWidth: 460,
    borderRadius: R,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 34,
    elevation: 26,
  },
  slit: {
    position: 'absolute',
    left: 10, right: 10, top: '50%',
    height: 3,
    borderRadius: 2,
  },
  contentClip: {
    width: '100%',
    borderRadius: R,
    overflow: 'hidden',
    backgroundColor: SL.panel,
    paddingHorizontal: 26,
    paddingTop: 20,
    paddingBottom: 22,
    alignItems: 'center',
  },
  border: { ...StyleSheet.absoluteFillObject, borderRadius: R },

  // Scan bar: a bright hairline with a soft wash trailing under it.
  scanBar: { position: 'absolute', left: 0, right: 0, top: 0 },
  scanLine: {
    height: 1.5,
    opacity: 0.9,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
  },
  scanWash: { height: 26, opacity: 0.07 },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerDot: {
    width: 8, height: 8, borderRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 8,
  },
  headerText: {
    fontFamily: F.body,
    fontSize: 12,
    letterSpacing: 4,
  },
  headerRule: {
    alignSelf: 'stretch',
    height: 1,
    backgroundColor: SL.border,
    marginTop: 14,
    marginBottom: 20,
  },
  title: {
    fontFamily: F.heading,
    fontSize: 30,
    lineHeight: 34,
    color: '#FFFFFF',
    letterSpacing: 1.5,
    textAlign: 'center',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
  purpose: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    lineHeight: 20,
    color: SL.muted,
    textAlign: 'center',
    marginTop: 10,
  },
  tag: {
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderRadius: 999,
  },
  tagText: { fontFamily: F.body, fontSize: 11, letterSpacing: 2.5 },

  enterBtn: {
    alignSelf: 'stretch',
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    // Opaque, not rgba (the render supplies the hue): on Android an elevation
    // shadow under a translucent background paints as a hard rectangle inside the
    // button. No elevation here for the same reason — the border + shadow glow
    // carry the button on their own.
    backgroundColor: '#0e1b2b',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 16,
  },
  enterBtnPressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  enterText: {
    fontFamily: F.heading,
    fontSize: 26,
    letterSpacing: 3,
  },
  enterSub: {
    fontFamily: F.body,
    fontSize: 11,
    letterSpacing: 3,
    color: SL.muted,
    marginTop: 4,
  },

  closeBtn: { marginTop: 16, paddingVertical: 6, paddingHorizontal: 18 },
  closeText: {
    fontFamily: F.body,
    fontSize: 12,
    letterSpacing: 3,
    color: SL.muted,
  },

  // Corner brackets sit just outside the panel body.
  br: { position: 'absolute', width: 22, height: 22 },
  brTL: { top: -4,  left: -4,  borderTopWidth: 2,    borderLeftWidth: 2,  borderTopLeftRadius: 8 },
  brTR: { top: -4,  right: -4, borderTopWidth: 2,    borderRightWidth: 2, borderTopRightRadius: 8 },
  brBL: { bottom: -4, left: -4, borderBottomWidth: 2, borderLeftWidth: 2,  borderBottomLeftRadius: 8 },
  brBR: { bottom: -4, right: -4, borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: 8 },
});
