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
import { DEFAULT_JOB } from '../lib/jobs';
import { visibleQuests } from '../lib/hiddenQuests';
import { withMirrorCompletions } from '../lib/mirrorQuests';
import {
  mergeQuestProgress, reconcileQuestProgress, subscribeQuestProgress, hasPendingQuestProgress,
} from '../lib/questProgress';
import { upgradeFor, isUpgradeChain, fetchUpgrades } from '../lib/questUpgrades';
import { F } from '../constants/fonts';
import { ShimmerText, ShimmerFill, ShimmerFrame, BLUE, GOLD } from '../components/Shimmer';
import ScreenFrame from '../components/ScreenFrame';
import { useTourTarget, useTourScroller } from '../lib/tourTargets';
import { CARD_W } from '../constants/layout';

// Skills runs WIDER than the shared player-card width: the quest rows are long
// horizontal bars (title + progress + arrow) and read better with room to breathe.
// Height is untouched - the frame still fills the screen.
const SKILLS_CARD_W = Math.round(CARD_W * 1.5);   // 1200 -> 1800


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

// UPGRADE plating. Deliberately amber — one step warm of the ice-blue base card,
// one step short of the pure gold reserved for MAXED OUT. An upgraded chain should
// look promoted at a glance without pretending it's already finished.
const UP = {
  hot:  '#FFC46B',                 // the plating itself (rail, plate text, bevel)
  text: '#FFE3B0',                 // title ink
  dim:  'rgba(255,196,107,0.55)',  // frame
  wash: 'rgba(255,196,107,0.06)',  // card fill
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
function GateGleam({ radius = 12, play, color = GOLD[3], peak = 0.5 }) {
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
  const opacity    = p.interpolate({ inputRange: [0, 0.12, 0.85, 1], outputRange: [0, peak, peak, 0] });

  return (
    <View
      pointerEvents="none"
      onLayout={e => setW(e.nativeEvent.layout.width)}
      style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}
    >
      <Animated.View
        style={{
          position: 'absolute', top: -30, bottom: -30, width: GLEAM_W,
          backgroundColor: color, opacity,
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

// ─── Tier II lock (one heavy chain, clasped by a padlock) ─────────────────────
// While any Tier I side-chain is still unfinished, Tier II is sealed by a single
// heavy chain: bolted to an anchor plate on each edge, it sags under its own
// weight to a low point at the centre of the section, where a padlock clasps it
// shut. One focal element and a lot of air. Rendered in SVG for real metallic
// gradients. Motion stays quiet and physical: the seal fades in and the lock
// settles from a small deflection, then keeps a faint irregular sway (gust
// springs); an ice halo breathes behind the lock and a steel glint sweeps the
// chain. Pure overlay (pointerEvents:none) — the cards beneath are separately
// dimmed + disabled.

const AG      = Animated.createAnimatedComponent(G);
const ACircle = Animated.createAnimatedComponent(Circle);

// Sample chain links along a quadratic bezier (the chain's sag curve): position +
// tangent angle per link, alternating flat (face-on oval) / edge (foreshortened
// interlocking link) so the run reads as a real chain.
function bezierLinks(p0, ctrl, p2, gap, phase = 0) {
  const at = t => ({
    x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * ctrl.x + t * t * p2.x,
    y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * ctrl.y + t * t * p2.y,
  });
  let len = 0, prev = at(0);
  for (let i = 1; i <= 24; i++) { const p = at(i / 24); len += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p; }
  const count = Math.max(4, Math.round(len / gap));
  const links = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count, p = at(t);
    const dx = 2 * (1 - t) * (ctrl.x - p0.x) + 2 * t * (p2.x - ctrl.x);
    const dy = 2 * (1 - t) * (ctrl.y - p0.y) + 2 * t * (p2.y - ctrl.y);
    links.push({ x: p.x, y: p.y, angle: (Math.atan2(dy, dx) * 180) / Math.PI, flat: (i + phase) % 2 === 0 });
  }
  return links;
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
  const enter = useRef(new Animated.Value(0)).current;     // seal fade-in (every mount)
  const tilt  = useRef(new Animated.Value(1.8)).current;   // padlock sway — starts deflected, settles
  const glow  = useRef(new Animated.Value(0)).current;     // ice halo breathe
  const glint = useRef(new Animated.Value(0)).current;     // steel sheen sweep

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

  // Entrance — plays on every mount, i.e. every time the section renders locked.
  useEffect(() => {
    const a = Animated.timing(enter, {
      toValue: 1, duration: 450, easing: Easing.out(Easing.quad), useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [enter]);

  useEffect(() => {
    if (reduced) { tilt.setValue(0); return; }
    let alive = true;
    // The lock hangs from a taut chain, so it never swings wide: it springs from
    // its entrance deflection to rest, then to a fresh small random target, pause,
    // repeat → a faint, irregular living tension.
    const gust = (to) => {
      if (!alive) return;
      Animated.spring(tilt, {
        toValue: to, tension: 5, friction: 4, useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished && alive) setTimeout(() => gust(Math.random() * 2 - 1), 900 + Math.random() * 1800);
      });
    };
    gust(0);
    const g = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.timing(glow, { toValue: 0, duration: 1700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
    ]));
    const sweep = Animated.loop(Animated.sequence([
      Animated.delay(3200),
      Animated.timing(glint, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(glint, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    g.start(); sweep.start();
    return () => { alive = false; tilt.stopAnimation(); g.stop(); sweep.stop(); };
  }, [reduced, tilt, glow, glint]);

  const { w, h } = size;
  const cx = w / 2;
  const k  = h > 0 ? Math.min(1, Math.max(0.72, h / 230)) : 1;   // shrink the lock on short sections
  const s  = 0.9 * k;                                            // chain link scale

  // The chain: from a bolted plate on each edge, sagging to its low point at the
  // centre. Two mirrored bezier runs meeting under the padlock's clasp.
  const anchorY  = h * 0.24;
  const dipY     = h * 0.38;
  const linkGap  = 13 * s;
  const leftRun  = bezierLinks({ x: 6, y: anchorY }, { x: cx * 0.52, y: dipY + 7 }, { x: cx - 3, y: dipY }, linkGap, 0);
  const rightRun = bezierLinks({ x: cx + 3, y: dipY }, { x: w - cx * 0.52, y: dipY + 7 }, { x: w - 6, y: anchorY }, linkGap, 1);

  // Padlock, clasping the chain's low point.
  const claspY     = dipY + 2;
  const shR        = 15 * k;               // shackle radius
  const shackleTop = claspY + 8 * k;
  const bodyTop    = claspY + 26 * k;
  const bodyW = 58 * k, bodyH = 52 * k;
  const bodyCx = cx, bodyCy = bodyTop + bodyH / 2;

  // Animated pieces.
  const swingDeg = tilt.interpolate({ inputRange: [-1, 1], outputRange: [-2.4, 2.4] }); // taut micro-sway
  const haloOp   = glow.interpolate({ inputRange: [0, 1], outputRange: [0.10, 0.32] });
  const glintX   = glint.interpolate({ inputRange: [0, 1], outputRange: [-120, (w || 320) + 120] });

  const plateW = 14, plateH = 26 * k;

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={e => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      <View style={styles.lockScrim} />

      {w > 0 && h > 0 && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: enter }]}>
          <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
            <Defs>
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
              {/* Vignette to focus the seal */}
              <RadialGradient id="focus" cx="50%" cy="42%" r="60%">
                <Stop offset="0" stopColor="#000000" stopOpacity="0" />
                <Stop offset="1" stopColor="#020509" stopOpacity="0.4" />
              </RadialGradient>
            </Defs>

            <Rect x={0} y={0} width={w} height={h} fill="url(#focus)" />

            {/* Bolted anchor plates the chain hangs from */}
            {[{ x: -4 }, { x: w - plateW + 4 }].map(({ x }, i) => (
              <React.Fragment key={`pl${i}`}>
                <Rect x={x} y={anchorY - plateH / 2} width={plateW} height={plateH} rx={4} fill="#101a24" />
                <Rect x={x + 1.5} y={anchorY - plateH / 2 + 1.5} width={plateW - 3} height={plateH - 3} rx={3} fill="url(#lockBody)" />
                <Circle cx={x + plateW / 2} cy={anchorY - plateH / 2 + 5.5} r={1.8} fill="#0c141d" />
                <Circle cx={x + plateW / 2} cy={anchorY + plateH / 2 - 5.5} r={1.8} fill="#0c141d" />
              </React.Fragment>
            ))}

            {/* Soft shadow the sagging chain casts on the cards below */}
            <Ellipse cx={cx} cy={dipY + 12 * k} rx={w * 0.3} ry={5} fill="#04070b" opacity={0.22} />

            {/* ── The chain — two mirrored runs meeting under the clasp ── */}
            {leftRun.map((l, i)  => <ChainLink key={`cl${i}`} {...l} scale={s} />)}
            {rightRun.map((l, i) => <ChainLink key={`cr${i}`} {...l} scale={s} />)}

            {/* Breathing ice halo behind the padlock */}
            <ACircle cx={bodyCx} cy={bodyCy} r={56 * k} fill={SL.accent} opacity={haloOp} />

            {/* ── Padlock — clasps the chain's low point; only a taut micro-sway ── */}
            <AG rotation={swingDeg} originX={cx} originY={claspY}>
              {/* lock shadow on the cards below */}
              <Ellipse cx={bodyCx} cy={bodyTop + bodyH + 5} rx={bodyW * 0.42} ry={4.5} fill="#04070b" opacity={0.45} />
              {/* the link the shackle locks THROUGH (the actual clasp) */}
              <ChainLink x={cx} y={claspY + 3} angle={90} flat scale={s} />
              {/* shackle (U) — dark under-stroke then metal */}
              <Path
                d={`M ${cx - shR} ${bodyTop + 3} L ${cx - shR} ${shackleTop} A ${shR} ${shR} 0 0 1 ${cx + shR} ${shackleTop} L ${cx + shR} ${bodyTop + 3}`}
                stroke="#15212d" strokeWidth={11 * k} fill="none" strokeLinecap="round"
              />
              <Path
                d={`M ${cx - shR} ${bodyTop + 3} L ${cx - shR} ${shackleTop} A ${shR} ${shR} 0 0 1 ${cx + shR} ${shackleTop} L ${cx + shR} ${bodyTop + 3}`}
                stroke="url(#chainMetal)" strokeWidth={7.5 * k} fill="none" strokeLinecap="round"
              />
              {/* body */}
              <Rect x={bodyCx - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} rx={11 * k} fill="#101a24" />
              <Rect x={bodyCx - bodyW / 2 + 1.5} y={bodyTop + 1.5} width={bodyW - 3} height={bodyH - 3} rx={9.5 * k} fill="url(#lockBody)" />
              {/* left catch-light + right shade rolloff */}
              <Rect x={bodyCx - bodyW / 2 + 4 * k} y={bodyTop + 5 * k} width={5 * k} height={bodyH - 10 * k} rx={2.5 * k} fill="rgba(238,246,253,0.30)" />
              <Rect x={bodyCx + bodyW / 2 - 8 * k} y={bodyTop + 5 * k} width={4 * k} height={bodyH - 10 * k} rx={2 * k} fill="rgba(6,12,20,0.30)" />
              {/* corner screws */}
              {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy], i) => (
                <Circle key={`scr${i}`} cx={bodyCx + sx * (bodyW / 2 - 7 * k)} cy={bodyCy + sy * (bodyH / 2 - 7 * k)} r={1.7} fill="#0c141d" />
              ))}
              {/* keyhole — round eye + tapered slot */}
              <Circle cx={bodyCx} cy={bodyCy + 1} r={5 * k} fill="#070d14" />
              <Path d={`M ${bodyCx - 2.4 * k} ${bodyCy + 1} L ${bodyCx + 2.4 * k} ${bodyCy + 1} L ${bodyCx + 1.3 * k} ${bodyCy + 13 * k} L ${bodyCx - 1.3 * k} ${bodyCy + 13 * k} Z`} fill="#070d14" />
              <Circle cx={bodyCx - 1.4 * k} cy={bodyCy - 0.6} r={1.4} fill="rgba(150,170,190,0.5)" />
            </AG>
          </Svg>

          {/* A steel glint sweeping across the chain — keeps the seal feeling alive. */}
          <View style={styles.glintClip} pointerEvents="none">
            <Animated.View style={[styles.glint, { transform: [{ translateX: glintX }, { rotate: '18deg' }] }]} />
          </View>

          <Text style={[styles.lockLabel, { top: Math.min(bodyTop + bodyH + 14, h - 26), width: w }]}>
            GATE LOCKED · CLEAR TIER I
          </Text>
        </Animated.View>
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
// `celebrate` bumps the token the card hands its children, which replays the maxed
// gold gleam without re-running the card's own rise-in — used when the player walks
// back in from the tree they just cleared.
// ─── Upgraded card plating ────────────────────────────────────────────────────
// The whole card rectangle of an UPGRADED chain, drawn as one machined plate
// instead of a flat CSS border: a face lit from above, a frame stroke that is
// bright along the top-left and falls off toward the bottom-right, an inner
// bevel wall (white arc along the top edge, black arc under the bottom edge)
// and the left accent rail rendered as a rounded metal bar with its own sheen.
// Same light source as the ArrowKey below, so card and button read as one
// object. It measures itself and covers the card's ENTIRE border box — rail and
// all — so nothing is left as a flat line.
function CardPlate({ gold = false, radius = 12, rail = 7 }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const uid = useRef(`cp${Math.random().toString(36).slice(2, 8)}`).current;
  const ink = gold ? '#FFD700' : UP.hot;
  const { w, h } = size;
  const R  = radius - 0.75;
  return (
    <View
      pointerEvents="none"
      style={[styles.cardPlate, { left: -rail, top: -1.5, right: -1.5, bottom: -1.5 }]}
      onLayout={e => {
        const { width, height } = e.nativeEvent.layout;
        if (Math.abs(width - size.w) > 0.5 || Math.abs(height - size.h) > 0.5) {
          setSize({ w: width, h: height });
        }
      }}
    >
      {w > 0 && h > 0 && (
        <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
          <Defs>
            {/* Face: a wash of light off the top edge, dark at the bottom lip. */}
            <LinearGradient id={`${uid}f`} x1="0" y1="0" x2="0.15" y2="1">
              <Stop offset="0"    stopColor={ink}     stopOpacity={gold ? 0.14 : 0.11} />
              <Stop offset="0.42" stopColor={ink}     stopOpacity="0.035" />
              <Stop offset="1"    stopColor="#000000" stopOpacity="0.30" />
            </LinearGradient>
            {/* Frame: lit corner to shaded corner. */}
            <LinearGradient id={`${uid}s`} x1="0" y1="0" x2="0.35" y2="1">
              <Stop offset="0" stopColor={ink} stopOpacity={gold ? 0.95 : 0.85} />
              <Stop offset="1" stopColor={ink} stopOpacity="0.35" />
            </LinearGradient>
            {/* Rail: a rounded bar — hot crest, dark underside. */}
            <LinearGradient id={`${uid}r`} x1="0" y1="0" x2="1" y2="0.35">
              <Stop offset="0"    stopColor="#000000" stopOpacity="0.35" />
              <Stop offset="0.35" stopColor={ink}     stopOpacity="1" />
              <Stop offset="0.75" stopColor={ink}     stopOpacity="0.85" />
              <Stop offset="1"    stopColor="#000000" stopOpacity="0.30" />
            </LinearGradient>
          </Defs>

          {/* Plate body + frame. */}
          <Rect x="0.75" y="0.75" width={w - 1.5} height={h - 1.5} rx={radius}
                fill={`url(#${uid}f)`} stroke={`url(#${uid}s)`} strokeWidth="1.5" />

          {/* Bevel wall, 3px in: bright over the top, black under the bottom. */}
          <Path d={`M3.5 ${radius + 3} Q3.5 3.5 ${radius + 3} 3.5 H${w - radius - 3} Q${w - 3.5} 3.5 ${w - 3.5} ${radius + 3}`}
                fill="none" stroke="#FFFFFF" strokeOpacity="0.16" strokeWidth="1" />
          <Path d={`M3.5 ${h - radius - 3} Q3.5 ${h - 3.5} ${radius + 3} ${h - 3.5} H${w - radius - 3} Q${w - 3.5} ${h - 3.5} ${w - 3.5} ${h - radius - 3}`}
                fill="none" stroke="#000000" strokeOpacity="0.50" strokeWidth="1" />

          {/* Left accent rail, left corners rounded to sit flush in the frame. */}
          <Path d={`M${rail} 0.75 H${0.75 + R} A${R} ${R} 0 0 0 0.75 ${0.75 + R} V${h - 0.75 - R} A${R} ${R} 0 0 0 ${0.75 + R} ${h - 0.75} H${rail} Z`}
                fill={`url(#${uid}r)`} />
          {/* The rail's crest highlight — a hairline of light down its middle. */}
          <Rect x={rail * 0.42} y={radius * 0.7} width="1" height={Math.max(h - radius * 1.4, 0)}
                rx="0.5" fill="#FFFFFF" fillOpacity="0.30" />
          {/* Seam between rail and face: the rail is a separate part, not paint. */}
          <Rect x={rail} y="1.5" width="1" height={h - 3} fill="#000000" fillOpacity="0.45" />
        </Svg>
      )}
    </View>
  );
}

// ─── Upgraded enter-node: the arrow key ───────────────────────────────────────
// The enter affordance of an UPGRADED chain. The plain chain keeps its round
// node + bare chevron; the upgrade gets a machined key cap, drawn in SVG so it
// can carry the things stacked <View>s can't: a lit face that falls off toward
// the bottom, an inner bevel that is bright along the top edge and dark along
// the bottom, and a real arrow with rounded caps. Amber normally, gold once the
// pair is MAXED — the SHAPE is what marks it as upgraded, at every state.
const KEY_W = 68, KEY_H = 32;
function ArrowKey({ gold = false }) {
  // Gradient ids must be unique per mounted key — two cards sharing an id
  // collide on web and the second one renders with the first one's fill.
  const uid = useRef(`ak${Math.random().toString(36).slice(2, 8)}`).current;
  const ink = gold ? '#FFD700' : UP.hot;
  return (
    <View style={[styles.arrowKeyWrap, gold && styles.arrowKeyWrapGold]}>
      <Svg width={KEY_W} height={KEY_H} viewBox={`0 0 ${KEY_W} ${KEY_H}`}>
        <Defs>
          {/* Face: lit from above, falling into shadow at the bottom lip. */}
          <LinearGradient id={`${uid}f`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0"    stopColor={ink} stopOpacity={gold ? 0.30 : 0.26} />
            <Stop offset="0.45" stopColor={ink} stopOpacity={0.11} />
            <Stop offset="1"    stopColor="#000000" stopOpacity="0.34" />
          </LinearGradient>
          {/* Frame: brighter along the top-left, dimmer where the light leaves. */}
          <LinearGradient id={`${uid}s`} x1="0" y1="0" x2="0.4" y2="1">
            <Stop offset="0" stopColor={ink} stopOpacity="0.95" />
            <Stop offset="1" stopColor={ink} stopOpacity="0.45" />
          </LinearGradient>
        </Defs>

        {/* Cap body. */}
        <Rect x="1" y="1" width={KEY_W - 2} height={KEY_H - 2} rx="7"
              fill={`url(#${uid}f)`} stroke={`url(#${uid}s)`} strokeWidth="1.5" />
        {/* Inner bevel — the wall between the frame and the face. Two arcs, not
            one ring: bright on the top edge, dark under the bottom edge. */}
        <Path d="M4.5 11 Q4.5 4.5 11 4.5 H57 Q63.5 4.5 63.5 11"
              fill="none" stroke="#FFFFFF" strokeOpacity="0.22" strokeWidth="1" />
        <Path d="M4.5 21 Q4.5 27.5 11 27.5 H57 Q63.5 27.5 63.5 21"
              fill="none" stroke="#000000" strokeOpacity="0.55" strokeWidth="1" />
        {/* Specular streak across the top third of the face. */}
        <Rect x="9" y="6" width={KEY_W - 18} height="1.5" rx="0.75"
              fill="#FFFFFF" fillOpacity="0.16" />

        {/* The arrow: one shaft, one head, rounded ends. */}
        <Path d={`M20 ${KEY_H / 2} H45`}
              stroke={ink} strokeWidth="2.2" strokeLinecap="round" />
        <Path d={`M39.5 ${KEY_H / 2 - 5.5} L45.5 ${KEY_H / 2} L39.5 ${KEY_H / 2 + 5.5}`}
              fill="none" stroke={ink} strokeWidth="2.4"
              strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

function QuestCard({ onPress, style, children, delay = 0, disabled = false, celebrate = 0 }) {
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
      <CardVizContext.Provider value={shown > 0 ? shown + celebrate : 0}>
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
  // Class movement is COACH-CONTROLLED: only the admin acting as coach (opened
  // with a `studentId` param) may change a player's class, and that Change Class
  // control is also how a prestige is granted — there is no separate prestige
  // action. Everyone else's Skills tab is read-only for class: the gold
  // "PRESTIGE AVAILABLE" banner is a status announcement, not a button.
  const isCoachView = overrideStudentId !== null;
  // Elements the guided tour measures + points its arrow at.
  const tourClassRef    = useTourTarget('skills.class');
  const tourQuestsRef   = useTourTarget('skills.quests');
  const tourPrestigeRef = useTourTarget('skills.prestige');
  // The tour circles just the MAIN QUESTS / side (TIER I) section LABELS.
  const tourMainLabelRef = useTourTarget('skills.mainlabel');
  const tourSideLabelRef = useTourTarget('skills.sidelabel');
  const [profile,     setProfile]     = useState(null);
  const [classData,   setClassData]   = useState(null);
  const [quests,      setQuests]      = useState([]);
  const [completions, setCompletions] = useState(new Set());
  // Base chains this player has UPGRADED (lib/questUpgrades.js). An upgraded
  // chain's card shows the upgrade's name and progress in its place.
  const [upgrades,    setUpgrades]    = useState(new Set());
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
  // Same value as `userId`, readable from the focus effect without making it a
  // dependency (re-running it on every id change would refetch for nothing).
  const userIdRef = useRef(null);
  const [allClasses,  setAllClasses]  = useState([]);
  const [classListOpen, setClassListOpen] = useState(false);
  const [assigning,   setAssigning]   = useState(false);
  // Name of the class just ascended into → shows the full-screen gold ceremony.
  const [ceremony,    setCeremony]    = useState(null);

  // ── Instant progress, no round-trip ─────────────────────────────────────────
  // The tree commits a completion and publishes it (lib/questProgress). This
  // screen is still mounted under it, so waking on that publish means the card
  // has ALREADY re-rendered maxed by the time the back gesture starts — the
  // focus refetch that lands a beat later merely agrees.
  const [, setProgressTick] = useState(0);
  useEffect(() => subscribeQuestProgress(() => setProgressTick(t => t + 1)), []);
  // The chain whose tree was last opened from here + a token that replays that
  // one card's gold gleam on the way back, so the celebration is SEEN on arrival
  // rather than fired off-screen the moment the node was tapped.
  const openedChainRef = useRef(null);
  const [arrivalGleam, setArrivalGleam] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const targetId = overrideStudentId ?? user.id;
      setUserId(targetId);
      userIdRef.current = targetId;

      const [{ data: profileData }, { data: classesData }] = await Promise.all([
        supabase
          .from('profiles')
          .select('full_name, class_id, prestige_count, job')
          .eq('id', targetId)
          .single(),
        supabase
          .from('classes')
          .select('*')
          .order('order_index'),
      ]);

      if (!profileData) return;
      setProfile(profileData);
      // Only the player's OWN job's classes — a job is a self-contained ladder,
      // so the class picker and the per-job class count never mix jobs.
      const job = profileData.job ?? DEFAULT_JOB;
      setAllClasses((classesData ?? []).filter(c => (c.job ?? 'static') === job));

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
      // Lay any just-confirmed toggles from the tree over the fetched rows (and
      // retire the ones this fetch already reflects) — a read that raced the
      // player's own write must never walk a cleared chain back to un-maxed.
      setCompletions(reconcileQuestProgress(
        targetId, new Set((completionsRes.data ?? []).map(c => c.quest_id))));
      setUpgrades(await fetchUpgrades(supabase, targetId, profileData.class_id));
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
    // Came back carrying a change the server hasn't echoed yet → replay the shine
    // on the card that changed, now that it's actually on screen.
    if (openedChainRef.current && hasPendingQuestProgress(userIdRef.current)) {
      setArrivalGleam(n => n + 1);
    }
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

  // ── Guided tour: let it scroll this list ────────────────────────────────────
  // Most quest sections live BELOW the fold, so the tour has to bring a step's
  // element into view before highlighting it — otherwise its arrow points at empty
  // space (the SIDE QUESTS step did exactly that). We hand the tour the scroll
  // container: a measurable box, scrollTo, and the live offset/viewport this screen
  // already tracks for the card reveals.
  const tourScrollRef = useRef(null);
  const tourBoxRef    = useRef(null);
  const tourScroller = useMemo(() => ({
    box: tourBoxRef,
    scrollTo: (y, animated = true) => tourScrollRef.current?.scrollTo({ y, animated }),
    getOffset: () => viewportRef.current.scrollY,
    getViewportH: () => viewportRef.current.viewportH,
  }), []);
  useTourScroller('skills', tourScroller);

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

  // Framed spinner while the preload is still in flight (first load only; later
  // focus refetches are silent so this never shows again).
  if (loading) {
    return (
      <ScreenFrame fill holoEntry={false} maxWidth={SKILLS_CARD_W}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={SL.accent} />
        </View>
        {/* Keep the ceremony alive across the post-prestige reload spinner. */}
        {ceremony && <PrestigeCeremony className={ceremony} onDone={() => setCeremony(null)} />}
      </ScreenFrame>
    );
  }

  // A mirrored requirement (lib/mirrorQuests.js) has no completion row of its
  // own — it counts as done when the quest it mirrors is done. Everything that
  // asks "is this node complete?" uses this set, so the chain counters and the
  // tree can't disagree. LVL is deliberately NOT computed from it: a mirror node
  // pays no LVL (its source already did).
  // Focus refetches are async, so on the way back from a tree the state here is
  // still one round-trip old. The overlay (lib/questProgress) carries the toggles
  // the tree already committed, so a chain the player just cleared renders MAXED
  // OUT on the very first frame instead of flipping gold a beat later.
  const rawDone    = mergeQuestProgress(userId, completions);
  const doneIds    = withMirrorCompletions(quests, rawDone);

  const lvl        = computeLvlFromData(quests, rawDone);
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
    job:          profile?.job ?? DEFAULT_JOB,
    orderIndex:   classData?.order_index ?? 0,
    quests,
    completedIds: doneIds,
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
  // An UPGRADE chain is not a side quest, even though its rows are seeded as one
  // (lib/questUpgrades.js). It only ever appears as the upgraded face of the main
  // chain it belongs to, so it's stripped out of the side list entirely.
  const sideChains = [...new Set(
    quests.filter(q => q.quest_type === 'side').map(q => q.chain).filter(Boolean)
  )].filter(c => !isUpgradeChain(c));

  // Classify side-quest chains by tier (shared rule with lib/prestige): a chain
  // is Tier 2 when any of its quests is gated by a prerequisite in a DIFFERENT
  // chain (the cross-chain gate).
  const tier2Chains     = new Set(tier2SideChains(quests));
  const tier1SideChains = sideChains.filter(c => !tier2Chains.has(c));
  const tier2SideCh     = sideChains.filter(c =>  tier2Chains.has(c));

  // Hidden challenges are filtered out of the counter until the player unlocks
  // them — a chain reading "8/9 unlocked" with nothing visible in the tree would
  // give the secret away (same rule the tree uses: lib/hiddenQuests.js).
  function chainStats(chain, questType) {
    const chainQuests = visibleQuests(quests, doneIds)
      .filter(q => q.chain === chain && q.quest_type === questType);
    const completed   = chainQuests.filter(q => doneIds.has(q.id));
    return {
      total:     chainQuests.length,
      completed: completed.length,
      earnedLvl: completed.reduce((s, q) => s + (q.lvl_reward ?? 0), 0),
    };
  }

  function openTree(chain, questType) {
    openedChainRef.current = chain;
    navigation.navigate('QuestTree', {
      classId:   profile?.class_id,
      chain,
      questType,
      job:       profile?.job ?? DEFAULT_JOB,
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

  const renderChainCard = (baseChain, baseType, locked = false) => {
    // An upgraded chain shows its UPGRADE in the base quest's place: the harder
    // quest's name, its own progress, and a tap that opens its tree. The base
    // version isn't gone — it's one switch away inside the tree.
    let up = upgrades.has(baseChain) ? upgradeFor(baseChain) : null;
    // If the upgrade's rows aren't in this class (a DB that predates them), show
    // the base quest rather than an empty 0/0 card.
    if (up && !quests.some(q => q.chain === up.chain)) up = null;
    const chain     = up?.chain     ?? baseChain;
    const questType = up?.questType ?? baseType;
    const { total, completed, earnedLvl } = chainStats(chain, questType);
    // An upgrade CONTINUES the base quest, it doesn't replace it: the LVL banked
    // clearing the base half is still the player's. The card shows the upgrade's
    // own progress, but the reward counter is the PAIR's total — base + upgrade —
    // so an upgraded chain reads +40 LVL, not the +20 the upgrade alone paid.
    // (Un-upgrading wipes the upgrade half only, and this falls back to the base.)
    const baseLvl   = up ? chainStats(baseChain, baseType).earnedLvl : 0;
    const rewardLvl = earnedLvl + baseLvl;
    const complete = total > 0 && completed === total;
    const pct      = total > 0 ? completed / total : 0;
    const delay    = Math.min(stagger.n++ * 70, 560);
    // An upgraded chain is PLATED: amber frame, amber rail, an UPGRADED plate on
    // the title row. Distinct from the pure-gold MAXED language (shimmer + frame),
    // so the two escalations never read as the same state.
    const upg = !!up && !complete;
    // The structural upgrade mark (the long arrow) stays on even once the pair is
    // MAXED — it just turns gold with the rest of the card. `upg` is only the
    // amber PLATING, which stands down for gold.
    const isUp = !!up;
    return (
      <QuestCard
        key={chain}
        style={[styles.chainCard, upg && styles.chainCardUp, complete && styles.chainCardComplete, locked && styles.chainCardLocked]}
        onPress={locked ? undefined : () => openTree(chain, questType)}
        disabled={locked}
        delay={delay}
        celebrate={openedChainRef.current === chain ? arrivalGleam : 0}
      >
        {/* Upgraded chains are one machined plate — frame, bevel and rail all
            drawn, not CSS lines. Rendered first so the card content sits on it. */}
        {isUp && <CardPlate gold={complete} />}

        <View style={styles.chainCardTop}>
          <View style={styles.chainCardTitleWrap}>
            {complete ? (
              <ShimmerText text={chain.replace(/_/g, ' ').toUpperCase()} style={[styles.chainCardTitle, styles.chainCardTitleMax]} colors={GOLD} direction="ltr" active />
            ) : (
              <Text style={[styles.chainCardTitle, upg && styles.chainCardTitleUp]}>{chain.replace(/_/g, ' ').toUpperCase()}</Text>
            )}
          </View>
          {/* The enter affordance doubles as the UPGRADE mark: a plain chain gets
              the round node + bare chevron, an upgraded one gets the machined
              arrow key (see ArrowKey above) — a different SHAPE, not an icon. */}
          {isUp ? (
            <ArrowKey gold={complete} />
          ) : (
            <View style={[styles.chainArrow, complete && styles.chainArrowComplete]}>
              <View pointerEvents="none" style={[styles.chainArrowBezel, complete && styles.chainArrowBezelComplete]} />
              <View pointerEvents="none" style={styles.chainArrowGloss} />
              <View style={[styles.chainArrowHead, complete && styles.chainArrowHeadComplete]} />
            </View>
          )}
        </View>

        <View style={[styles.chainProgressTrack, upg && styles.chainProgressTrackUp, complete && styles.chainProgressTrackMax]}>
          {complete ? (
            <ShimmerFill style={styles.chainProgressFill} colors={GOLD} active />
          ) : (
            <View style={[styles.chainProgressFill, upg && styles.chainProgressFillUp, { width: `${pct * 100}%` }]}>
              {/* Bright leading edge on the amber rail — the bar looks charged
                  rather than merely filled. */}
              {upg && pct > 0 && <View style={styles.chainProgressCap} />}
            </View>
          )}
        </View>

        <View style={styles.chainCardMetaRow}>
          <Text style={[styles.chainCardMeta, upg && styles.chainCardMetaUp, complete && styles.chainCardMetaMax]}>
            {complete ? 'MAXED OUT' : `${completed}/${total} unlocked`}
          </Text>
          <Text style={[styles.chainCardReward, upg && styles.chainCardRewardUp, complete && styles.chainCardRewardMax]}>+{rewardLvl} LVL</Text>
        </View>

        {/* Cleared chains come alive in gold: a frame that sweeps clockwise plus a
            one-shot gleam that streaks across on entrance — the "maxed out" shine. */}
        {complete && (
          <>
            <ShimmerFrame style={styles.chainFrame} colors={GOLD} active radius={12} thickness={2} />
            <GateGleam radius={12} />
          </>
        )}

        {/* Upgraded cards get the same entrance streak, dialled well down and in
            amber — a glint off the plating, not the maxed-out fanfare. */}
        {upg && <GateGleam radius={12} color={UP.hot} peak={0.16} />}
      </QuestCard>
    );
  };

  // Each tier is its own stacked, full-width section (replaces the cramped
  // 3-column grid that clipped long names like "HANDSTAND"). Empty tiers hide.
  // `tier` renders a SUBORDINATE header (smaller/muted) — used for TIER I / TIER II
  // nested under the top-level SIDE QUESTS label.
  const renderSection = (label, chains, questType, locked = false, headerRef, tier = false) => {
    if (!chains.length) return null;
    return (
      <View style={[styles.questSection, tier && styles.tierSection]} key={label}>
        <View style={tier ? styles.tierHeaderRow : styles.sectionHeaderRow}>
          {/* Wrap the label so the tour highlight hugs JUST the text (not the row). */}
          <View ref={headerRef}>
            <Text style={[
              tier ? styles.tierHeader : styles.sectionHeader,
              locked && (tier ? styles.tierHeaderLocked : styles.sectionHeaderLocked),
            ]}>{label}</Text>
          </View>
          <View style={tier ? styles.tierHeaderLine : styles.sectionHeaderLine} />
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
    <ScreenFrame fill holoEntry={false} maxWidth={SKILLS_CARD_W}>
    <View ref={tourBoxRef} collapsable={false} style={styles.scrollBox}>
    <ScrollView
      ref={tourScrollRef}
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
            with the prestige stars perched on top of the gem (no separate line).
            The tour's "Your Class" target is a STABLE wrapper (always mounted, not
            born inside the conditional IIFE) so measureInWindow resolves reliably —
            when the ref lived on the IIFE-returned View it sometimes read stale and
            the highlight fell back to a stray circle over LVL. */}
        <View ref={tourClassRef} collapsable={false} style={styles.classCrestAnchor}>
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
        </View>

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
          <View ref={tourPrestigeRef} style={styles.prestigeBanner}>
            <View style={styles.prestigeBannerTitleWrap}>
              <ShimmerText
                text="PRESTIGE AVAILABLE"
                style={styles.prestigeBannerTitle}
                colors={GOLD}
                direction="ltr"
                active
              />
            </View>
          </View>
        ) : (
          <View ref={tourPrestigeRef} style={styles.reqCard}>
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

        {/* Change class — COACH-ONLY. A player's own class is assigned/changed by
            their coach (admin), so this control appears only in admin-as-coach view. */}
        {isCoachView && (
        <View style={styles.classCol}>
          <TouchableOpacity
            ref={tourClassRef}
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
        )}
      </View>

      {/* Full-width class picker — opens directly under the CHANGE CLASS button. */}
      {isCoachView && classListOpen && (
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
      <View ref={tourQuestsRef}>
        {!classData ? (
          <View style={styles.noClass}>
            <Text style={styles.noClassText}>NO CLASS ASSIGNED YET</Text>
            <Text style={styles.noClassSub}>
              {isCoachView
                ? 'Tap ASSIGN CLASS above to begin their journey.'
                : 'Your coach will assign your class to begin your journey.'}
            </Text>
          </View>
        ) : (
          <View style={styles.questSections}>
            {renderSection('MAIN QUESTS', mainChains, 'main', false, tourMainLabelRef)}
            {(tier1SideChains.length > 0 || tier2SideCh.length > 0) && (
              <View style={styles.questSection}>
                {/* Top-level SIDE QUESTS label (same style as MAIN QUESTS) with the
                    tiers nested beneath it in a subordinate style. */}
                <View style={styles.sectionHeaderRow}>
                  <View ref={tourSideLabelRef}>
                    <Text style={styles.sectionHeader}>SIDE QUESTS</Text>
                  </View>
                  <View style={styles.sectionHeaderLine} />
                </View>
                {/* TIER I / TIER II sub-headers only earn their place when there
                    IS a Tier II. With a single tier they're noise — the chains
                    sit directly under SIDE QUESTS instead. */}
                {tier2SideCh.length > 0 ? (
                  <View style={styles.sideTiers}>
                    {renderSection('TIER I', tier1SideChains, 'side', false, undefined, true)}
                    {renderSection('TIER II', tier2SideCh, 'side', tier2Locked, undefined, true)}
                  </View>
                ) : (
                  <View style={{ position: 'relative', gap: 10 }}>
                    {tier1SideChains.map(chain => renderChainCard(chain, 'side'))}
                  </View>
                )}
              </View>
            )}
          </View>
        )}
      </View>

      <View style={{ height: 10 }} />
      </View>

      {/* ── Prestige ceremony — the class-up rite ── */}
      {ceremony && <PrestigeCeremony className={ceremony} onDone={() => setCeremony(null)} />}
    </ScrollView>
    </View>
    </ScreenFrame>
    </ScrollVizContext.Provider>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // The scroll lives INSIDE the shared ScreenFrame (fill mode) now — the frame
  // supplies the animated ice-glow border + glow, matching Home/Workouts. This
  // scrolls within the fixed frame so all the quest sections stay reachable.
  scrollBox: { flex: 1, width: '100%' },
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
  // Stable tour anchor around the crest — stretches full width and centers its
  // child, so it measures the crest's real box (no layout change vs the crest alone).
  classCrestAnchor: {
    alignSelf: 'center',
    alignItems: 'center',
  },
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
  prestigeBannerTitleWrap: {
    alignItems: 'center',
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

  // ── Nested tier sub-headers (TIER I / TIER II under SIDE QUESTS) ──────────────
  // Subordinate to the section header: smaller, muted, slightly indented.
  sideTiers: { gap: 16, marginTop: 6 },
  tierSection: { gap: 10, marginLeft: 14 },
  tierHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 2,
  },
  tierHeader: {
    fontFamily: F.heading,
    fontSize: 15,
    color: SL.muted,
    letterSpacing: 2.5,
  },
  tierHeaderLocked: {
    color: '#8aa6bf',
    opacity: 0.7,
  },
  tierHeaderLine: {
    flex: 1,
    height: 1,
    borderRadius: 1,
    backgroundColor: SL.muted,
    opacity: 0.18,
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
    // Left accent rail — the shared card language across the app (Workouts day
    // cards, exercise cards). It carries the STATE colour: ice = standard quest,
    // amber = upgraded, gold = maxed out.
    borderLeftWidth: 7,
    borderLeftColor: SL.accent,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingLeft: 13,
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
    borderLeftColor: SL.gold,
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

  // ── Tier II lock overlay (sagging chain + padlock seal, drawn in SVG) ──────────
  // Dark wash over the sealed cards, so the seal reads as the foreground.
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
  chainCardTitleWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // ── UPGRADED chain plating ────────────────────────────────────────────────
  // Amber frame + faint warm wash + a wider, warmer glow than the base card.
  chainCardUp: {
    borderColor: UP.dim,
    borderLeftColor: UP.hot,
    backgroundColor: UP.wash,
    shadowColor: UP.hot,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
  },
  chainCardTitle: {
    fontFamily: F.heading,
    fontSize: 30,
    color: SL.text,
    letterSpacing: 2,
  },
  // Upgraded title: warm ink with a soft amber halo. Static — the moving shimmer
  // stays reserved for MAXED, so the two never collide.
  chainCardTitleUp: {
    color: UP.text,
    textShadowColor: 'rgba(255,196,107,0.45)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
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
  // ── Base node hardware detail ─────────────────────────────────────────────
  // A second, tighter outline inside the frame: two concentric lines read as a
  // machined bezel instead of a single flat stroke.
  chainArrowBezel: {
    position: 'absolute',
    top: 3, left: 3, right: 3, bottom: 3,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(74,158,191,0.30)',
  },
  chainArrowBezelComplete: {
    borderColor: 'rgba(255,215,0,0.35)',
  },
  // Light catching the top of the cap. Same trick, same offsets, on every node.
  chainArrowGloss: {
    position: 'absolute',
    top: 4,
    width: 13,
    height: 1,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },

  // Sits over the card's whole border box (negative insets set inline from the
  // rail width), under every child that follows it.
  cardPlate: {
    position: 'absolute',
  },
  // ── UPGRADED enter-node: the arrow key ────────────────────────────────────
  // The SVG carries the cap itself; the wrap only supplies the glow the cards
  // use everywhere else (SVG can't cast a React Native shadow).
  arrowKeyWrap: {
    borderRadius: 8,
    shadowColor: UP.hot,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.75,
    shadowRadius: 12,
  },
  arrowKeyWrapGold: {
    shadowColor: SL.gold,
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
  // Upgraded rail: taller, warm bed, so an empty 0/3 bar still reads as premium
  // hardware rather than a dead grey line.
  chainProgressTrackUp: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,196,107,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(255,196,107,0.28)',
  },
  chainProgressFillUp: {
    borderRadius: 4,
    backgroundColor: UP.hot,
  },
  // Bright leading edge riding the end of the amber fill.
  chainProgressCap: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderRadius: 2,
    backgroundColor: '#FFF3D6',
    shadowColor: UP.hot,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 6,
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
  // Progress text warms up a shade on plated cards so it isn't the one cold
  // element left on an otherwise amber card.
  chainCardMetaUp: {
    color: '#9a7c52',
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
  chainCardRewardUp: {
    color: UP.hot,
    textShadowColor: 'rgba(255,196,107,0.55)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
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

});
