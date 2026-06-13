import { useEffect, useRef, useState, Fragment } from 'react';
import { View, StyleSheet, Animated, Easing, Platform } from 'react-native';
import { C } from '../constants/colors';
import { playHologram } from '../lib/glitchSound';

// The "hologram build" entrance, sized in PERCENTAGES so it fills exactly the
// box it's dropped into (the card). Horizontal slices cover the card, then clear
// from the base upward (staggered), each leaving a glowing cyan build-front as
// it resolves — so the card constructs itself slice by slice, bounded to its own
// top and bottom. Scanlines fade as it locks in. Plays the boot-up sound.
//
// The covers paint immediately (the card is hidden from frame one), but the
// MOTION is held until the card's size stops changing (it caps to maxWidth and
// grows as data loads on first layout) — so the build is spot-on the final card
// box from its very first frame, never starting then snapping.
const N = 16;
const seg = (val, to, dur) => Animated.timing(val, { toValue: to, duration: dur, useNativeDriver: true });

export default function HoloBuild({ ready = true }) {
  const lines = useRef(new Animated.Value(0.6)).current;
  const strips = useRef(
    Array.from({ length: N }, (_, i) => ({
      v: new Animated.Value(0),
      delay: (N - 1 - i) * 42 + Math.random() * 60, // bottom slice resolves first → builds up
    }))
  ).current;
  const started = useRef(false);
  const [boxSize, setBoxSize] = useState(0);

  useEffect(() => {
    // Hold the build (card stays covered) until the screen's data is ready AND
    // the box size has settled — so it never starts on the smaller loading size.
    if (!ready || boxSize <= 0 || started.current) return;
    // (re)start a short settle timer on every size change; only when the size
    // holds steady for the debounce do we kick off the build.
    const t = setTimeout(() => {
      started.current = true;
      playHologram();
      Animated.parallel([
        ...strips.map((s) => Animated.sequence([Animated.delay(s.delay), seg(s.v, 1, 150)])),
        Animated.timing(lines, { toValue: 0, duration: 1050, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
    }, 140);
    return () => clearTimeout(t);
  }, [ready, boxSize]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => setBoxSize(Math.round(e.nativeEvent.layout.width + e.nativeEvent.layout.height))}
    >
      {strips.map((s, i) => {
        const coverOp = s.v.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
        const frontOp = s.v.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 0] });
        const top = `${(i / N) * 100}%`;
        return (
          <Fragment key={i}>
            <Animated.View
              style={{ position: 'absolute', left: 0, right: 0, top, height: `${100 / N + 0.3}%`, backgroundColor: C.lockedBg, opacity: coverOp }}
            />
            <Animated.View style={[styles.front, { top, opacity: frontOp }]} />
          </Fragment>
        );
      })}
      {Platform.OS === 'web' && (
        <Animated.View style={[StyleSheet.absoluteFill, styles.scanlines, { opacity: lines }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  front: {
    position: 'absolute', left: 0, right: 0, height: 2,
    backgroundColor: C.glitchCyan,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 16,
  },
  scanlines: {
    backgroundImage: 'repeating-linear-gradient(0deg, rgba(90,200,250,0.18) 0px, rgba(90,200,250,0.18) 1px, transparent 1px, transparent 4px)',
  },
});
