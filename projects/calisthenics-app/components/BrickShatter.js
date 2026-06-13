import { useEffect, useRef } from 'react';
import { View, Animated, Easing } from 'react-native';

// Shatters whatever you pass as `children` into falling bricks. Each brick is a
// small clipped window (overflow hidden) onto a full-size copy of the children,
// offset so it shows exactly its own slice — so every brick keeps the element's
// ACTUAL pixels/colors (no recoloring). The bricks then tumble away under
// gravity, staggered, like a building collapsing brick by brick. Non-interactive.
//
// `width`/`height` must be the element's measured size so the slices line up.
function buildBricks(cols, rows) {
  const bricks = [];
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      bricks.push({
        key: `${r}-${col}`,
        row: r,
        col,
        delay: Math.random() * 260,            // crumble order — chaotic
        driftX: (Math.random() - 0.5) * 70,    // sideways scatter
        spin: (Math.random() - 0.5) * 170,     // tumble rotation (deg)
        val: new Animated.Value(0),
      });
    }
  }
  return bricks;
}

export default function BrickShatter({ width, height, children, cols = 12, rows = 4, startDelay = 0 }) {
  const bricks = useRef(buildBricks(cols, rows)).current;
  const cellW = width / cols;
  const cellH = height / rows;

  useEffect(() => {
    const anim = Animated.parallel(
      bricks.map((b) =>
        Animated.sequence([
          Animated.delay(startDelay + b.delay),
          Animated.timing(b.val, {
            toValue: 1, duration: 620, easing: Easing.in(Easing.quad), useNativeDriver: true,
          }),
        ])
      )
    );
    anim.start();
    return () => anim.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ width, height }}>
      {bricks.map((b) => {
        const translateY = b.val.interpolate({ inputRange: [0, 1], outputRange: [0, height * 3 + 260] });
        const translateX = b.val.interpolate({ inputRange: [0, 1], outputRange: [0, b.driftX] });
        const rotate = b.val.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${b.spin}deg`] });
        const opacity = b.val.interpolate({ inputRange: [0, 0.65, 1], outputRange: [1, 1, 0] });
        return (
          <Animated.View
            key={b.key}
            style={{
              position: 'absolute',
              left: b.col * cellW, top: b.row * cellH,
              width: cellW, height: cellH,
              overflow: 'hidden',
              opacity,
              transform: [{ translateX }, { translateY }, { rotate }],
            }}
          >
            {/* full element, shifted so this brick shows its own slice */}
            <View style={{ position: 'absolute', left: -b.col * cellW, top: -b.row * cellH, width, height }}>
              {children}
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}
