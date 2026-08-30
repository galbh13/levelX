import { useEffect, useRef, Fragment } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { C } from '../constants/colors';

// The exact MIRROR of <HoloBuild>: the same horizontal slices and the same
// glowing cyan build-front, run the other way — the card is COVERED from the
// top downward, slice by slice, until nothing is left but empty space.
//
// It exists so the login hands off to the landing card as one continuous
// motion: press LOGIN → the login card dissolves from the top down → the
// session lands → HoloBuild clears the home card from the bottom up. One line
// travels the whole way down and back.
//
//   run=true   → play the cover (top → bottom), then call `onDone`
//   run=false  → if it had covered, uncover again (bottom → top), for a failed
//                sign-in that has to hand the form back
//
// Keep N / STRIP_MS / STAGGER in step with HoloBuild's or the two halves of the
// motion stop reading as the same line.
const N = 16;
const STRIP_MS = 150;
const STAGGER = 42;

const seg = (val, to) => Animated.timing(val, { toValue: to, duration: STRIP_MS, useNativeDriver: true });

export default function HoloDissolve({ run = false, onDone }) {
  // 0 = clear (the card shows), 1 = covered.
  const strips = useRef(
    Array.from({ length: N }, (_, i) => ({
      v: new Animated.Value(0),
      delay: i * STAGGER + Math.random() * 60,   // top slice covers first → dissolves down
    }))
  ).current;
  const covered = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (run) {
      covered.current = true;
      Animated.parallel(
        strips.map((s) => Animated.sequence([Animated.delay(s.delay), seg(s.v, 1)]))
      ).start(({ finished }) => { if (finished) doneRef.current?.(); });
      return;
    }
    // Never play the uncover on mount — only as the undo of a dissolve that ran.
    if (!covered.current) return;
    covered.current = false;
    Animated.parallel(
      strips.map((s, i) => Animated.sequence([
        Animated.delay((N - 1 - i) * STAGGER),   // bottom clears first, like HoloBuild
        seg(s.v, 0),
      ]))
    ).start();
  }, [run]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {strips.map((s, i) => {
        const frontOp = s.v.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 0] });
        const top = `${(i / N) * 100}%`;
        return (
          <Fragment key={i}>
            <Animated.View
              style={{
                position: 'absolute', left: 0, right: 0, top,
                height: `${100 / N + 0.3}%`, backgroundColor: C.bg, opacity: s.v,
              }}
            />
            <Animated.View style={[styles.front, { top, opacity: frontOp }]} />
          </Fragment>
        );
      })}
    </View>
  );
}

// Same build-front as HoloBuild — it has to look like one line, not two.
const styles = StyleSheet.create({
  front: {
    position: 'absolute', left: 0, right: 0, height: 2,
    backgroundColor: C.glitchCyan,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 16,
  },
});
