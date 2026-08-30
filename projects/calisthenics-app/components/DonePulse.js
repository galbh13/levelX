import { useEffect } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

// The slow breath of a row that's already been cleared.
//
// It is deliberately the OPPOSITE END of the same idea as LiveMissionCard: that
// card runs hot (1.05s pulse + a sweep every 1.9s) because it wants you back in
// it. A finished row runs COLD — one edge glow, no travel, on a 3.4s cycle at low
// amplitude. Speed is the signal: the eye sorts live-vs-done by how fast the card
// breathes, before it reads a single word. Never make this faster or brighter
// than the live card, or the board starts shouting about work that's over.
//
// ONE shared clock drives every instance (refcounted, the same pattern as
// components/Shimmer.js), so a board of six cleared rows costs one native loop
// and they all breathe in unison — the system inhaling, not six loose animations.
const PERIOD = 3400;

const clock = new Animated.Value(0);
let loop = null;
let refs = 0;

function acquire() {
  refs += 1;
  if (loop) return;
  loop = Animated.loop(Animated.timing(clock, {
    toValue: 1, duration: PERIOD, easing: Easing.linear, useNativeDriver: true,
  }));
  loop.start();
}
function release() {
  refs = Math.max(0, refs - 1);
  if (refs > 0 || !loop) return;
  loop.stop();
  loop = null;
  clock.setValue(0);
}

export default function DonePulse({ active, color = '#4A9EBF', radius = 8 }) {
  useEffect(() => {
    if (!active) return undefined;
    acquire();
    return release;
  }, [active]);

  if (!active) return null;

  // Linear clock → triangle wave, so the glow eases up and back with no jump.
  const opacity = clock.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.14, 0.66, 0.14],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        styles.ring,
        { borderRadius: radius, borderColor: color, shadowColor: color, opacity },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  ring: {
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 12,
  },
});
