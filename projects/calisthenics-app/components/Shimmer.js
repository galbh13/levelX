import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, Text } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

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

// ─── Sweeping gradient strip (the engine behind the bars and frames) ────────
// A travelling palette gradient, done the cheap way: ONE static SVG gradient
// (the palette laid out twice, end to end) slid by exactly one cycle on a loop.
// The slide is a transform, so it runs on the NATIVE thread — the JS thread does
// no per-frame work at all.
//
// This replaces the old approach: a row of 24–30 <Animated.View>s each
// interpolating its own backgroundColor off the shared JS clock. That cost ~30
// color computations + bridge writes PER STRIP PER FRAME, and a screen carries
// many strips at once (a card frame is four; the Skills screen adds a fill per
// chain; all four tabs stay mounted). Hundreds of JS-driven color nodes on one
// clock is exactly what made the level bars stutter.
//
// The visible span always carries EXACTLY ONE full palette cycle, so the phase
// at the end of a strip equals the phase at its start — which is what lets the
// four edges of a frame meet seamlessly at the corners.
function GradientStrip({ w, h, colors, vertical }) {
  // Palette twice, plus a closing copy of the first color: sliding by one cycle
  // lands on an identical pattern, so the loop has no visible seam.
  const stops = useMemo(() => {
    const ramp = [...colors, ...colors, colors[0]];
    return ramp.map((col, i) => ({ col, offset: `${(i / (ramp.length - 1)) * 100}%` }));
  }, [colors]);
  const id = useRef(`sweep_${Math.random().toString(36).slice(2)}`).current;

  return (
    <Svg width={w} height={h}>
      <Defs>
        <LinearGradient
          id={id}
          x1="0%" y1="0%"
          x2={vertical ? '0%' : '100%'}
          y2={vertical ? '100%' : '0%'}
        >
          {stops.map((s, i) => <Stop key={i} offset={s.offset} stopColor={s.col} />)}
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width={w} height={h} fill={`url(#${id})`} />
    </Svg>
  );
}

// `vertical` flows top→bottom instead of left→right; `reverse` flips the travel
// direction (used by a frame's bottom and left edges, so the sweep runs
// clockwise all the way around).
function SweepStrip({ style, colors, duration, vertical = false, reverse = false }) {
  const t = useRef(new Animated.Value(0)).current;
  const [box, setBox] = useState({ w: 0, h: 0 });
  const settle = useRef(null);

  useEffect(() => {
    t.setValue(0);
    const loop = Animated.loop(Animated.timing(t, {
      toValue: 1, duration, easing: Easing.linear, useNativeDriver: true,
    }));
    loop.start();
    return () => loop.stop();
  }, [duration, t]);

  useEffect(() => () => clearTimeout(settle.current), []);

  // Layout is taken only once it SETTLES. A level bar grows in over ~1.1s, which
  // fires a layout event every frame; rebuilding the gradient on each one would
  // re-introduce exactly the per-frame JS work this component exists to avoid.
  // We wait for the size to hold still, then measure once.
  const onLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    const w = Math.round(width);
    const h = Math.round(height);
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      setBox(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
    }, 120);
  };

  // One cycle spans the strip; the sheet holds two, and slides by one.
  const span = vertical ? box.h : box.w;
  const shift = t.interpolate({
    inputRange: [0, 1],
    outputRange: reverse ? [0, -span] : [-span, 0],
  });

  return (
    <View style={[style, { overflow: 'hidden' }]} onLayout={onLayout}>
      {span > 0 && box.w > 0 && box.h > 0 && (
        <Animated.View
          pointerEvents="none"
          // The strip never changes, only its position — so hand it to the GPU
          // as a texture once and let the compositor move it. Without this the
          // gradient is re-rasterized on every frame of the sweep.
          renderToHardwareTextureAndroid
          shouldRasterizeIOS
          style={[
            { position: 'absolute' },
            vertical
              ? { top: 0, left: 0, width: box.w, height: span * 2, transform: [{ translateY: shift }] }
              : { left: 0, top: 0, width: span * 2, height: box.h, transform: [{ translateX: shift }] },
          ]}
        >
          <GradientStrip
            w={vertical ? box.w : span * 2}
            h={vertical ? span * 2 : box.h}
            colors={colors}
            vertical={vertical}
          />
        </Animated.View>
      )}
    </View>
  );
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
export function ShimmerFrame({ style, colors = GOLD, active, radius = 5, thickness = 3.5, duration = 1600 }) {
  // Only the thin uniform under-border still rides the shared JS clock — one
  // color node per frame instead of the 96 the segmented edges used to cost.
  useShimmer(active, duration);
  if (!active) return null;

  // One edge: a single sweeping gradient strip, slid on the native thread.
  // `vertical`/`reverse` are chosen so the sweep runs CLOCKWISE: right along the
  // top, down the right, left along the bottom, up the left.
  const edge = (key, pos, vertical, reverse) => (
    <SweepStrip key={key} style={pos} colors={colors} duration={duration} vertical={vertical} reverse={reverse} />
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
        {edge('top',    { position: 'absolute', top: 0,    left: 0,   right: 0,  height: t }, false, false)}
        {edge('right',  { position: 'absolute', top: 0,    bottom: 0, right: 0,  width: t  }, true,  false)}
        {edge('bottom', { position: 'absolute', bottom: 0, left: 0,   right: 0,  height: t }, false, true)}
        {edge('left',   { position: 'absolute', top: 0,    bottom: 0, left: 0,   width: t  }, true,  true)}
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

// Progress-bar fill that sweeps the palette across its width while active — one
// SweepStrip, so the travel costs the JS thread nothing per frame. The visible
// width carries exactly one palette cycle, travelling left → right. Falls back
// to a plain <View> when inactive.
export function ShimmerFill({ style, active, colors = GOLD, duration = 1600 }) {
  if (!active) return <View style={style} />;
  return <SweepStrip style={style} colors={colors} duration={duration} />;
}
