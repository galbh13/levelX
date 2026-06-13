import { View, StyleSheet, Animated, Platform } from 'react-native';
import { C } from '../constants/colors';

// The visual layer of a deviation — a datamosh / signal-corruption wash with a
// motion-blur smear, drawn on top of everything, never eats touches. Hidden
// until LoginScreen drives `opacity` up during a hit.
//  • a real backdrop BLUR of the screen behind (web) → the smeared look
//  • bands   : HORIZONTAL pixel-smear displacement bars that shear sideways
//  • streaks : dense thin VERTICAL columns (the corrupted-video-signal look)
//  • a faint emergency wash underneath = the "system failing" dread
export default function DeviationOverlay({ opacity, streaks, bands, sliceOff }) {
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
      {/* emergency dread wash */}
      <View style={[StyleSheet.absoluteFill, styles.wash]} />

      {/* real blur of whatever is behind (web only) → smeared frame */}
      {Platform.OS === 'web' && (
        <View
          style={[StyleSheet.absoluteFill, {
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
          }]}
        />
      )}

      {/* horizontal pixel-smear displacement bands */}
      {bands.map((b, i) => (
        <Animated.View
          key={`b${i}`}
          style={{
            position: 'absolute',
            left: 0, right: 0, top: b.top, height: b.h,
            backgroundColor: b.color, opacity: b.op,
            transform: [{ translateX: i % 2 === 0 ? Animated.multiply(sliceOff, -1) : sliceOff }],
          }}
        />
      ))}

      {/* dense vertical data-corruption streaks */}
      {streaks.map((s, i) => (
        <View
          key={`v${i}`}
          style={{
            position: 'absolute',
            top: 0, bottom: 0, left: s.left, width: s.w,
            backgroundColor: s.color, opacity: s.op,
          }}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wash: { backgroundColor: C.bordeaux, opacity: 0.10 },
});
