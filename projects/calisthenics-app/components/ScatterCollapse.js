import { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing, Dimensions } from 'react-native';
import { C } from '../constants/colors';

const { height: H } = Dimensions.get('window');

// Random debris scattered across the WHOLE screen (outside the card) that snaps
// in and collapses — tumbling away under gravity, staggered — to amplify the
// "everything is breaking" urgency of the login intro. Non-interactive.
const PALETTE = [
  C.iceGlow, C.glitchCyan, C.deepBlue, C.alarmRed, C.glitchMagenta, C.text, C.surface, C.bordeaux,
];

function buildSpots() {
  const n = 22 + Math.floor(Math.random() * 12); // 22–33
  return Array.from({ length: n }, (_, i) => ({
    key: `s${i}`,
    left: `${Math.random() * 100}%`,
    top: `${Math.random() * 100}%`,
    w: 8 + Math.random() * 54,
    h: 8 + Math.random() * 54,
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    maxOp: 0.45 + Math.random() * 0.5,
    delay: Math.random() * 440,             // staggered collapse
    driftX: (Math.random() - 0.5) * 130,    // sideways scatter
    spin: (Math.random() - 0.5) * 220,      // tumble rotation (deg)
    val: new Animated.Value(0),
  }));
}

export default function ScatterCollapse() {
  const spots = useRef(buildSpots()).current;

  useEffect(() => {
    const anim = Animated.parallel(
      spots.map((s) =>
        Animated.sequence([
          Animated.delay(s.delay),
          Animated.timing(s.val, {
            toValue: 1, duration: 720, easing: Easing.in(Easing.quad), useNativeDriver: true,
          }),
        ])
      )
    );
    anim.start();
    return () => anim.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {spots.map((s) => {
        const opacity = s.val.interpolate({ inputRange: [0, 0.08, 0.6, 1], outputRange: [0, s.maxOp, s.maxOp, 0] });
        const translateY = s.val.interpolate({ inputRange: [0, 1], outputRange: [0, H * 0.6 + 220] });
        const translateX = s.val.interpolate({ inputRange: [0, 1], outputRange: [0, s.driftX] });
        const rotate = s.val.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${s.spin}deg`] });
        return (
          <Animated.View
            key={s.key}
            style={{
              position: 'absolute',
              left: s.left, top: s.top, width: s.w, height: s.h,
              backgroundColor: s.color, opacity,
              transform: [{ translateX }, { translateY }, { rotate }],
            }}
          />
        );
      })}
    </View>
  );
}
