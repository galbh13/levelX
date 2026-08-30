import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

// The "cleared" beat — a bright bar that scans across a row the moment it is
// ticked off, leaving a soft wash of the row's own colour behind it.
//
// It is deliberately the SAME gesture the system uses everywhere else (the quest
// gate's scan bar, HoloBuild's build-front, the shimmer sweep): the app confirms
// things by running a line over them. Checking a box off is the app agreeing with
// you, so it answers in that voice instead of with a new one.
//
// Plays ONLY on the false → true flip — never on mount, so a screen that loads
// with six already-finished rows doesn't fire six celebrations. Native-driver
// (opacity + translateX), and it unmounts itself the moment it's done, so a
// settled card costs nothing.
export default function ClearSweep({ done, color = '#4A9EBF', duration = 460, delay = 0, radius = 0 }) {
  const t = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);
  const [playing, setPlaying] = useState(false);
  const prev = useRef(!!done);

  useEffect(() => {
    const was = prev.current;
    prev.current = !!done;
    if (!done || was) return;             // mount, or un-ticking → nothing
    t.setValue(0);
    setPlaying(true);
    const anim = Animated.timing(t, {
      toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    anim.start(({ finished }) => { if (finished) setPlaying(false); });
    return () => anim.stop();
  }, [done, duration, delay, t]);

  const BAR = 30;
  const x      = t.interpolate({ inputRange: [0, 1], outputRange: [-BAR, (w || 260) + BAR] });
  const barO   = t.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, 1, 1, 0] });
  const washO  = t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.2, 0] });

  return (
    // Always mounted (unstyled + empty when idle) so the row's width is measured
    // before the first tap — the bar has nowhere to travel otherwise.
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, radius ? { borderRadius: radius, overflow: 'hidden' } : null]}
      onLayout={e => setW(e.nativeEvent.layout.width)}
    >
      {playing && w > 0 && (
        <>
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: color, opacity: washO }]}
          />
          <Animated.View
            style={[
              styles.bar,
              { backgroundColor: color, shadowColor: color, opacity: barO, transform: [{ translateX: x }] },
            ]}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: -6,
    bottom: -6,
    width: 3,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 14,
  },
});
