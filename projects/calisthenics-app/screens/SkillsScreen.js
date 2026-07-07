import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useTabAnimation } from '@react-navigation/material-top-tabs';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Modal,
  Animated, Easing, AccessibilityInfo,
} from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Circle, Ellipse, Path, G } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import { computeLvlFromData, computeClassMaxFromData } from '../lib/computeLvl';
import { evaluatePrestige, tier2SideChains, prestigeStars } from '../lib/prestige';
import { F } from '../constants/fonts';
import { ShimmerText, ShimmerFill, ShimmerFrame, BLUE, GOLD } from '../components/Shimmer';
import ScreenFrame from '../components/ScreenFrame';
import { CARD_W } from '../constants/layout';
import { hapticSuccess } from '../lib/haptics';

// ─── Theme ────────────────────────────────────────────────────────────────────

const SL = {
  bg:     '#050912',
  panel:  '#070d1a',
  border: '#1a3a5c',
  accent: '#4A9EBF',
  text:   '#E8F4FF',
  muted:  '#4a6a8a',
  danger: '#FF4444',
  green:  '#4CAF50',
  gold:   '#FFD700',
};

// Render the class rank as a Roman numeral (e.g. "2" → "II"). If the token is
// already non-numeric (already roman, or a worded rank), it's returned as-is.
// Shared shape with HomeScreen so the class crest reads identically on both.
const ROMAN = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];
function toRoman(token) {
  const n = parseInt(token, 10);
  if (!Number.isInteger(n) || String(n) !== String(token).trim() || n <= 0) return token;
  let out = '';
  let rem = n;
  for (const [val, sym] of ROMAN) { while (rem >= val) { out += sym; rem -= val; } }
  return out;
}

// Parse a "done / total" detail string into a clamped fill fraction so each
// prestige trial can render its own progress bar. Non-numeric details ("—", "")
// yield total 0 → no bar.
function parseProgress(detail) {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(detail ?? '').trim());
  if (!m) return { done: 0, total: 0, pct: 0 };
  const done = +m[1], total = +m[2];
  return { done, total, pct: total > 0 ? Math.min((done / total) * 100, 100) : 0 };
}

// ── Scroll-into-view visibility ──────────────────────────────────────────────
// The quest cards live below the fold, so their entrance/shine can't fire on the
// swipe-in (they're off-screen then). Instead each card fires when it SCROLLS INTO
// view — and re-fires every time it's re-exposed. SkillsScreen provides this
// context (the scroll offset + viewport + a subscribe hook + an `active` gate that
// stays false until the screen is actually entered); `useInViewport` below turns it
// into a per-card "entered viewport" counter.
const ScrollVizContext = React.createContext(null);
// A card broadcasts its current viewport-enter count to its children (the maxed
// gold gleam) via this — so the gleam replays in lockstep with the card.
const CardVizContext = React.createContext(undefined);

// Returns [ref, shown]: attach ref to the card's outer view; `shown` flips 0 → 1
// the FIRST time the card scrolls into view (once the screen is active), then never
// again — the entrance/shine plays once per card, not on every re-exposure.
function useInViewport() {
  const ctx = useContext(ScrollVizContext);
  const ref = useRef(null);
  const box = useRef(null);          // {y,h} of the card within the scroll content
  const fired = useRef(false);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!ctx) { setShown(1); return; }   // no scroll host (admin push) → just show
    let alive = true;
    // NOTE: react-native-web's hostNode.measureLayout swaps the success/failure
    // callbacks (it forwards them to UIManager in the wrong order), so on web the
    // measurement arrives on the "failure" arg. Pass the SAME handler to both slots
    // so it fires on every platform; guard on a numeric y to ignore real failures.
    const onMeasured = (x, y, w, h) => {
      if (alive && typeof y === 'number') { box.current = { y, h }; check(); }
    };
    const measure = () => {
      const node = ctx.measureRef.current;
      const el = ref.current;
      if (!node || !el || !el.measureLayout) return;
      try { el.measureLayout(node, onMeasured, onMeasured); }
      catch { /* measure unavailable → check() falls back to reveal */ }
    };
    let unsub = () => {};
    const fire = () => {
      if (fired.current) return;
      fired.current = true;
      setShown(1);
      unsub();          // done — stop watching this card
    };
    const check = () => {
      if (fired.current || !ctx.isActive()) return;
      // Fallback: if we couldn't measure the card's position, just reveal it once
      // (never leave it stuck invisible).
      if (!box.current) { fire(); return; }
      const { y, h } = box.current;
      const { scrollY, viewportH } = ctx.getViewport();
      if (!viewportH) return;
      const M = 44;   // must be ~44px onto the screen before it counts as "exposed"
      const isVis = (y + h - M) > scrollY && (y + M) < (scrollY + viewportH);
      if (isVis) fire();
    };
    unsub = ctx.subscribe(check);
    // Measure after layout settles (and again once the framed content has animated
    // in, so the cached positions are correct).
    const t1 = setTimeout(measure, 0);
    const t2 = setTimeout(measure, 300);
    return () => { alive = false; unsub(); clearTimeout(t1); clearTimeout(t2); };
  }, [ctx]);

  return [ref, shown];
}

// A celebratory "gleam" — a bright diagonal gold highlight that sweeps across a
// cleared trial tile. Width is measured via onLayout so the sweep crosses the full
// tile on any device. Trigger: if `play` is passed (or a CardVizContext is above
// it), the gleam replays whenever that token changes; otherwise it plays once on
// mount (legacy — the prestige checklist tiles).
function GateGleam({ radius = 12, play }) {
  const ctxPlay   = useContext(CardVizContext);
  const token     = play !== undefined ? play : ctxPlay;
  const controlled = token !== undefined;
  const p = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!w) return;
    if (controlled && token <= 0) { p.setValue(0); return; }   // armed, not yet exposed
    p.setValue(0);
    const anim = Animated.timing(p, {
      toValue: 1, duration: 1000, delay: 200,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [w, p, token, controlled]);

  const GLEAM_W = 80;
  const translateX = p.interpolate({ inputRange: [0, 1], outputRange: [-GLEAM_W, (w || 320) + GLEAM_W] });
  const opacity    = p.interpolate({ inputRange: [0, 0.12, 0.85, 1], outputRange: [0, 0.5, 0.5, 0] });

  return (
    <View
      pointerEvents="none"
      onLayout={e => setW(e.nativeEvent.layout.width)}
      style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}
    >
      <Animated.View
        style={{
          position: 'absolute', top: -30, bottom: -30, width: GLEAM_W,
          backgroundColor: GOLD[3], opacity,
          transform: [{ translateX }, { rotate: '20deg' }],
        }}
      />
    </View>
  );
}

// The level gauge, brought to life: the fill GROWS in on mount and carries a
// living shimmer (ice → gold at prestige); a pulsing energy "node" rides the fill
// head as the current-level marker; the prestige threshold gem breathes. Pure
// art over what was a flat bar.
// `play` is the entrance token (0 = armed at rest; bumps to 1 on the first swipe-in
// so the fill grows exactly once — see the introKey wiring in the screen).
function LevelGauge({ lvlPct, prestigePct, prestigeAt, prestigeReady, play = 1 }) {
  const grow   = useRef(new Animated.Value(0)).current;   // entrance fill grow
  const pulse  = useRef(new Animated.Value(0)).current;   // breathing node + gem
  const played = useRef(0);

  // Breathing node/gem loop — always running, independent of the entrance.
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  // Entrance grow: sits at 0 until the first focus (play → 1), then grows once.
  // A later data refetch (same play token) snaps to the new pct without replaying.
  useEffect(() => {
    if (play <= 0) { grow.setValue(0); return; }
    if (played.current === play) { grow.setValue(1); return; }
    played.current = play;
    grow.setValue(0);
    const enter = Animated.timing(grow, {
      toValue: 1, duration: 1100, delay: 150,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    });
    enter.start();
    return () => enter.stop();
  }, [grow, play]);

  const pct      = Math.max(0, Math.min(1, lvlPct)) * 100;
  const fillW    = grow.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${pct}%`] });
  const headLeft = grow.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${pct}%`] });
  const haloScale   = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] });
  const coreScale   = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] });
  const gemScale    = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] });

  const main = prestigeReady ? SL.gold : '#7FD8FF';

  return (
    <View style={styles.progressBarContainer}>
      <View style={styles.progressBarBg}>
        <Animated.View style={[styles.progressFillWrap, { width: fillW }]}>
          <ShimmerFill style={styles.progressBarFill} colors={prestigeReady ? GOLD : BLUE} active />
        </Animated.View>
      </View>

      {/* Current-level energy node riding the fill head. */}
      <Animated.View style={[styles.gaugeHead, { left: headLeft }]}>
        <View style={styles.gaugeHeadInner}>
          <Animated.View style={[styles.gaugeHeadHalo, { backgroundColor: main, transform: [{ scale: haloScale }], opacity: haloOpacity }]} />
          <Animated.View style={[styles.gaugeHeadCore, { backgroundColor: main, shadowColor: main, transform: [{ scale: coreScale }] }]} />
        </View>
      </Animated.View>

      {/* Prestige threshold marker — a breathing gold gem + pill. */}
      <View style={[styles.prestigeMarker, { left: `${prestigePct}%` }]}>
        <Animated.View style={[styles.prestigeMarkerGem, { transform: [{ rotate: '45deg' }, { scale: gemScale }] }]} />
        <View style={styles.prestigeMarkerStem} />
        <View style={styles.prestigeMarkerBadge}>
          <Text style={styles.prestigeMarkerLabel}>{prestigeAt}</Text>
        </View>
      </View>
    </View>
  );
}

// The LVL number, brought to life: on every mount it RUSHES up from 0 to the
// player's real level — the classic RPG "number go up" hit. Lands on the true
// value with an ease-out so it decelerates into place rather than snapping.
// Drives ShimmerText (gold glow at prestige) via a JS listener since text can't
// run on the native driver.
function LvlNumber({ lvl, active, play = 1 }) {
  const v = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState(0);
  const played = useRef(0);
  useEffect(() => {
    const id = v.addListener(({ value }) => setDisplay(Math.round(value)));
    return () => v.removeListener(id);
  }, [v]);
  // At rest (LVL 0) until the first swipe-in (play → 1); then rushes 0 → lvl once.
  // A later level change (same play token) snaps rather than re-counting.
  useEffect(() => {
    if (play <= 0) { v.setValue(0); return; }
    if (played.current === play) { v.setValue(lvl); return; }
    played.current = play;
    v.setValue(0);
    const anim = Animated.timing(v, {
      toValue: lvl, duration: 1000, delay: 250,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [lvl, play, v]);
  return <ShimmerText text={`LVL ${display}`} style={styles.lvlNumber} active={active} />;
}

// ─── Tier II lock (a barred GATE, chained shut) ───────────────────────────────
// While any Tier I side-chain is still unfinished, Tier II is sealed behind an iron
// GATE: forged vertical bars + top/bottom rails span the whole section, a steel
// chain is wrapped around the centre bars, and a padlock locks it. Rendered in SVG
// (react-native-svg) for crisp metallic gradients. The gate itself is rigid (it's
// bolted shut) — only the heavy padlock hangs loose and swings with a gentle
// spring (gust physics), and a metal glint sweeps across the bars. Pure overlay
// (pointerEvents:none) — the cards beneath are separately dimmed + disabled.

const AG      = Animated.createAnimatedComponent(G);
const ACircle = Animated.createAnimatedComponent(Circle);

// Lay chain links around an ellipse (a "wrap" cinched around the gate bars). Each
// link is tagged `back` (top arc, sits BEHIND the bars) or front (bottom arc, drawn
// OVER the bars) so the wrap weaves through the gate instead of floating on it.
function ellipseLinks(cx, cy, rx, ry, gap, phase = 0) {
  const perim = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry))); // Ramanujan
  const count = Math.max(12, Math.round(perim / gap));
  const arr = [];
  for (let i = 0; i < count; i++) {
    const th = (2 * Math.PI * i) / count;
    const y  = cy + ry * Math.sin(th);
    arr.push({
      x: cx + rx * Math.cos(th),
      y,
      angle: (Math.atan2(ry * Math.cos(th), -rx * Math.sin(th)) * 180) / Math.PI,
      flat: (i + phase) % 2 === 0,
      back: y < cy - 0.5,            // top half of the loop is behind the bars
    });
  }
  return arr;
}

// A single chain link as a beveled SVG ring: a dark under-stroke for depth + a
// metal-gradient stroke on top, rotated to the chain tangent. Flat = open oval seen
// face-on; edge = the foreshortened interlocking link between two flats.
function ChainLink({ x, y, angle, flat, scale = 1 }) {
  const rx = (flat ? 10 : 5) * scale;
  const ry = (flat ? 6.5 : 8.5) * scale;
  const rot = `rotate(${angle + (flat ? 0 : 90)} ${x} ${y})`;
  return (
    <>
      <Ellipse cx={x} cy={y} rx={rx} ry={ry} transform={rot} stroke="#16222e" strokeWidth={4.6 * scale} fill="none" />
      <Ellipse cx={x} cy={y} rx={rx} ry={ry} transform={rot} stroke="url(#chainMetal)" strokeWidth={3 * scale} fill="none" />
    </>
  );
}

function TierLock() {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [reduced, setReduced] = useState(false);
  const tilt  = useRef(new Animated.Value(0)).current;   // padlock micro-swing
  const glow  = useRef(new Animated.Value(0)).current;   // lock halo breathe
  const glint = useRef(new Animated.Value(0)).current;   // metal sheen sweep

  // Respect reduced-motion — guarded for web where the API can be undefined.
  useEffect(() => {
    let alive = true;
    try {
      AccessibilityInfo?.isReduceMotionEnabled?.()
        ?.then?.(v => { if (alive) setReduced(!!v); })
        ?.catch?.(() => {});
    } catch {}
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (reduced) return;
    let alive = true;
    // The lock is cinched tight, so it only barely settles: a small spring to a fresh
    // random target, a pause, repeat → a faint, irregular living tension on the chain.
    const gust = () => {
      if (!alive) return;
      Animated.spring(tilt, {
        toValue: Math.random() * 2 - 1, tension: 6, friction: 5, useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished && alive) setTimeout(gust, 600 + Math.random() * 1600);
      });
    };
    gust();
    const g = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.timing(glow, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
    ]));
    const sweep = Animated.loop(Animated.sequence([
      Animated.delay(2800),
      Animated.timing(glint, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(glint, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    g.start(); sweep.start();
    return () => { alive = false; tilt.stopAnimation(); g.stop(); sweep.stop(); };
  }, [reduced, tilt, glow, glint]);

  const { w, h } = size;
  const cx = w / 2;

  // Gate geometry (all derived from the measured overlay box).
  const barCount = Math.max(5, Math.round(w / 74));
  const railT    = 12;                     // top rail y
  const railB    = h - 26;                 // bottom rail y

  // The two central bars the chain binds together.
  const barXs   = Array.from({ length: barCount }, (_, i) => ((i + 0.5) * w) / barCount);
  let   rightI  = barXs.findIndex(bx => bx > cx);
  if (rightI < 1) rightI = Math.max(1, Math.round(barCount / 2));
  const bR      = barXs[rightI];
  const bL      = barXs[rightI - 1];
  const wrapCx  = (bL + bR) / 2;
  const wrapRx  = (bR - bL) / 2 + 17;      // encircle BOTH bars + grip
  const wrapRy  = 9;

  // Three wound turns of chain stacked into a tight coil around the two bars.
  const coilTop = h * 0.40;
  const turns   = [0, 13, 26].map((dy, k) => ({ cy: coilTop + dy, phase: k }));
  const claspY  = coilTop + 26 + wrapRy;   // bottom of the coil — where the lock clasps

  // Padlock, hanging from (and locking) the bottom of the coil.
  const shackleTop = claspY + 8;
  const bodyTop    = claspY + 26;
  const bodyW = 56, bodyH = 50;
  const bodyCx = wrapCx, bodyCy = bodyTop + bodyH / 2;

  // Animated pieces.
  const swingDeg = tilt.interpolate({ inputRange: [-1, 1], outputRange: [-2.6, 2.6] }); // taut micro-swing
  const haloOp   = glow.interpolate({ inputRange: [0, 1], outputRange: [0.14, 0.4] });
  const glintX   = glint.interpolate({ inputRange: [0, 1], outputRange: [-120, (w || 320) + 120] });

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={e => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      <View style={styles.lockScrim} />

      {w > 0 && h > 0 && (
        <>
          <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
            <Defs>
              {/* Cylindrical bar: tight specular over brushed steel → a round lit bar */}
              <LinearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0"    stopColor="#10181f" />
                <Stop offset="0.16" stopColor="#3a4d60" />
                <Stop offset="0.40" stopColor="#9fb4c7" />
                <Stop offset="0.49" stopColor="#eef6fd" />
                <Stop offset="0.58" stopColor="#90a6ba" />
                <Stop offset="0.84" stopColor="#2c3c4c" />
                <Stop offset="1"    stopColor="#0c131a" />
              </LinearGradient>
              {/* Rail: lit from above */}
              <LinearGradient id="rail" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0"    stopColor="#dceaf6" />
                <Stop offset="0.5"  stopColor="#7c91a6" />
                <Stop offset="1"    stopColor="#19232e" />
              </LinearGradient>
              {/* Chain + shackle metal */}
              <LinearGradient id="chainMetal" x1="0" y1="0" x2="0.3" y2="1">
                <Stop offset="0"    stopColor="#f1f7fd" />
                <Stop offset="0.45" stopColor="#9fb4c7" />
                <Stop offset="0.7"  stopColor="#5d748b" />
                <Stop offset="1"    stopColor="#26384a" />
              </LinearGradient>
              <LinearGradient id="lockBody" x1="0.1" y1="0" x2="0.5" y2="1">
                <Stop offset="0"    stopColor="#b9ccdd" />
                <Stop offset="0.32" stopColor="#8097ad" />
                <Stop offset="0.55" stopColor="#566f86" />
                <Stop offset="1"    stopColor="#1e2c3a" />
              </LinearGradient>
              {/* Vignette to focus the lock */}
              <RadialGradient id="focus" cx="50%" cy="42%" r="55%">
                <Stop offset="0"   stopColor="#000000" stopOpacity="0" />
                <Stop offset="1"   stopColor="#020509" stopOpacity="0.45" />
              </RadialGradient>
            </Defs>

            {/* ── BACK of the chain coil (top arcs) — drawn first so the bars cover it,
                   selling the over/under weave around the two centre bars. ── */}
            {turns.map(t => (
              <React.Fragment key={`bk${t.cy}`}>
                {ellipseLinks(wrapCx, t.cy, wrapRx, wrapRy, 11, t.phase)
                  .filter(l => l.back)
                  .map((l, i) => <ChainLink key={i} {...l} />)}
              </React.Fragment>
            ))}

            {/* ── The gate ── vertical bars + two rails + rivets */}
            {barXs.map((bx, i) => (
              <Rect key={`bar${i}`} x={bx - 7} y={0} width={14} height={h} rx={7} fill="url(#bar)" />
            ))}
            <Rect x={0} y={railT} width={w} height={15} rx={7.5} fill="url(#rail)" />
            <Rect x={0} y={railB} width={w} height={15} rx={7.5} fill="url(#rail)" />
            {barXs.map((bx, i) => (
              <React.Fragment key={`riv${i}`}>
                <Circle cx={bx} cy={railT + 7.5} r={3} fill="#0e151c" />
                <Circle cx={bx - 0.8} cy={railT + 6.7} r={1} fill="#9fb4c7" />
                <Circle cx={bx} cy={railB + 7.5} r={3} fill="#0e151c" />
                <Circle cx={bx - 0.8} cy={railB + 6.7} r={1} fill="#9fb4c7" />
              </React.Fragment>
            ))}

            {/* Vignette — darkens the gate toward the edges to focus the centre.
                Drawn over the bars but UNDER the front chain + lock, so the tie stays crisp. */}
            <Rect x={0} y={0} width={w} height={h} fill="url(#focus)" />

            {/* Soft shadow the coil casts onto the bars */}
            <Rect
              x={wrapCx - wrapRx - 4} y={coilTop - wrapRy - 3}
              width={(wrapRx + 4) * 2} height={26 + wrapRy * 2 + 6} rx={14}
              fill="#05080d" opacity={0.38}
            />

            {/* ── FRONT of the chain coil (bottom arcs) — drawn over the bars ── */}
            {turns.map(t => (
              <React.Fragment key={`fr${t.cy}`}>
                {ellipseLinks(wrapCx, t.cy, wrapRx, wrapRy, 11, t.phase)
                  .filter(l => !l.back)
                  .map((l, i) => <ChainLink key={i} {...l} />)}
              </React.Fragment>
            ))}

            {/* Soft glow behind the padlock */}
            <ACircle cx={bodyCx} cy={bodyCy} r={56} fill={SL.accent} opacity={haloOp} />

            {/* ── Padlock — clasps the bottom of the coil; only a taut micro-swing ── */}
            <AG rotation={swingDeg} originX={wrapCx} originY={claspY}>
              {/* lock shadow on the cards below */}
              <Ellipse cx={bodyCx} cy={bodyTop + bodyH + 4} rx={bodyW * 0.42} ry={5} fill="#04070b" opacity={0.45} />
              {/* the link the shackle locks THROUGH (the actual tie) */}
              <ChainLink x={wrapCx} y={claspY + 4} angle={90} flat />
              {/* shackle (U) — dark under-stroke then metal */}
              <Path
                d={`M ${wrapCx - 15} ${bodyTop + 3} L ${wrapCx - 15} ${shackleTop} A 15 15 0 0 1 ${wrapCx + 15} ${shackleTop} L ${wrapCx + 15} ${bodyTop + 3}`}
                stroke="#15212d" strokeWidth={11} fill="none" strokeLinecap="round"
              />
              <Path
                d={`M ${wrapCx - 15} ${bodyTop + 3} L ${wrapCx - 15} ${shackleTop} A 15 15 0 0 1 ${wrapCx + 15} ${shackleTop} L ${wrapCx + 15} ${bodyTop + 3}`}
                stroke="url(#chainMetal)" strokeWidth={7.5} fill="none" strokeLinecap="round"
              />
              {/* body */}
              <Rect x={bodyCx - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} rx={11} fill="#101a24" />
              <Rect x={bodyCx - bodyW / 2 + 1.5} y={bodyTop + 1.5} width={bodyW - 3} height={bodyH - 3} rx={9.5} fill="url(#lockBody)" />
              {/* left catch-light + right shade rolloff */}
              <Rect x={bodyCx - bodyW / 2 + 4} y={bodyTop + 5} width={5} height={bodyH - 10} rx={2.5} fill="rgba(238,246,253,0.30)" />
              <Rect x={bodyCx + bodyW / 2 - 8} y={bodyTop + 5} width={4} height={bodyH - 10} rx={2} fill="rgba(6,12,20,0.30)" />
              {/* corner screws */}
              {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy], i) => (
                <Circle key={`scr${i}`} cx={bodyCx + sx * (bodyW / 2 - 7)} cy={bodyCy + sy * (bodyH / 2 - 7)} r={1.7} fill="#0c141d" />
              ))}
              {/* keyhole — round eye + tapered slot */}
              <Circle cx={bodyCx} cy={bodyCy + 1} r={5} fill="#070d14" />
              <Path d={`M ${bodyCx - 2.4} ${bodyCy + 1} L ${bodyCx + 2.4} ${bodyCy + 1} L ${bodyCx + 1.3} ${bodyCy + 13} L ${bodyCx - 1.3} ${bodyCy + 13} Z`} fill="#070d14" />
              <Circle cx={bodyCx - 1.4} cy={bodyCy - 0.6} r={1.4} fill="rgba(150,170,190,0.5)" />
            </AG>
          </Svg>

          {/* A metal glint sweeping across the bars — keeps the gate feeling alive. */}
          <View style={styles.glintClip} pointerEvents="none">
            <Animated.View style={[styles.glint, { transform: [{ translateX: glintX }, { rotate: '18deg' }] }]} />
          </View>

          <Text style={[styles.lockLabel, { top: Math.min(bodyTop + bodyH + 12, h - 26), width: w }]}>
            GATE LOCKED · CLEAR TIER I
          </Text>
        </>
      )}
    </View>
  );
}

// A quest card with game-feel: it RISES up + fades in the FIRST time it scrolls
// into view (staggered by `delay` so a row of freshly-exposed cards cascades in),
// and DIPS to 0.97 under the finger on press — the tactile "this is tappable" cue
// the flat TouchableOpacity lacked. Children (incl. the absolute gold frame/gleam on
// maxed cards) ride inside untouched and get the same `shown` flag via CardVizContext
// so their shine fires with the card, once. `disabled` (sealed Tier II) kills press.
function QuestCard({ onPress, style, children, delay = 0, disabled = false }) {
  const [vpRef, shown] = useInViewport();
  const rise  = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(0)).current;
  // At rest (invisible) until first exposed; then rises/fades in ONCE (staggered by
  // `delay`). Native-driver. Does not replay on later re-exposures.
  useEffect(() => {
    if (shown <= 0) { rise.setValue(0); return; }
    rise.setValue(0);
    const anim = Animated.timing(rise, {
      toValue: 1, duration: 440, delay,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [rise, delay, shown]);

  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [20, 0] });
  const scale      = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] });
  const dip = to => Animated.timing(press, {
    toValue: to, duration: to ? 90 : 150, easing: Easing.out(Easing.quad), useNativeDriver: true,
  }).start();

  return (
    <View ref={vpRef} collapsable={false}>
      <CardVizContext.Provider value={shown}>
        <Animated.View style={{ opacity: rise, transform: [{ translateY }, { scale }] }}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={onPress}
            disabled={disabled}
            onPressIn={() => !disabled && dip(1)}
            onPressOut={() => !disabled && dip(0)}
            style={style}
          >
            {children}
          </TouchableOpacity>
        </Animated.View>
      </CardVizContext.Provider>
    </View>
  );
}

// ─── Prestige ceremony ────────────────────────────────────────────────────────
// The class-up moment. A full-screen gold rite: "✦ ASCENDED ✦" over the NEW
// class's gem medallion, stamping in from oversized with a spring while a gold
// halo breathes behind it. Shown once right after a successful prestige; any tap
// dismisses. Pure overlay — the screen beneath is already reloading the new class.
function PrestigeCeremony({ className, onDone }) {
  const stamp = useRef(new Animated.Value(0)).current;
  const glow  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const enter = Animated.spring(stamp, {
      toValue: 1, useNativeDriver: true, speed: 14, bounciness: 11, delay: 200,
    });
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    enter.start(); loop.start();
    return () => { enter.stop(); loop.stop(); };
  }, [stamp, glow]);

  const parts  = (className ?? '').trim().split(/\s+/).filter(Boolean);
  const rank   = parts.length > 1 ? parts[parts.length - 1] : (parts[0] ?? '');
  const scale  = stamp.interpolate({ inputRange: [0, 1], outputRange: [2.6, 1] });
  const haloOp = glow.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.7] });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDone}>
      <TouchableOpacity style={styles.riteBackdrop} activeOpacity={1} onPress={onDone}>
        <Animated.View style={{ alignItems: 'center', opacity: stamp, transform: [{ scale }] }}>
          <ShimmerText text="✦ ASCENDED ✦" style={styles.riteTitle} colors={GOLD} direction="ltr" active />

          <View style={styles.riteMedallionWrap}>
            <Animated.View style={[styles.riteHalo, { opacity: haloOp }]} />
            <View style={styles.riteMedallion} />
            <View style={styles.riteMedallionInner} />
            <Text style={styles.riteRank}>{toRoman(rank).toUpperCase()}</Text>
          </View>

          <Text style={styles.riteClassName}>{(className ?? '').toUpperCase()}</Text>
          <Text style={styles.riteHint}>TAP TO CONTINUE</Text>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SkillsScreen({ navigation, route }) {
  // Admin-as-coach: when launched with a `studentId` param the screen manages
  // THAT player (class / level / prestige / quests). With no param it falls back
  // to the signed-in user — the player's own Skills tab, unchanged.
  const overrideStudentId = route?.params?.studentId ?? null;
  const [profile,     setProfile]     = useState(null);
  const [classData,   setClassData]   = useState(null);
  const [quests,      setQuests]      = useState([]);
  const [completions, setCompletions] = useState(new Set());
  const [loading,     setLoading]     = useState(true);
  // This tab is pre-mounted at app start (swipe pager, lazy:false) and its whole
  // body stays mounted from then on. That's DELIBERATE for swipe smoothness: the
  // pager's page-slide + the bottom-bar indicator are driven by one shared
  // animated value, and if we mounted Skills' heavy SVG/Animated tree at
  // swipe-commit (as a first-focus gate did) that synchronous mount starved the
  // pager mid-transition → the indicator and the page visibly desynced and the
  // swipe stuttered. Mounting eagerly keeps every frame cheap. (The trade-off:
  // trade-off note.) The entrance still plays on the FIRST swipe-in — not by
  // mounting anything, but by flipping `introKey` 0 → 1 on first focus, which the
  // already-mounted LVL number / gauge / quest cards read as their `play` token and
  // fire their (cheap, mostly native-driver) animations exactly once. Set on first
  // focus, which already fires after the pager settles.
  const loadedRef = useRef(false);
  const [introKey, setIntroKey] = useState(0);
  const introStarted = useRef(false);

  // Self-service class management
  const [userId,      setUserId]      = useState(null);
  const [allClasses,  setAllClasses]  = useState([]);
  const [classListOpen, setClassListOpen] = useState(false);
  const [assigning,   setAssigning]   = useState(false);
  const [showPrestige, setShowPrestige] = useState(false);
  // Name of the class just ascended into → shows the full-screen gold ceremony.
  const [ceremony,    setCeremony]    = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const targetId = overrideStudentId ?? user.id;
      setUserId(targetId);

      const [{ data: profileData }, { data: classesData }] = await Promise.all([
        supabase
          .from('profiles')
          .select('full_name, class_id, prestige_count')
          .eq('id', targetId)
          .single(),
        supabase
          .from('classes')
          .select('*')
          .order('order_index'),
      ]);

      if (!profileData) return;
      setProfile(profileData);
      setAllClasses(classesData ?? []);

      if (!profileData.class_id) { setLoading(false); return; }

      const [classRes, questsRes, completionsRes] = await Promise.all([
        supabase
          .from('classes')
          .select('*')
          .eq('id', profileData.class_id)
          .single(),
        supabase
          .from('class_quests')
          .select('*')
          .eq('class_id', profileData.class_id)
          .order('quest_type')
          .order('chain')
          .order('order_index'),
        supabase
          .from('student_quest_completions')
          .select('quest_id')
          .eq('student_id', targetId),
      ]);

      setClassData(classRes.data ?? null);
      setQuests(questsRes.data ?? []);
      setCompletions(new Set((completionsRes.data ?? []).map(c => c.quest_id)));
    } catch (e) {
      console.error('[SkillsScreen] fetchData:', e);
    }
    loadedRef.current = true;
    setLoading(false);
  }, [overrideStudentId]);

  // Preload at app start (this tab is mounted before it's ever focused) so the
  // data is already in state by the time the player first swipes over.
  useEffect(() => { fetchData(); }, [fetchData]);

  // Fire the entrance exactly once. (Idempotent — first caller wins.)
  const startIntro = useCallback(() => {
    if (introStarted.current) return;
    introStarted.current = true;
    setIntroKey(1);
  }, []);

  // The shared pager position, when Skills is a tab scene. Skills is ALSO pushed in
  // the admin stack (no pager) where useTabAnimation() throws → read it safely and
  // fall back to null (the focus effect below is the trigger there instead).
  let tabPosition = null;
  try { tabPosition = useTabAnimation().position; } catch { tabPosition = null; }

  // Trigger the entrance the moment Skills becomes the majority screen mid-swipe
  // (position ≤ 0.5 — Skills is the leftmost tab, index 0), so it lands in sync
  // with the bottom-bar label flip at the 50% mark rather than trailing the
  // focus/settle event (which only fires once the swipe fully commits).
  useEffect(() => {
    if (!tabPosition) return;
    const id = tabPosition.addListener(({ value }) => { if (value <= 0.5) startIntro(); });
    return () => tabPosition.removeListener(id);
  }, [tabPosition, startIntro]);

  // Every focus refreshes the data SILENTLY — no setLoading(true), so swiping back
  // never flashes a spinner or remounts the body. Focus also fires the entrance as
  // a FALLBACK — for the admin path (no pager) and tab presses. On a swipe the
  // position listener above already fired it earlier, at 50%.
  useFocusEffect(useCallback(() => {
    if (loadedRef.current) fetchData();
    startIntro();
  }, [fetchData, startIntro]));

  // ── Scroll-into-view plumbing for the quest cards (see ScrollVizContext) ──────
  // The measure ancestor (content view), live scroll offset + viewport height, and
  // a tiny subscriber registry so each card re-checks its own visibility on scroll
  // WITHOUT re-rendering the whole list. `active` gates it shut until the screen is
  // entered so cards don't fire while pre-mounted off-screen.
  const measureRef  = useRef(null);
  const viewportRef = useRef({ scrollY: 0, viewportH: 0 });
  const subsRef     = useRef(new Set());
  const notifyViz   = useCallback(() => { subsRef.current.forEach(fn => fn()); }, []);
  const scrollViz = useMemo(() => ({
    measureRef,
    getViewport: () => viewportRef.current,
    isActive:    () => introStarted.current,
    subscribe:   (fn) => { subsRef.current.add(fn); return () => subsRef.current.delete(fn); },
  }), []);
  // When the screen becomes active (entrance fires), re-check every card so the ones
  // already on screen (above the fold) reveal right away.
  useEffect(() => { if (introKey > 0) notifyViz(); }, [introKey, notifyViz]);

  const onVizScroll = useCallback((e) => {
    viewportRef.current = { ...viewportRef.current, scrollY: e.nativeEvent.contentOffset.y };
    notifyViz();
  }, [notifyViz]);
  const onVizLayout = useCallback((e) => {
    viewportRef.current = { ...viewportRef.current, viewportH: e.nativeEvent.layout.height };
    notifyViz();
  }, [notifyViz]);

  // ── Self-service: assign own class ──────────────────────────────────────────

  async function handleAssignClass(cls) {
    if (!userId) return;
    setAssigning(true);
    const { error } = await supabase
      .from('profiles')
      .update({ class_id: cls.id })
      .eq('id', userId);
    setAssigning(false);
    setClassListOpen(false);
    if (error) { console.error('[SkillsScreen] assign class:', error); return; }
    setLoading(true);
    fetchData();
  }

  // ── Self-service: prestige (advance to next class) ──────────────────────────
  // Quest completions are intentionally preserved across prestige so computed
  // per-class LVL auto-restores if the player ever returns to a class.

  async function handlePrestige() {
    if (!userId) return;
    try {
      const currentClass = allClasses.find(c => c.id === profile?.class_id);
      const nextClass    = allClasses.find(c => c.order_index === (currentClass?.order_index ?? 0) + 1);

      // Already at the final class — there's nothing to advance into, so don't
      // touch anything (this is what used to inflate the counter past the class count).
      if (!nextClass) {
        alert('You are already at the highest class.');
        return;
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          prestige_count: (profile?.prestige_count ?? 0) + 1, // legacy history; stars derive from class
          class_id:       nextClass.id,
        })
        .eq('id', userId);
      if (error) throw error;

      // The class-up moment: success thump + full-screen gold ceremony while the
      // screen reloads the new class underneath.
      hapticSuccess();
      setCeremony(nextClass.name);
      setLoading(true);
      fetchData();
    } catch (e) {
      console.error('[SkillsScreen] prestige:', e);
    }
  }

  // Framed spinner while the preload is still in flight (first load only; later
  // focus refetches are silent so this never shows again).
  if (loading) {
    return (
      <ScreenFrame fill holoEntry={false} maxWidth={CARD_W}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={SL.accent} />
        </View>
        {/* Keep the ceremony alive across the post-prestige reload spinner. */}
        {ceremony && <PrestigeCeremony className={ceremony} onDone={() => setCeremony(null)} />}
      </ScreenFrame>
    );
  }

  const lvl        = computeLvlFromData(quests, completions);
  // Per-class scaling: max is the sum of every quest reward; the prestige line is
  // a configurable column (falls back to 80 for classes that predate it).
  const maxLvl     = computeClassMaxFromData(quests);
  const prestigeAt = classData?.prestige_at ?? 80;
  const lvlPct     = maxLvl > 0 ? Math.min(lvl / maxLvl, 1) : 0;
  const prestigePct = maxLvl > 0 ? Math.min((prestigeAt / maxLvl) * 100, 100) : 0;

  // Prestige is gated on THREE kinds of requirement (level + main quests +
  // 1 Tier II skill), evaluated declaratively per class. `prestigeReady.ok`
  // replaces the old `lvl >= prestigeAt` check everywhere below.
  const prestigeReady = evaluatePrestige({
    orderIndex:   classData?.order_index ?? 0,
    quests,
    completedIds: completions,
    lvl,
    prestigeAt,
  });

  // Stars = classes overcome (current order_index, +1 if the final class is fully met).
  const prestige = prestigeStars({
    orderIndex:    classData?.order_index ?? 0,
    classCount:    allClasses.length,
    finalClassMet: prestigeReady.ok,
  });

  // Build one entry per unique chain
  const mainChains = [...new Set(
    quests.filter(q => q.quest_type === 'main').map(q => q.chain).filter(Boolean)
  )];
  const sideChains = [...new Set(
    quests.filter(q => q.quest_type === 'side').map(q => q.chain).filter(Boolean)
  )];

  // Classify side-quest chains by tier (shared rule with lib/prestige): a chain
  // is Tier 2 when any of its quests is gated by a prerequisite in a DIFFERENT
  // chain (the cross-chain gate).
  const tier2Chains     = new Set(tier2SideChains(quests));
  const tier1SideChains = sideChains.filter(c => !tier2Chains.has(c));
  const tier2SideCh     = sideChains.filter(c =>  tier2Chains.has(c));

  function chainStats(chain, questType) {
    const chainQuests = quests.filter(q => q.chain === chain && q.quest_type === questType);
    const completed   = chainQuests.filter(q => completions.has(q.id));
    return {
      total:     chainQuests.length,
      completed: completed.length,
      earnedLvl: completed.reduce((s, q) => s + (q.lvl_reward ?? 0), 0),
    };
  }

  function openTree(chain, questType) {
    navigation.navigate('QuestTree', {
      classId:   profile?.class_id,
      chain,
      questType,
      studentId: overrideStudentId ?? undefined,
    });
  }

  // A running counter so every quest card across all sections gets a slightly
  // later entrance than the one before it — the whole quest list cascades in.
  const stagger = { n: 0 };

  // Tier II is sealed until EVERY Tier I side-chain is fully cleared.
  const tier1AllComplete = tier1SideChains.length > 0 && tier1SideChains.every(c => {
    const s = chainStats(c, 'side');
    return s.total > 0 && s.completed === s.total;
  });
  const tier2Locked = tier2SideCh.length > 0 && tier1SideChains.length > 0 && !tier1AllComplete;

  const renderChainCard = (chain, questType, locked = false) => {
    const { total, completed, earnedLvl } = chainStats(chain, questType);
    const complete = total > 0 && completed === total;
    const pct      = total > 0 ? completed / total : 0;
    const delay    = Math.min(stagger.n++ * 70, 560);
    return (
      <QuestCard
        key={chain}
        style={[styles.chainCard, complete && styles.chainCardComplete, locked && styles.chainCardLocked]}
        onPress={locked ? undefined : () => openTree(chain, questType)}
        disabled={locked}
        delay={delay}
      >
        <View style={styles.chainCardTop}>
          <View style={{ flex: 1 }}>
            {complete ? (
              <ShimmerText text={chain.toUpperCase()} style={[styles.chainCardTitle, styles.chainCardTitleMax]} colors={GOLD} direction="ltr" active />
            ) : (
              <Text style={styles.chainCardTitle}>{chain.toUpperCase()}</Text>
            )}
          </View>
          <View style={[styles.chainArrow, complete && styles.chainArrowComplete]}>
            <View style={[styles.chainArrowHead, complete && styles.chainArrowHeadComplete]} />
          </View>
        </View>

        <View style={[styles.chainProgressTrack, complete && styles.chainProgressTrackMax]}>
          {complete ? (
            <ShimmerFill style={styles.chainProgressFill} colors={GOLD} active />
          ) : (
            <View style={[styles.chainProgressFill, { width: `${pct * 100}%` }]} />
          )}
        </View>

        <View style={styles.chainCardMetaRow}>
          <Text style={[styles.chainCardMeta, complete && styles.chainCardMetaMax]}>
            {complete ? 'MAXED OUT' : `${completed}/${total} unlocked`}
          </Text>
          <Text style={[styles.chainCardReward, complete && styles.chainCardRewardMax]}>+{earnedLvl} LVL</Text>
        </View>

        {/* Cleared chains come alive in gold: a frame that sweeps clockwise plus a
            one-shot gleam that streaks across on entrance — the "maxed out" shine. */}
        {complete && (
          <>
            <ShimmerFrame style={styles.chainFrame} colors={GOLD} active radius={12} thickness={2} />
            <GateGleam radius={12} />
          </>
        )}
      </QuestCard>
    );
  };

  // Each tier is its own stacked, full-width section (replaces the cramped
  // 3-column grid that clipped long names like "HANDSTAND"). Empty tiers hide.
  const renderSection = (label, chains, questType, locked = false) => {
    if (!chains.length) return null;
    return (
      <View style={styles.questSection} key={label}>
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionHeader, locked && styles.sectionHeaderLocked]}>{label}</Text>
          <View style={styles.sectionHeaderLine} />
        </View>
        <View style={{ position: 'relative' }}>
          {chains.map(chain => renderChainCard(chain, questType, locked))}
          {locked && <TierLock />}
        </View>
      </View>
    );
  };

  return (
    <ScrollVizContext.Provider value={scrollViz}>
    <ScreenFrame fill holoEntry={false} maxWidth={CARD_W}>
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={onVizScroll}
      onLayout={onVizLayout}
    >
      <View ref={measureRef} collapsable={false} style={styles.body}>

      {/* Admin-as-coach: a BACK pill to return to the player roster. The player's
          own Skills tab has no param, so this never shows there. */}
      {overrideStudentId && (
        <TouchableOpacity
          style={styles.adminBack}
          onPress={() => navigation.goBack()}
          activeOpacity={0.85}
        >
          <Text style={styles.adminBackText}>← BACK</Text>
        </TouchableOpacity>
      )}

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.playerName}>{profile?.full_name?.toUpperCase() ?? '—'}</Text>

        {/* Class crest — the same gold gem-medallion language as the Home hero,
            with the prestige stars perched on top of the gem (no separate line). */}
        {classData && (() => {
          const parts  = (classData.name ?? '').trim().split(/\s+/).filter(Boolean);
          const rank   = parts.length > 1 ? parts[parts.length - 1] : (parts[0] ?? '');
          const kicker = parts.length > 1 ? parts.slice(0, -1).join(' ') : null;
          return (
            <View style={styles.classCrest}>
              <View style={styles.medallionWrap}>
                <View style={styles.medallion} />
                <View style={styles.medallionInner} />
                <Text style={styles.medallionRank}>{toRoman(rank).toUpperCase()}</Text>
              </View>
              {kicker && <Text style={styles.crestKicker}>{kicker.toUpperCase()}</Text>}
            </View>
          );
        })()}

        <LvlNumber lvl={lvl} active={prestigeReady.ok} play={introKey} />

        <LevelGauge
          lvlPct={lvlPct}
          prestigePct={prestigePct}
          prestigeAt={prestigeAt}
          prestigeReady={prestigeReady.ok}
          play={introKey}
        />
        {/* One label: the number. (Prestige readiness is announced by the gold
            banner right below — saying it here too was double messaging.) */}
        <Text style={styles.barLabel}>
          <Text style={[styles.barLabelNum, prestigeReady.ok && { color: SL.gold, textShadowColor: 'rgba(255,215,0,0.7)' }]}>
            {lvl} / {maxLvl}
          </Text>
        </Text>

        <View style={styles.headerDivider} />
      </View>

      {/* ── Prestige status on top, change-class control below ── */}
      <View style={styles.classRow}>
        {classData && (
        prestigeReady.ok ? (
          <View style={styles.prestigeBanner}>
            <View style={styles.prestigeBannerTitleWrap}>
              <ShimmerText
                text="⚡ PRESTIGE AVAILABLE"
                style={styles.prestigeBannerTitle}
                colors={GOLD}
                direction="ltr"
                active
              />
            </View>
            <Text style={styles.prestigeBannerSub}>
              All requirements met. Advance to the next class — your quest history is kept.
            </Text>
            <TouchableOpacity
              style={styles.prestigeActionBtn}
              onPress={() => setShowPrestige(true)}
              activeOpacity={0.85}
            >
              <ShimmerFill style={styles.prestigeActionGlow} colors={GOLD} active />
              <ShimmerText
                text="⚡ PRESTIGE NOW"
                style={styles.prestigeActionText}
                colors={GOLD}
                direction="ltr"
                active
              />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.reqCard}>
            {/* Trial header: gold seal + cleared-count + overall track */}
            <View style={styles.reqHeader}>
              <View style={styles.reqSeal}>
                <View style={styles.reqSealGem} />
                <View style={styles.reqSealGemCore} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.reqCardTitle}>PRESTIGE REQUIREMENTS</Text>
                <Text style={styles.reqCardSub}>
                  <Text style={styles.reqCardCount}>
                    {prestigeReady.checks.filter(c => c.ok).length} / {prestigeReady.checks.length}
                  </Text>
                  {'  '}REQUIREMENTS CLEARED
                </Text>
              </View>
            </View>
            <View style={styles.reqOverallTrack}>
              <View
                style={[
                  styles.reqOverallFill,
                  { width: `${(prestigeReady.checks.filter(c => c.ok).length / prestigeReady.checks.length) * 100}%` },
                ]}
              />
            </View>

            {prestigeReady.checks.map((c, idx) => {
              const { total, pct } = parseProgress(c.detail);
              return (
                <View key={c.key} style={[styles.gate, c.ok && styles.gateOk]}>
                  <View style={styles.gateMain}>
                    {/* Diamond status sigil — gold/filled when cleared, ice ring + step number while pending */}
                    <View style={[styles.gateGem, c.ok ? styles.gateGemOk : styles.gateGemPending]}>
                      {c.ok ? (
                        <ShimmerText
                          text="✓"
                          style={[styles.gateGemMark, styles.gateGemMarkOk]}
                          colors={GOLD}
                          sweep={false}
                          active
                        />
                      ) : (
                        <Text style={[styles.gateGemMark, styles.gateGemMarkPending]}>{idx + 1}</Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.gateLabel, c.ok && styles.gateLabelOk]}>{c.label}</Text>
                      {total > 0 && (
                        <View style={styles.gateBarRow}>
                          <View style={styles.gateBarTrack}>
                            {c.ok ? (
                              <ShimmerFill
                                style={[styles.gateBarFill, { width: `${pct}%` }]}
                                colors={GOLD}
                                active
                              />
                            ) : (
                              <View style={[styles.gateBarFill, { width: `${pct}%` }]} />
                            )}
                          </View>
                          <Text style={[styles.gateBarText, c.ok && styles.gateLabelOk]}>{c.detail}</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Per-requirement breakdown (main quests): exactly what's left */}
                  {c.items?.length > 0 && (
                    <View style={styles.gateSubs}>
                      {c.items.map((it, i) => (
                        <View key={i} style={styles.subQuest}>
                          <Text style={[styles.subQuestDot, it.ok ? styles.subQuestDotOk : styles.subQuestDotPending]}>
                            {it.ok ? '◆' : '◇'}
                          </Text>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.subQuestLabel, it.ok && styles.subQuestLabelOk]}>{it.label}</Text>
                            {!it.ok && it.remaining?.length > 0 && (
                              <Text style={styles.subQuestRemaining}>
                                Still needed: {it.remaining.join(' · ')}
                              </Text>
                            )}
                          </View>
                          {it.detail ? (
                            <Text style={[styles.subQuestDetail, it.ok && styles.subQuestLabelOk]}>{it.detail}</Text>
                          ) : null}
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Cleared trials come alive: a gold border that sweeps clockwise
                      plus a one-shot gleam that streaks across on entrance. */}
                  {c.ok && (
                    <>
                      <ShimmerFrame
                        style={styles.gateFrame}
                        colors={GOLD}
                        active
                        radius={12}
                        thickness={2}
                      />
                      <GateGleam radius={12} />
                    </>
                  )}
                </View>
              );
            })}
          </View>
        )
        )}

        {/* Change class — sits below the prestige status; opens the picker on tap */}
        <View style={styles.classCol}>
          <TouchableOpacity
            style={styles.manageClassBtn}
            onPress={() => setClassListOpen(o => !o)}
            activeOpacity={0.85}
          >
            <Text style={styles.manageClassBtnText}>
              {classData ? '⚙ CHANGE CLASS' : '+ ASSIGN CLASS'}
            </Text>
            <Text style={styles.manageClassChevron}>{classListOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Full-width class picker — opens directly under the CHANGE CLASS button. */}
      {classListOpen && (
        <View style={styles.classDropdown}>
          {allClasses.map(cls => {
            const selected = cls.id === profile?.class_id;
            return (
              <TouchableOpacity
                key={cls.id}
                style={[styles.classChip, selected && styles.classChipSelected]}
                onPress={() => handleAssignClass(cls)}
                disabled={assigning}
                activeOpacity={0.75}
              >
                <Text style={[styles.classChipText, selected && styles.classChipTextSelected]}>
                  {cls.name}
                </Text>
                {selected && <Text style={styles.classChipCheck}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* ── No class ── */}
      {!classData ? (
        <View style={styles.noClass}>
          <Text style={styles.noClassText}>NO CLASS ASSIGNED YET</Text>
          <Text style={styles.noClassSub}>Tap ASSIGN CLASS above to begin your journey.</Text>
        </View>
      ) : (
        <View style={styles.questSections}>
          {renderSection('MAIN QUESTS', mainChains, 'main')}
          {renderSection('TIER I', tier1SideChains, 'side')}
          {renderSection('TIER II', tier2SideCh, 'side', tier2Locked)}
        </View>
      )}

      <View style={{ height: 10 }} />
      </View>

      {/* ── Prestige confirm modal ── */}
      <Modal
        visible={showPrestige}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPrestige(false)}
      >
        <View style={[styles.modalOverlay, { justifyContent: 'center', paddingHorizontal: 24 }]}>
          <View style={styles.confirmBox}>
            <View style={styles.prestigeBannerTitleWrap}>
              <ShimmerText text="PRESTIGE?" style={styles.modalTitle} colors={GOLD} direction="ltr" active />
            </View>
            <Text style={styles.confirmText}>
              Advance to the next class? Your quest history will be kept.
            </Text>
            <View style={styles.confirmButtons}>
              <TouchableOpacity
                style={styles.confirmCancel}
                onPress={() => setShowPrestige(false)}
              >
                <Text style={styles.confirmCancelText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmOk}
                onPress={() => { setShowPrestige(false); handlePrestige(); }}
              >
                <ShimmerFill style={StyleSheet.absoluteFill} colors={GOLD} active />
                <Text style={styles.confirmOkText}>PRESTIGE</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Prestige ceremony — the class-up rite ── */}
      {ceremony && <PrestigeCeremony className={ceremony} onDone={() => setCeremony(null)} />}
    </ScrollView>
    </ScreenFrame>
    </ScrollVizContext.Provider>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // The scroll lives INSIDE the shared ScreenFrame (fill mode) now — the frame
  // supplies the animated ice-glow border + glow, matching Home/Workouts. This
  // scrolls within the fixed frame so all the quest sections stay reachable.
  scroll: { flex: 1, width: '100%' },
  // Center short states (e.g. "no class") vertically; long content scrolls from
  // the top.
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  // Just the inner padding now — the border/glow/rounding come from ScreenFrame.
  body: {
    width: '100%',
    paddingHorizontal: 14,
    paddingBottom: 16,
  },

  // ── Admin back pill (admin-as-coach only) ────────────────────────────────────
  adminBack: {
    alignSelf: 'flex-start',
    marginTop: 16,
    marginLeft: 16,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: SL.accent,
    backgroundColor: 'rgba(74,158,191,0.10)',
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 10,
  },
  adminBackText: {
    fontFamily: F.heading,
    fontSize: 15,
    color: SL.accent,
    letterSpacing: 2,
  },

  // ── Header ──────────────────────────────────────────────────────────────────

  header: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 14,
    alignItems: 'center',
  },
  playerName: {
    fontFamily: F.heading,
    fontSize: 56,
    color: '#FFFFFF',
    letterSpacing: 4,
    textAlign: 'center',
    // Bright white glow halo — shining, like the Home screen.
    textShadowColor: 'rgba(255,255,255,0.75)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 24,
  },
  // Class crest — a compact echo of the Home hero's gold gem-medallion. The
  // prestige stars sit just above the gem so rank + prestige read as one emblem.
  classCrest: {
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 6,
  },
  medallionWrap: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The gem — a rotated rounded square, gold border + gold glow, faint gold fill.
  medallion: {
    position: 'absolute',
    width: 58,
    height: 58,
    borderRadius: 11,
    borderWidth: 2.5,
    borderColor: SL.gold,
    backgroundColor: 'rgba(255,215,0,0.06)',
    transform: [{ rotate: '45deg' }],
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 14,
  },
  medallionInner: {
    position: 'absolute',
    width: 42,
    height: 42,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: SL.gold,
    opacity: 0.4,
    transform: [{ rotate: '45deg' }],
  },
  medallionRank: {
    fontFamily: F.displayHeavy,
    fontSize: 30,
    color: SL.gold,
    letterSpacing: 1,
    textShadowColor: 'rgba(255,215,0,0.9)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
  },
  crestKicker: {
    fontFamily: F.displayHeavy,
    fontSize: 18,
    color: SL.gold,
    letterSpacing: 9,
    // Cinzel is all-caps; pad left so the wide tracking stays visually centered.
    paddingLeft: 9,
    marginTop: 8,
    opacity: 0.95,
  },
  lvlNumber: {
    fontFamily: F.heading,
    fontSize: 80,
    color: SL.accent,
    letterSpacing: 4,
    lineHeight: 88,
    marginTop: 2,
    marginBottom: 10,
    // Ice-glow halo — shining, matching the Home screen's LVL number.
    textShadowColor: 'rgba(74,158,191,0.85)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 30,
  },
  progressBarContainer: {
    position: 'relative',
    height: 20,
    justifyContent: 'center',
    width: '100%',
    // Reserve room below the bar for the threshold marker (gem + stem + badge)
    // that hangs down, so it can't collide with the bar label underneath.
    marginBottom: 40,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: SL.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  // Animated width wrapper (grows in on mount); the shimmer fill lives inside it.
  progressFillWrap: {
    height: '100%',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    width: '100%',
    backgroundColor: SL.accent,
    borderRadius: 3,
  },
  // Pulsing "current level" energy node that rides the head of the fill.
  gaugeHead: {
    position: 'absolute',
    top: 5,
    width: 0,
    alignItems: 'center',
  },
  // Fixed 10×10 anchor so halo + core stay concentric on the fill-head line.
  gaugeHeadInner: {
    width: 10,
    height: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gaugeHeadHalo: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  gaugeHeadCore: {
    width: 10,
    height: 10,
    borderRadius: 5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 8,
  },
  // Prestige threshold marker — a glowing gold gem sitting on the bar, a short
  // stem, and the level in a gold pill. width:0 keeps it centered exactly on the
  // threshold point (children center on the absolute left% line).
  prestigeMarker: {
    position: 'absolute',
    top: 4,
    width: 0,
    alignItems: 'center',
  },
  prestigeMarkerGem: {
    width: 11,
    height: 11,
    backgroundColor: SL.gold,
    borderRadius: 2,
    transform: [{ rotate: '45deg' }],
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  prestigeMarkerStem: {
    width: 2,
    height: 6,
    marginTop: 1,
    borderRadius: 1,
    backgroundColor: SL.gold,
    opacity: 0.5,
  },
  prestigeMarkerBadge: {
    marginTop: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: SL.gold,
    borderRadius: 4,
    backgroundColor: 'rgba(255,215,0,0.08)',
  },
  prestigeMarkerLabel: {
    fontFamily: F.bodyMed,
    fontSize: 15,
    color: SL.gold,
    letterSpacing: 1,
  },
  barLabel: {
    fontFamily: F.bodyMed,
    fontSize: 22,
    color: SL.muted,
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: 6,
  },
  // Bold, glowing current/target — the hero of the label line.
  barLabelNum: {
    fontFamily: F.heading,
    fontSize: 24,
    color: '#7FD8FF',
    letterSpacing: 1.5,
    textShadowColor: 'rgba(127,216,255,0.7)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  // Stacked: prestige status on top, change-class control beneath — each full width.
  classRow: {
    gap: 14,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  classCol: { gap: 10 },
  manageClassBtn: {
    alignSelf: 'stretch',
    minHeight: 46,
    flexDirection: 'row',
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: 'rgba(74,158,191,0.06)',
    // Soft ice-glow frame, matching the Home page panels.
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  manageClassBtnText: {
    fontFamily: F.heading,
    fontSize: 24,
    color: SL.accent,
    letterSpacing: 2,
    textAlign: 'center',
  },
  manageClassChevron: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.accent,
  },
  // Full-width class picker — a row of equal pills so each name shows in full.
  classDropdown: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  classChip: {
    flexGrow: 1,
    flexBasis: '30%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 12,
    backgroundColor: SL.panel,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  classChipSelected: {
    borderColor: SL.gold,
    backgroundColor: 'rgba(255,215,0,0.08)',
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  classChipText: {
    fontFamily: F.heading,
    fontSize: 24,
    color: SL.text,
    letterSpacing: 1.5,
  },
  classChipTextSelected: { color: SL.gold },
  classChipCheck: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.gold,
  },

  prestigeBanner: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderWidth: 1.5,
    borderColor: SL.gold,
    borderRadius: 12,
    backgroundColor: 'rgba(255,215,0,0.06)',
    // Soft gold glow frame, matching the Home page panels.
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
  },
  prestigeActionBtn: {
    marginTop: 12,
    height: 46,
    borderWidth: 1.5,
    borderColor: SL.gold,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,215,0,0.1)',
    overflow: 'hidden',
  },
  // Moving gold glow behind the PRESTIGE NOW label — kept low-opacity so the
  // gold text stays readable over it (same shimmer as the LVL gauge).
  prestigeActionGlow: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.25,
  },
  prestigeBannerTitleWrap: {
    alignItems: 'center',
  },
  prestigeActionText: {
    fontFamily: F.heading,
    fontSize: 32,
    color: SL.gold,
    letterSpacing: 3,
  },
  prestigeBannerTitle: {
    fontFamily: F.heading,
    fontSize: 30,
    color: SL.gold,
    letterSpacing: 3,
    textAlign: 'center',
    marginBottom: 6,
  },
  prestigeBannerSub: {
    fontFamily: F.bodyMed,
    fontSize: 24,
    color: SL.gold,
    opacity: 0.8,
    letterSpacing: 0.5,
    textAlign: 'center',
  },

  // ── Prestige trials (RPG-styled checklist, shown until all gates pass) ───────
  reqCard: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255,215,0,0.35)',
    borderRadius: 16,
    backgroundColor: SL.panel,
    // Gold ascension glow — this is the trial of advancement, not a plain panel.
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    gap: 14,
  },
  reqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  // Round gold seal with a crossed-swords sigil — the trial's emblem.
  reqSeal: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1.5,
    borderColor: SL.gold,
    backgroundColor: 'rgba(255,215,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
  },
  // A gold gem sitting in the seal — a rotated rounded square with a faint inner
  // gem, echoing the class-crest medallion instead of the old stray triangle.
  reqSealGem: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: SL.gold,
    backgroundColor: 'rgba(255,215,0,0.12)',
    transform: [{ rotate: '45deg' }],
  },
  reqSealGemCore: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 2,
    backgroundColor: SL.gold,
    transform: [{ rotate: '45deg' }],
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 6,
  },
  reqCardTitle: {
    fontFamily: F.heading,
    fontSize: 26,
    color: SL.gold,
    letterSpacing: 3,
  },
  reqCardSub: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: '#9FE4FF',           // cool ice label (was muted)
    letterSpacing: 1.5,
    marginTop: 3,
  },
  // The "X / Y" count — bold, fat and gold so it pops out of the label.
  reqCardCount: {
    fontFamily: F.heading,
    fontSize: 21,
    color: SL.gold,
    letterSpacing: 1,
  },
  // Overall "trials cleared" progress under the header.
  reqOverallTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: SL.border,
    overflow: 'hidden',
  },
  reqOverallFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: SL.gold,
  },

  // Each requirement is a "gate": its own bordered tile, gold when cleared.
  gate: {
    borderWidth: 1,
    borderColor: SL.border,
    borderRadius: 12,
    backgroundColor: 'rgba(20,40,64,0.22)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  gateOk: {
    borderColor: 'rgba(255,215,0,0.45)',
    backgroundColor: 'rgba(255,215,0,0.06)',
    // Gold ascension glow under the animated frame.
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
  // Absolute overlay carrying the live gold ShimmerFrame border on cleared gates.
  gateFrame: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
  },
  gateMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  // Rotated square = a gem/sigil. Holds a step number while pending, ✓ when cleared.
  gateGem: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
  },
  gateGemOk: {
    borderColor: SL.gold,
    backgroundColor: 'rgba(255,215,0,0.15)',
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
  },
  gateGemPending: {
    borderColor: SL.accent,
    backgroundColor: 'rgba(74,158,191,0.08)',
  },
  gateGemMark: {
    fontFamily: F.heading,
    fontSize: 18,
    transform: [{ rotate: '-45deg' }], // counter-rotate so the glyph sits upright
  },
  gateGemMarkOk:      { color: SL.gold },
  gateGemMarkPending: { color: SL.accent },
  gateLabel: {
    fontFamily: F.bodyMed,
    fontSize: 22,
    color: SL.text,
    letterSpacing: 0.5,
  },
  gateLabelOk: { color: SL.gold },
  gateBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  gateBarTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: SL.border,
    overflow: 'hidden',
  },
  gateBarFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: SL.accent,
  },
  gateBarText: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 0.5,
    minWidth: 52,
    textAlign: 'right',
  },

  // Indented per-requirement breakdown under a gate (each main-quest group/node).
  gateSubs: {
    gap: 6,
    paddingLeft: 10,
    marginLeft: 16,
    borderLeftWidth: 1,
    borderLeftColor: SL.border,
  },
  subQuest: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 2,
  },
  subQuestDot: {
    fontSize: 16,
    width: 18,
    textAlign: 'center',
    lineHeight: 26,
  },
  subQuestDotOk:      { color: '#FFFFFF' },
  subQuestDotPending: { color: SL.muted },
  subQuestLabel: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.text,
    letterSpacing: 0.5,
    opacity: 0.92,
  },
  subQuestLabelOk: { color: '#FFFFFF', opacity: 1 },
  subQuestRemaining: {
    fontFamily: F.bodyMed,
    fontSize: 17,
    color: SL.muted,
    letterSpacing: 0.3,
    marginTop: 2,
    lineHeight: 22,
  },
  subQuestDetail: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 0.5,
    lineHeight: 26,
  },

  headerDivider: {
    height: 1,
    backgroundColor: SL.border,
    alignSelf: 'stretch',
    marginTop: 24,
    opacity: 0.6,
  },

  // ── No class ────────────────────────────────────────────────────────────────

  noClass: {
    paddingVertical: 60,
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 32,
  },
  noClassText: {
    fontFamily: F.heading,
    fontSize: 30,
    color: SL.muted,
    letterSpacing: 3,
    textAlign: 'center',
  },
  noClassSub: {
    fontFamily: F.bodyMed,
    fontSize: 25,
    color: SL.muted,
    letterSpacing: 0.5,
    textAlign: 'center',
    opacity: 0.7,
  },

  // ── Quest sections (stacked full-width rows: main / tier I / tier II) ─────────
  // One section per tier, laid out top-to-bottom so each chain card spans the
  // full width — long names ("HANDSTAND") wrap cleanly instead of clipping.

  questSections: {
    paddingHorizontal: 16,
    marginTop: 18,
    gap: 24,
  },
  questSection: { gap: 10 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 2,
  },
  sectionHeader: {
    fontFamily: F.heading,
    fontSize: 27,
    color: SL.accent,
    letterSpacing: 3,
  },
  // Sealed Tier II header reads in cool steel, not the live ice accent.
  sectionHeaderLocked: {
    color: '#8aa6bf',
    opacity: 0.8,
  },
  // Glowing ice hairline trailing each section header.
  sectionHeaderLine: {
    flex: 1,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: SL.accent,
    opacity: 0.3,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
  },

  // ── Chain cards (full width) ──────────────────────────────────────────────────

  chainCard: {
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 11,
    marginBottom: 12,
    // Soft ice-glow frame, matching the Home page cards.
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
  },
  // Fully-cleared ("maxed out") chains turn gold: faint gold wash + gold glow,
  // under the animated gold ShimmerFrame border.
  chainCardComplete: {
    borderColor: 'rgba(255,215,0,0.45)',
    backgroundColor: 'rgba(255,215,0,0.05)',
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
  },
  // Sealed Tier II cards are pushed back: dimmed + desaturated behind the lock.
  chainCardLocked: {
    opacity: 0.4,
  },

  // ── Tier II lock overlay (barred gate + chained padlock, drawn in SVG) ─────────
  // Dark wash over the sealed cards, so the gate reads as the foreground.
  lockScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5,9,18,0.5)',
    borderRadius: 12,
  },
  // Clips the moving metal glint to the gate area.
  glintClip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 12,
    overflow: 'hidden',
  },
  // A bright diagonal sliver that sweeps across the bars → fleeting steel catch-light.
  glint: {
    position: 'absolute',
    top: -40,
    bottom: -40,
    width: 60,
    backgroundColor: 'rgba(220,236,250,0.10)',
  },
  lockLabel: {
    position: 'absolute',
    left: 0,
    textAlign: 'center',
    fontFamily: F.heading,
    fontSize: 16,
    letterSpacing: 2,
    color: '#cdddec',
    textShadowColor: 'rgba(74,158,191,0.7)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },

  // Absolute overlay carrying the live gold ShimmerFrame border on maxed chains.
  chainFrame: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
  },
  chainCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  chainCardTitle: {
    fontFamily: F.heading,
    fontSize: 30,
    color: SL.text,
    letterSpacing: 2,
  },
  // Maxed title carries a gold glow halo behind the shimmer.
  chainCardTitleMax: {
    textShadowColor: 'rgba(255,215,0,0.7)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
  },
  // Enter-tree affordance — a glowing ice "node" with a chevron drawn from two
  // borders, replacing the bare ›. Ice-blue on incomplete chains; turns all gold
  // on maxed chains to match the gold treatment.
  chainArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(74,158,191,0.5)',
    backgroundColor: 'rgba(74,158,191,0.10)',
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 10,
  },
  chainArrowComplete: {
    borderColor: 'rgba(255,215,0,0.7)',
    backgroundColor: 'rgba(255,215,0,0.12)',
    shadowColor: SL.gold,
  },
  // The chevron itself: a small square showing only its top+right edges, rotated
  // 45° to point right. Nudged left so the glyph sits optically centered.
  chainArrowHead: {
    width: 11,
    height: 11,
    borderTopWidth: 2.5,
    borderRightWidth: 2.5,
    borderColor: SL.accent,
    transform: [{ rotate: '45deg' }],
    marginLeft: -3,
  },
  chainArrowHeadComplete: {
    borderColor: SL.gold,
  },
  // Slim per-chain completion bar — instant read on how far the chain is done.
  chainProgressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: SL.border,
    overflow: 'hidden',
  },
  // Maxed track glows gold to frame the full shimmer fill.
  chainProgressTrackMax: {
    backgroundColor: 'rgba(255,215,0,0.15)',
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
  },
  chainProgressFill: {
    height: '100%',
    width: '100%',
    borderRadius: 3,
    backgroundColor: SL.accent,
  },
  chainCardMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chainCardMeta: {
    fontFamily: F.bodyMed,
    fontSize: 21,
    color: SL.muted,
    letterSpacing: 1,
  },
  // "MAXED OUT" reads gold with a soft glow.
  chainCardMetaMax: {
    fontFamily: F.heading,
    color: SL.gold,
    letterSpacing: 2,
    textShadowColor: 'rgba(255,215,0,0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  chainCardReward: {
    fontFamily: F.heading,
    fontSize: 21,
    color: SL.gold,
    letterSpacing: 1,
  },
  chainCardRewardMax: {
    textShadowColor: 'rgba(255,215,0,0.7)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },

  // ── Class modal ───────────────────────────────────────────────────────────────

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalTitle: {
    fontFamily: F.heading,
    fontSize: 30,
    color: SL.accent,
    letterSpacing: 4,
    textAlign: 'center',
    marginBottom: 16,
  },
  // ── Prestige ceremony (the class-up rite) ───────────────────────────────────
  riteBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(1,3,8,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  riteTitle: {
    fontFamily: F.displayHeavy,
    fontSize: 34,
    color: SL.gold,
    letterSpacing: 6,
    textAlign: 'center',
    marginBottom: 28,
    textShadowColor: 'rgba(255,215,0,0.8)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 22,
  },
  riteMedallionWrap: {
    width: 150,
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Breathing gold aura behind the gem.
  riteHalo: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(255,215,0,0.10)',
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 60,
  },
  riteMedallion: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: SL.gold,
    backgroundColor: 'rgba(255,215,0,0.08)',
    transform: [{ rotate: '45deg' }],
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 28,
  },
  riteMedallionInner: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: SL.gold,
    opacity: 0.4,
    transform: [{ rotate: '45deg' }],
  },
  riteRank: {
    fontFamily: F.displayHeavy,
    fontSize: 52,
    color: SL.gold,
    letterSpacing: 1,
    textShadowColor: 'rgba(255,215,0,0.9)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  riteClassName: {
    fontFamily: F.displayHeavy,
    fontSize: 26,
    color: SL.gold,
    letterSpacing: 8,
    paddingLeft: 8,
    marginTop: 26,
    textAlign: 'center',
    textShadowColor: 'rgba(255,215,0,0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  riteHint: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.muted,
    letterSpacing: 3,
    marginTop: 34,
  },

  // ── Prestige confirm modal ──────────────────────────────────────────────────

  confirmBox: {
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.gold,
    borderRadius: 8,
    padding: 24,
    gap: 16,
  },
  confirmText: {
    fontFamily: F.bodyMed,
    fontSize: 22,
    color: SL.text,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  confirmCancel: {
    flex: 1,
    height: 44,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmCancelText: {
    fontFamily: F.bodyMed,
    fontSize: 24,
    color: SL.muted,
    letterSpacing: 2,
  },
  confirmOk: {
    flex: 1,
    height: 44,
    backgroundColor: SL.gold,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  confirmOkText: {
    fontFamily: F.heading,
    fontSize: 24,
    color: SL.bg,
    letterSpacing: 2,
  },
});
