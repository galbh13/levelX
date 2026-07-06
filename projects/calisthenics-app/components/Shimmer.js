import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, Text } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

// ─── Live shimmer ───────────────────────────────────────────────────────────
// A looping color cycle through a palette, used to make UI come alive:
//   • <ShimmerText> — a label that shimmers. `sweep` (default) animates each
//     glyph with a phase offset for a travelling rainbow-style wave; pass
//     sweep={false} for a single-color cycle that preserves text wrapping
//     (needed for multi-line labels like quest names).
//   • <ShimmerFill> — progress-bar fill that sweeps the palette across its width.
// Pass `colors` to choose a palette (GOLD by default; BLUE also exported).
//
// All instances share ONE looping clock (refcounted below), so the cost is a
// single JS timer no matter how many shimmer at once, and they stay in sync.
// Color can't run on the native driver, hence useNativeDriver:false.

// Warm golds: deep amber → gold → bright yellow → lemon, for a molten feel.
export const GOLD = ['#F9A825', '#FFB300', '#FFD700', '#FFEB3B', '#FFF176', '#FFC107'];
// Cool ice blues → cyan → vivid blue, matching the app's accent family.
export const BLUE = ['#4A9EBF', '#5AC8FA', '#0A84FF', '#00C7BE', '#64D2FF', '#7AA7FF'];
// Bordeaux: deep wine → crimson → bright rose and back. Strong contrast so the
// sweep reads clearly as it travels around the frame.
export const BORDEAUX = ['#2E0512', '#6A0F2A', '#A31034', '#E11D48', '#FF5C8A', '#8B1538'];

// ── Shared clock (refcounted) ───────────────────────────────────────────────
const clock = new Animated.Value(0);
let clockLoop = null;
let refs = 0;

function acquireClock(duration) {
  refs += 1;
  if (!clockLoop) {
    clockLoop = Animated.loop(
      Animated.timing(clock, {
        toValue: 1, duration, easing: Easing.linear, useNativeDriver: false,
      }),
    );
    clockLoop.start();
  }
}
function releaseClock() {
  refs = Math.max(0, refs - 1);
  if (refs === 0 && clockLoop) {
    clockLoop.stop();
    clockLoop = null;
    clock.setValue(0);
  }
}

function useShimmer(active, duration) {
  useEffect(() => {
    if (!active) return;
    acquireClock(duration);
    return releaseClock;
  }, [active, duration]);
}

// Interpolate the shared clock into a palette color, offset by `shift` stops.
// The ramp duplicates its first color at the end (seamless loop, no jump).
function shimmerColor(colors, shift) {
  const n = colors.length;
  const inputRange = Array.from({ length: n + 1 }, (_, k) => k / n);
  const outputRange = [];
  for (let k = 0; k <= n; k++) outputRange.push(colors[(k + shift) % n]);
  return clock.interpolate({ inputRange, outputRange });
}

// Like shimmerColor but with a CONTINUOUS phase `offset` (a fraction of the
// cycle, not a whole palette stop). Lets many segments sit at fractional points
// between palette colors, so a strip of them forms a smooth gradient instead of
// hard color bands. `offset` is added to the clock and wrapped to [0, 1).
function shimmerColorPhase(colors, offset) {
  const n = colors.length;
  const inputRange = Array.from({ length: n + 1 }, (_, k) => k / n);
  const outputRange = [...colors, colors[0]];
  return Animated.modulo(Animated.add(clock, offset), 1).interpolate({ inputRange, outputRange });
}

export function ShimmerText({
  text, style, active, colors = GOLD, sweep = true, direction = 'rtl',
  numberOfLines, duration = 1600,
}) {
  useShimmer(active, duration);
  if (!active) return <Text style={style} numberOfLines={numberOfLines}>{text}</Text>;

  // Single-color cycle — preserves wrapping/numberOfLines for multi-line labels.
  if (!sweep) {
    return (
      <Animated.Text style={[style, { color: shimmerColor(colors, 0) }]} numberOfLines={numberOfLines}>
        {text}
      </Animated.Text>
    );
  }

  // Per-glyph sweep. The leading char's `shift` advances the wave: leftmost
  // leads for left → right ('ltr'), rightmost leads for right → left ('rtl').
  //
  // Each glyph is its own <Text>, so a naive flex-wrap row would break lines in
  // the MIDDLE of words. To wrap on word boundaries only, we group each word's
  // glyphs into an inner non-wrapping row; the outer row wraps between those
  // word groups (at the spaces). A single word longer than the line still wraps
  // by character as a last resort, matching native behaviour.
  const full  = String(text);
  const total = full.length;
  // Split into word / whitespace tokens, keeping the whitespace so spacing and
  // glyph indices stay correct.
  const tokens = full.split(/(\s+)/).filter(t => t.length > 0);
  let cursor = 0;

  const glyph = (ch, gIndex, key) => {
    const pos   = direction === 'ltr' ? gIndex : total - 1 - gIndex;
    const shift = pos % colors.length;
    return (
      <Animated.Text key={key} style={[style, { color: shimmerColor(colors, shift) }]}>
        {ch}
      </Animated.Text>
    );
  };

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {tokens.map((token, ti) => {
        const start = cursor;
        cursor += token.length;
        // Whitespace token: render as a plain space (a wrap opportunity).
        if (/^\s+$/.test(token)) {
          return <Text key={ti} style={style}>{token}</Text>;
        }
        // Word token: glyphs grouped in a row that does NOT wrap internally.
        return (
          <View key={ti} style={{ flexDirection: 'row' }}>
            {token.split('').map((ch, j) => glyph(ch, start + j, j))}
          </View>
        );
      })}
    </View>
  );
}

// A "live frame" over a card: the border is built from many thin segments laid
// around the perimeter, each tinted with a CONTINUOUS phase offset so they blend
// into a smooth gradient — like the LVL gauge (ShimmerFill), but bent around the
// rectangle and finer-grained. As the shared clock runs, the gradient sweeps
// CLOCKWISE around the frame. No moving dot, no dimming. `style` supplies the
// absolute fill + glow shadow; `thickness` is the border width.
//
// Each edge maps exactly one full palette cycle along its flow direction, so the
// phase reaches the first color again at every corner (offset 0 ↔ 1) — making
// all four corners line up seamlessly with no global indexing needed.
const FRAME_SEG = 24;   // segments per edge — higher = smoother gradient
export function ShimmerFrame({ style, colors = GOLD, active, radius = 5, thickness = 3.5, duration = 1600 }) {
  useShimmer(active, duration);
  if (!active) return null;

  // One edge: `FRAME_SEG` flex segments flowing in `dir`, each at a fractional
  // phase across the cycle so adjacent segments differ only slightly (smooth).
  const edge = (key, pos, dir) => (
    <View key={key} style={[pos, { flexDirection: dir, overflow: 'hidden' }]}>
      {Array.from({ length: FRAME_SEG }).map((_, i) => (
        <Animated.View
          key={i}
          style={{ flex: 1, backgroundColor: shimmerColorPhase(colors, (i + 0.5) / FRAME_SEG) }}
        />
      ))}
    </View>
  );

  const t = thickness;
  const r = Math.max(radius, 0);
  // Two layers:
  //  1. A single UNIFORM rounded border (real CSS `borderWidth`/`borderRadius`) in
  //     the OUTER wrapper, which is `overflow:'visible'` so this border is never
  //     clipped — a CSS border is perfectly even thickness everywhere, corner arcs
  //     included, so the frame is the same width all the way around (no gap, no
  //     thinning). It cycles a palette color.
  //  2. The travelling gradient strips, in an INNER rounded clip so their square
  //     corners are trimmed. The clip may shave the strips slightly at the corners,
  //     but the uniform border below shows through there at full thickness — so the
  //     corner width never depends on the clipped layer.
  const cornerColor = shimmerColorPhase(colors, 0);

  return (
    <Animated.View
      pointerEvents="none"
      style={[style, { borderWidth: 0, borderRadius: r, overflow: 'visible' }]}
    >
      <Animated.View
        pointerEvents="none"
        style={{ ...StyleSheet.absoluteFillObject, borderRadius: r, borderWidth: t, borderColor: cornerColor }}
      />
      <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, borderRadius: r, overflow: 'hidden' }}>
        {edge('top',    { position: 'absolute', top: 0,    left: 0,   right: 0,  height: t }, 'row')}
        {edge('right',  { position: 'absolute', top: 0,    bottom: 0, right: 0,  width: t  }, 'column')}
        {edge('bottom', { position: 'absolute', bottom: 0, left: 0,   right: 0,  height: t }, 'row-reverse')}
        {edge('left',   { position: 'absolute', top: 0,    bottom: 0, left: 0,   width: t  }, 'column-reverse')}
      </View>
    </Animated.View>
  );
}

// A "live frame" for a CIRCLE: a gradient-stroked ring that slowly rotates, so
// the palette sweeps continuously around the circle — the round counterpart to
// ShimmerFrame (which only does straight edges). Driven by the same shared clock
// (interpolated to a 0→360° rotation), so it stays in sync and costs no extra
// timer. `size` is the ring's diameter; `thickness` the stroke width. Render it
// as an absolute overlay sized to the avatar; the stroke sits exactly on the
// avatar's edge. Each instance gets a unique gradient id so multiple rings (or a
// ring + other svg gradients) never collide in the DOM on web.
export function ShimmerRing({ size, thickness = 5, colors = BLUE, active, duration = 1600 }) {
  const idRef = useRef(`shimmerRing_${Math.random().toString(36).slice(2)}`);
  useShimmer(active, duration);
  if (!active) return null;

  const id = idRef.current;
  const r  = (size - thickness) / 2;   // center radius → outer edge lands on `size`
  const c  = size / 2;
  const rotate = clock.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const n = colors.length;

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', transform: [{ rotate }] }]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
            {colors.map((col, i) => (
              <Stop key={i} offset={`${(i / (n - 1)) * 100}%`} stopColor={col} />
            ))}
          </LinearGradient>
        </Defs>
        <Circle cx={c} cy={c} r={r} stroke={`url(#${id})`} strokeWidth={thickness} fill="none" />
      </Svg>
    </Animated.View>
  );
}

// Progress-bar fill that sweeps the palette across its width while active —
// built from many thin segments, each at a CONTINUOUS fractional phase (same
// technique as ShimmerFrame) so adjacent segments differ only slightly and blend
// into one smooth travelling gradient instead of hard color bands. The strip maps
// exactly one full palette cycle across its width. Falls back to a plain <View>
// when inactive.
const FILL_SEGMENTS = 30;
export function ShimmerFill({ style, active, colors = GOLD, duration = 1600 }) {
  useShimmer(active, duration);
  if (!active) return <View style={style} />;
  return (
    <Animated.View style={[style, { flexDirection: 'row', overflow: 'hidden' }]}>
      {Array.from({ length: FILL_SEGMENTS }).map((_, i) => {
        // Reversed offset keeps the previous travel direction.
        const offset = (FILL_SEGMENTS - 1 - i + 0.5) / FILL_SEGMENTS;
        return (
          <Animated.View key={i} style={{ flex: 1, backgroundColor: shimmerColorPhase(colors, offset) }} />
        );
      })}
    </Animated.View>
  );
}
