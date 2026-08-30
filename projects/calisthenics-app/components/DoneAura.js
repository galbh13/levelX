import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { ShimmerFrame } from './Shimmer';
import { glowRamp, lighten, rgba } from '../lib/colorMix';

// The living border of a row you've already cleared. TWO motions, both endless:
//
//   1. a light travelling around the frame (ShimmerFrame — the same live frame a
//      CLASS GATE node wears), and
//   2. a streak that crosses the card every few seconds.
//
// The first alone was too quiet to notice: a 2.5px rail shifting between shades
// of one hue reads as a static border unless you stare at it. The streak is what
// makes "this row is alive" legible at a glance — the eye catches travel across
// a surface far more easily than a colour change along an edge.
//
// Everything is derived from the row's OWN colour (rose for a handstand, gold for
// accessories, ice for a daily quest), so a cleared row never gets repainted into
// somebody else's theme.
//
// It stays BELOW the live in-progress card in the hierarchy — that one streaks
// every 1.9s at full brightness, this one every 3.9s at a sixth of the opacity —
// so the board still points at the mission you should be doing, not the ones
// you've finished. The travel is a native-thread transform (a static SVG gradient
// for the frame, one translated bar for the streak), so a board of cleared rows
// costs no per-frame JS. Renders nothing while the row is unfinished.
const CROSS_MS = 1400;   // time the streak takes to cross
const REST_MS  = 2500;   // dark pause before it comes round again

export default function DoneAura({ active, color = '#4A9EBF', radius = 8, thickness = 3 }) {
  const colors = useMemo(() => glowRamp(color), [color]);
  const streak = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);

  useEffect(() => {
    if (!active) return undefined;
    streak.setValue(0);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(streak, {
        toValue: 1, duration: CROSS_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
      }),
      Animated.delay(REST_MS),
    ]));
    loop.start();
    return () => loop.stop();
  }, [active, streak]);

  if (!active) return null;

  const bright = lighten(color, 0.55);
  const x = streak.interpolate({ inputRange: [0, 1], outputRange: [-70, (w || 260) + 70] });
  // Fade in and back out across the pass, so it never pops at either edge.
  const o = streak.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 1, 1, 0] });

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}
      onLayout={e => setW(e.nativeEvent.layout.width)}
    >
      <Animated.View
        style={[
          styles.streak,
          { backgroundColor: rgba(bright, 0.13), shadowColor: bright },
          { opacity: o, transform: [{ translateX: x }, { rotate: '18deg' }] },
        ]}
      />
      <ShimmerFrame
        style={[styles.frame, { borderRadius: radius, shadowColor: color }]}
        colors={colors}
        radius={radius}
        thickness={thickness}
        duration={2400}
        active
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    ...StyleSheet.absoluteFillObject,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 9,
  },
  streak: {
    position: 'absolute',
    top: -26,
    bottom: -26,
    width: 34,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 12,
  },
});
