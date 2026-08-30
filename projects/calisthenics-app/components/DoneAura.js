import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { ShimmerFrame } from './Shimmer';
import { glowRamp } from '../lib/colorMix';

// The living border of a row you've already cleared.
//
// A finished mission or daily quest keeps ONE continuous motion: a light that
// travels around its frame, forever, in the row's own colour (rose for a
// handstand, gold for accessories, ice for a quest). Nothing about it starts or
// stops — that's the point. A one-shot celebration is over in half a second and
// the board goes dead again; a row that keeps moving still has something to look
// at ten minutes later.
//
// It reuses ShimmerFrame, the same live frame a CLASS GATE node wears in the
// quest tree, so "this one is settled" is said in a shape the app already uses.
// The palette is built from the row's colour instead of being a fixed one
// (GOLD/BLUE), which is what keeps a cleared handstand mission pink.
//
// The travel is a native-thread transform on a static SVG gradient — one cheap
// strip per edge, no per-frame JS — so a board of cleared rows stays smooth on
// the APK. Renders nothing at all while the row is unfinished.
export default function DoneAura({ active, color = '#4A9EBF', radius = 8, thickness = 2.5 }) {
  const colors = useMemo(() => glowRamp(color), [color]);
  if (!active) return null;

  return (
    <ShimmerFrame
      style={[styles.frame, { borderRadius: radius, shadowColor: color }]}
      colors={colors}
      radius={radius}
      thickness={thickness}
      duration={3200}
      active
    />
  );
}

const styles = StyleSheet.create({
  frame: {
    ...StyleSheet.absoluteFillObject,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 9,
  },
});
