import { useEffect, useRef } from 'react';
import { View, Animated, Easing, Dimensions } from 'react-native';
import { C } from '../constants/colors';

const { height: H } = Dimensions.get('window');

// Breaks the card's BORDER into bricks tiled around the perimeter, which then
// tumble away under gravity — so the frame collapses pixel by pixel along with
// everything else. Sits exactly over the frame (width/height = card box).
const PALETTE = [C.iceGlow, C.deepBlue, C.glitchCyan, C.text];

function mk(left, top, w, h) {
  return {
    left, top, w, h,
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    delay: Math.random() * 420,
    driftX: (Math.random() - 0.5) * 130,
    spin: (Math.random() - 0.5) * 240,
    val: new Animated.Value(0),
  };
}

function buildPerimeter(width, height, thk, len) {
  const bricks = [];
  const cols = Math.ceil(width / len);
  const rows = Math.ceil(height / len);
  for (let i = 0; i < cols; i++) {
    const x = i * len;
    const w = Math.min(len - 2, width - x);
    if (w > 0) { bricks.push(mk(x, 0, w, thk)); bricks.push(mk(x, height - thk, w, thk)); }
  }
  for (let j = 0; j < rows; j++) {
    const y = j * len;
    const h = Math.min(len - 2, height - y);
    if (h > 0) { bricks.push(mk(0, y, thk, h)); bricks.push(mk(width - thk, y, thk, h)); }
  }
  return bricks;
}

export default function FrameShatter({ width, height, thickness = 6, brickLen = 22 }) {
  const bricks = useRef(buildPerimeter(width, height, thickness, brickLen)).current;

  useEffect(() => {
    const anim = Animated.parallel(
      bricks.map((b) =>
        Animated.sequence([
          Animated.delay(b.delay),
          Animated.timing(b.val, {
            toValue: 1, duration: 700, easing: Easing.in(Easing.quad), useNativeDriver: true,
          }),
        ])
      )
    );
    anim.start();
    return () => anim.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width, height }}>
      {bricks.map((b, i) => {
        const opacity = b.val.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 1, 0] });
        const translateY = b.val.interpolate({ inputRange: [0, 1], outputRange: [0, H * 0.5 + 220] });
        const translateX = b.val.interpolate({ inputRange: [0, 1], outputRange: [0, b.driftX] });
        const rotate = b.val.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${b.spin}deg`] });
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: b.left, top: b.top, width: b.w, height: b.h,
              backgroundColor: b.color, opacity,
              transform: [{ translateX }, { translateY }, { rotate }],
            }}
          />
        );
      })}
    </View>
  );
}
