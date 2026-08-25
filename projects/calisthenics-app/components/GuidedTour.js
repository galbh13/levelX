import { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, Animated, Easing,
} from 'react-native';
import Svg, { Circle, Rect, Path } from 'react-native-svg';
import { C } from '../constants/colors';
import { F } from '../constants/fonts';
import PillButton from './PillButton';
import { measureTourTarget, revealTourTarget, scrollTourTop } from '../lib/tourTargets';

// ── Guided Tour ──────────────────────────────────────────────────────────────
// A first-launch walkthrough that ACCOMPANIES the player through the app. It
// drives the tab navigation itself (Home → Skills → Workouts → Personal →
// Check-Up → back to Home) and per step:
//   • SCROLLS the element into view first (screens register their scroll list via
//     useTourScroller), so a step never highlights something off-screen,
//   • MEASURES the real element (tagged via useTourTarget) and boxes/circles it
//     with a breathing highlight — exact, not a guessed fraction,
//   • parks the caption in DEAD SPACE (the half away from the target) — and only
//     REVEALS it once the element is measured, so the card never lands in one
//     place and hop to another a beat later, and
//   • draws a connector ARROW from the caption straight to the element.
//
// If a step's element isn't registered/measurable, it falls back to the step's
// { x, y } fraction so it still shows something sensible.
//
// Coordinate note: the app applies a web `zoom` / native scale transform, so the
// overlay is measured in its OWN box (onLayout, layout px) for drawing, and the
// element↔overlay offset is taken in fractions (measureInWindow, visual px) so the
// transform cancels. Never size this from useWindowDimensions.
//
// Shown once (gated in AsyncStorage — see lib/onboarding); the HOW IT WORKS
// button on HomeScreen replays it. On-brand: dark navy, ice-glow, Exo2/Cinzel,
// symbol glyphs, NEVER emojis (design rule).

const TONES = {
  ice:   C.iceGlow,   // #4A9EBF
  gold:  '#FFD700',
  red:   '#E11D48',
  jade:  '#1FD79A',
  green: '#4CAF50',
};

// `targetName` = a tagged element to measure (preferred). `target` = a fallback
// { x, y (fractions), r } if that element isn't registered. One idea per `line`.
// `caption` optionally FORCES where the caption parks: 'center' | 'top' | 'bottom'
// (default = auto, i.e. the dead space opposite the highlighted element).
// `scrollTop` resets that screen's registered list to the top first.
// `targetNames` lists ALTERNATIVES, best first — the first one actually present
// wins (e.g. the coach's feedback card, else the status line where it will appear).
// A step with a `targetName` but NO `target` fraction is OPTIONAL: if the element
// isn't there (e.g. coach feedback that hasn't arrived yet) the step simply shows
// its caption with no mark — better than an arrow aimed at empty space.
const STEPS = [
  // ── WELCOME (Home) ── first thing the player reads → dead-center, clear.
  { phase: 'WELCOME', tone: 'ice', tab: 'Home', caption: 'center',
    title: 'Welcome to the System',
    line: "Congratulations you took responsibility for yourself and entered the System. Not an easy decision. Good. In this tutorial you'll understand everything there is to know and how to operate." },

  // ── YOUR HOME ──
  { phase: 'YOUR HOME', tone: 'ice', tab: 'Home', caption: 'center',
    title: 'This is Home',
    line: 'Home shows what you need to do TODAY. You start here every day.' },
  // Level sits dead-center → park the caption up top (never over the level, never
  // at the bottom) and let the arrow reach down to it.
  { phase: 'YOUR HOME', tone: 'ice', tab: 'Home', caption: 'top',
    targetName: 'home.level', target: { x: 0.5, y: 0.46, r: 62 },
    title: 'Your Level',
    line: 'This level reflects your progress in a specific class. Each class has a different max level, depending on how many quests it has.' },
  { phase: 'YOUR HOME', tone: 'ice', tab: 'Home',
    targetName: 'home.missions', target: { x: 0.5, y: 0.64, r: 58 },
    title: "Today's Missions",
    line: "All your workouts for today are here, waiting just for you. No reason to skip — everything is accessible." },
  // Highlight ONE mission row (not the whole panel) — the point is "tap a single
  // mission". Falls back to the missions panel on a rest day (no rows to measure).
  { phase: 'YOUR HOME', tone: 'ice', tab: 'Home',
    targetName: 'home.mission1', target: { x: 0.5, y: 0.64, r: 58 },
    title: 'Start a Workout',
    line: 'Tap a mission and a red gate opens. Step through it to start. Never been easier.' },

  // ── SKILLS ──
  { phase: 'SKILLS', tone: 'ice', tab: 'Skills', caption: 'center',
    title: 'This is Skills',
    line: "Here you can see the whole process you're going to overcome, with a detailed explanation of everything you need to know. You're not some robot who follows blindly — you understand and apply your critical thinking to your decisions. (I'm your coach, not a babysitter.)" },
  { phase: 'SKILLS', tone: 'ice', tab: 'Skills',
    targetName: 'skills.class', target: { x: 0.5, y: 0.16, r: 52 },
    title: 'Your Class',
    line: 'Every class has its own unique quests. By accomplishing the requirements in your class, you become eligible to prestige into the next class — a higher difficulty level with advanced elements to master.' },
  // Quests split into two: MAIN quests, then SIDE quests (each circles its label).
  { phase: 'SKILLS', tone: 'ice', tab: 'Skills',
    targetName: 'skills.mainlabel', target: { x: 0.5, y: 0.62, r: 50 },
    title: 'Main Quests',
    line: 'These are your MAIN quests — your core path. Tap one to open its tree, then check off a skill you can already do. Each one raises your LEVEL.' },
  { phase: 'SKILLS', tone: 'ice', tab: 'Skills',
    targetName: 'skills.sidelabel', target: { x: 0.5, y: 0.72, r: 50 },
    title: 'Side Quests',
    line: 'SIDE quests are extra skills, grouped into tiers. Clear them to grow further, vary your workouts and skill set — and earn LVL points too.' },
  { phase: 'SKILLS', tone: 'gold', tab: 'Skills', captionGap: 152,
    targetName: 'skills.prestige', target: { x: 0.5, y: 0.5, r: 52 },
    title: 'Prestige (Rank Up)',
    line: 'Fulfil the requirements to unlock PRESTIGE — then your coach ranks you up to the next class.' },

  // ── WORKOUTS ── (ice/blue like the rest — was gold)
  { phase: 'WORKOUTS', tone: 'ice', tab: 'Workouts', caption: 'center',
    title: 'Workouts',
    line: 'Your guide for the week. Get your mind organized on what you need to do, and modify your life accordingly.' },
  // Targets sit in the UPPER area (week strip / the two tiles), so park the caption
  // in the lower dead space but lifted off the bottom wall so it "fits".
  { phase: 'WORKOUTS', tone: 'ice', tab: 'Workouts', captionGap: 180,
    targetName: 'workouts.week', target: { x: 0.5, y: 0.56, r: 54 },
    title: 'Your Week',
    line: 'Every day of the week is here. Tap a day to see the workouts on it.' },
  { phase: 'WORKOUTS', tone: 'ice', tab: 'Workouts', caption: 'bottom', captionGap: 180,
    targetName: 'workouts.editday', target: { x: 0.75, y: 0.54, r: 46 },
    title: 'Edit a Day',
    line: "Life happened? Can't train today? Well, you're the lucky one — just move workouts from one day to another to navigate through life and still achieve your calisthenics goals like a killer." },
  { phase: 'WORKOUTS', tone: 'ice', tab: 'Workouts', captionGap: 180,
    targetName: 'workouts.myworkouts', target: { x: 0.72, y: 0.36, r: 50 },
    title: 'My Workouts',
    line: 'Here you have your workouts list. Before attempting a new workout, look inside and explore — make sure you understand everything and have all the equipment available.' },
  { phase: 'WORKOUTS', tone: 'ice', tab: 'Workouts', captionGap: 180, bow: 'left',
    targetName: 'workouts.daily', target: { x: 0.28, y: 0.36, r: 50 },
    title: 'Daily Quests',
    line: 'Tap DAILY QUESTS to set small habits you check off every single day.' },

  // ── PERSONAL ──
  { phase: 'PERSONAL', tone: 'ice', tab: 'Personal', caption: 'center',
    title: 'Personal',
    line: 'Your own corner of the app — a direct line to your coach, and whatever the System has in store for you.' },
  { phase: 'PERSONAL', tone: 'jade', tab: 'Personal', bow: 'left',
    targetName: 'personal.coach', target: { x: 0.5, y: 0.28, r: 50 },
    title: 'Message Your Coach',
    line: 'This is where you can contact your coach. Use it — this is to your advantage.' },

  // ── CHECK-UP ──
  // Opens at the TOP of the form, then the SUBMIT step scrolls the player down
  // through it — the form is long, so the tour has to travel it.
  { phase: 'CHECK-UP', tone: 'green', tab: 'Checkup', caption: 'center', scrollTop: 'checkup',
    title: 'This is Check-Up',
    line: 'Once a week your coach checks how you are doing.' },
  // A player who has ALREADY submitted sees the read-only view — no form, no SUBMIT
  // button. So these two name alternatives / carry no fraction fallback: they point
  // at the submitted answers instead, and the SEND IT step simply shows no mark
  // rather than an arrow into empty space.
  { phase: 'CHECK-UP', tone: 'green', tab: 'Checkup',
    targetNames: ['checkup.form', 'checkup.answers'],
    title: 'Fill It In',
    line: 'Answer a few questions and film a couple of exercises.' },
  { phase: 'CHECK-UP', tone: 'green', tab: 'Checkup',
    targetName: 'checkup.submit',
    title: 'Send It',
    line: 'Everything answered and filmed? Press SUBMIT CHECK-UP and it goes to your coach.' },
  // NO target on purpose. The feedback card doesn't exist yet for a new player, and
  // they'll be told about it by the notification when it lands — so this step just
  // explains it from the top of the card rather than aiming an arrow at nothing.
  { phase: 'CHECK-UP', tone: 'green', tab: 'Checkup', scrollTop: 'checkup', caption: 'center',
    title: 'Get Feedback',
    line: 'Your coach sends back a feedback video (a URL) — open it to see their notes right next to your own clip. It gets detailed.' },

  // ── READY (Home) ──
  { phase: 'READY', tone: 'ice', tab: 'Home', caption: 'center',
    title: "You're Ready",
    line: "That's it for the quick tour — you now know what's where. Dig deeper into each section on your own; I'll add short tutorials for the details (each quest, how Workout Mode works, and more). For now, go level up.",
    final: true },
];

// How long the reveal scroll gets to settle before the highlight is measured.
// Short on purpose — the measure poll keeps tracking the element while the smooth
// scroll finishes, so this only has to cover the first frames.
const REVEAL_SETTLE_MS = 240;
const POLL_MS = 100;          // measure cadence — tight, each tick is two measures
const FADE_OUT_MS = 90;
const FADE_IN_MS  = 140;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const AC = Animated.createAnimatedComponent(Circle);
const AP = Animated.createAnimatedComponent(Path);

// L-shaped corner marks around a box — the app's "system" targeting-reticle look
// (a HUD lock-on) instead of a plain outline.
function cornerBrackets(x, y, w, h) {
  const L = Math.max(14, Math.min(28, Math.min(w, h) * 0.30));
  return [
    `M${x} ${y + L} L${x} ${y} L${x + L} ${y}`,
    `M${x + w - L} ${y} L${x + w} ${y} L${x + w} ${y + L}`,
    `M${x + w} ${y + h - L} L${x + w} ${y + h} L${x + w - L} ${y + h}`,
    `M${x + L} ${y + h} L${x} ${y + h} L${x} ${y + h - L}`,
  ];
}

// First of `names` that actually measures → { ...box, name }, else null. Lets a
// step name a preferred element plus a stand-in for when it isn't there yet.
async function measureFirst(names) {
  for (const n of names) {
    const m = await measureTourTarget(n);
    if (m) return { ...m, name: n };
  }
  return null;
}

// measureInWindow → Promise (null on failure).
function measureNode(node) {
  return new Promise((resolve) => {
    if (!node || typeof node.measureInWindow !== 'function') { resolve(null); return; }
    try { node.measureInWindow((x, y, w, h) => resolve({ x, y, w, h })); }
    catch { resolve(null); }
  });
}

export default function GuidedTour({ visible, onClose, onNavigate }) {
  const [box, setBox] = useState({ w: 0, h: 0 });   // overlay size, layout px (SVG space)
  const [capH, setCapH] = useState(0);              // measured caption height
  const [spot, setSpot] = useState(null);           // measured element, fractions of overlay
  const [fellBack, setFellBack] = useState(false);  // measuring failed → use fraction circle
  const [i, setI] = useState(0);
  const [measuredSize, setMeasuredSize] = useState(null); // real {i,fw,fh} even when off-screen
  const [probed, setProbed] = useState(null);       // {i} — this step's target isn't here
  const overlayRef = useRef(null);
  const fade  = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const lastTab = useRef(null);

  // Reset on (re)open.
  useEffect(() => {
    if (visible) { setI(0); setSpot(null); setFellBack(false); fade.setValue(1); lastTab.current = null; }
  }, [visible]);

  // Breathing highlight.
  useEffect(() => {
    if (!visible) return;
    pulse.setValue(0);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [visible]);

  const step = STEPS[i];

  // Navigate to this step's tab when it changes.
  useEffect(() => {
    if (!visible) return;
    if (step.tab && step.tab !== lastTab.current) {
      lastTab.current = step.tab;
      onNavigate?.(step.tab);
    }
  }, [visible, i]);

  // Measure the real element for this step and box it. Re-runs when the step OR the
  // overlay size (box) changes, so it always has a valid overlay size to divide by —
  // reading `box` STATE directly (the approach that worked); box.w/box.h are in the
  // deps so a first-open layout that lands after this effect still triggers a re-run.
  useEffect(() => {
    if (!visible) return;
    setSpot(null);
    setFellBack(false);
    setMeasuredSize(null);
    setProbed(null);
    // Ask the step's screen to start from the top BEFORE anything else — this runs
    // even for a caption-only step (which returns just below).
    if (step.scrollTop) scrollTourTop(step.scrollTop);
    if (!(box.w > 0)) return;                 // overlay not measured yet — re-runs when it is
    const names = step.targetNames || (step.targetName ? [step.targetName] : []);
    if (!names.length) { if (step.target) setFellBack(true); return; }
    let cancelled = false, ticks = 0, sinceLock = 0, locked = false;
    let id = null;
    const stop = () => { if (id) { clearInterval(id); id = null; } };
    // SELF-HEALING poll. Each tick re-measures; the MOMENT we get a valid reading we
    // show the real box (and clear any fallback). If a grace period passes with no
    // valid reading we show the fraction circle as a placeholder — but we KEEP
    // polling, so the instant the element becomes measurable the real box REPLACES
    // the circle. Stops once the box has held steady a few ticks, or after a cap.
    const tick = async () => {
      if (cancelled) return;
      let ok = false;
      // Both measurements in parallel — sequential awaits cost an extra frame
      // on every tick, which is dead time the player feels between steps.
      const [ov, tg] = await Promise.all([
        measureNode(overlayRef.current),
        measureFirst(names),
      ]);
      if (cancelled) return;
      if (ov && tg && ov.w > 0 && ov.h > 0 && (tg.w > 0 || tg.h > 0)) {
        const fx = (tg.x - ov.x) / ov.w, fy = (tg.y - ov.y) / ov.h;
        const fw = tg.w / ov.w, fh = tg.h / ov.h;
        // Remember the element's real SIZE even if its POSITION reads off-screen —
        // on far tabs the pager reports the element off-screen, but its size is
        // valid, so the fallback can draw a correctly-sized BOX (not a circle).
        setMeasuredSize({ i, fw, fh });
        // Accept anything not WAY off-screen (a tab mid-slide reads far out).
        if (!(fy < -0.35 || fy > 1.35 || fx < -0.35 || fx > 1.35)) {
          // Tag the spot with the step it belongs to, so a lingering spot from the
          // PREVIOUS step (state clears a frame late) is ignored on render.
          setSpot({ i, fx, fy, fw, fh });
          setFellBack(false);
          ok = true; locked = true;
        }
      }
      ticks += 1;
      if (ok) {
        sinceLock += 1;
        if (sinceLock >= 5) stop();           // box held steady → settled, stop polling
      } else {
        sinceLock = 0;
        // Only after a short grace period, and only while we have no box, drop to the
        // placeholder circle — polling continues so it upgrades itself.
        if (!locked && ticks >= 8 && step.target) setFellBack(true);
        // No fraction fallback and still nothing after a few reads → the element
        // genuinely isn't on this screen in its current state (e.g. the SUBMIT
        // button when the check-up is already sent). Say so, so the caption can
        // show now instead of waiting out the safety cap. Polling continues, so a
        // late-mounting element still gets its highlight.
        if (!locked && ticks >= 4 && !step.target) setProbed({ i });
        if (ticks >= 60) stop();              // hard cap (~6s) — give up re-reading
      }
    };
    // FIRST bring the element on screen. The screen it lives on may still be
    // sliding in (or its list not laid out yet), so retry a few times until the
    // element is measurable, then let the smooth scroll settle before we start
    // measuring — otherwise we'd lock the highlight onto a mid-flight position.
    (async () => {
      // Let a top-jump land (its scroll event updates the screen's tracked offset)
      // before we do any reveal math off that offset.
      if (step.scrollTop) await wait(60);
      // Only a screen that HAS a scroller can make us wait ('wait' = registered but
      // not laid out yet). Everywhere else this returns 'none' on the first call and
      // we measure immediately — no dead time between steps.
      const revealOnce = async () => {
        const m = await measureFirst(names);
        return revealTourTarget(m?.name || names[0]);
      };
      let outcome = await revealOnce();
      for (let a = 0; a < 3 && !cancelled && outcome === 'wait'; a += 1) {
        await wait(70);
        outcome = await revealOnce();
      }
      if (cancelled) return;
      if (outcome === 'scrolled') await wait(REVEAL_SETTLE_MS);
      if (cancelled) return;
      tick();                                 // first attempt, now that it's in view
      id = setInterval(tick, POLL_MS);
    })();
    return () => { cancelled = true; stop(); };
  }, [visible, i, box.w, box.h]);

  // ── Reveal the step only once it has RESOLVED ───────────────────────────────
  // The caption is parked RELATIVE to the target, so its position isn't final
  // until the element is measured (and, for an off-screen one, scrolled into
  // view). Fading in before that made the card land in one place and hop to
  // another half a second later — the YOUR WEEK step did exactly that. So the
  // fade-IN lives here, gated on resolution; a hard cap guarantees the card can
  // never sit dark if a step never resolves.
  // A step whose caption placement is FORCED and that has no fallback fraction
  // doesn't depend on the measurement at all — don't make it wait for one.
  const resolved = !(step.targetName || step.targetNames) || (spot && spot.i === i) || fellBack
    || (probed && probed.i === i) || (!!step.caption && !step.target);
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      Animated.timing(fade, {
        toValue: 1, duration: FADE_IN_MS, easing: Easing.out(Easing.quad), useNativeDriver: false,
      }).start();
    }, resolved ? 30 : 700);    // 30ms = one layout pass, so capH is current too
    return () => clearTimeout(t);
  }, [visible, i, resolved]);

  if (!visible) return null;

  const tone = TONES[step.tone] ?? C.iceGlow;
  const isFirst = i === 0;
  const isLast = i === STEPS.length - 1;
  const total = STEPS.length;

  // ── Build the highlight mark (layout px) ──
  // While the element is still being measured we draw NOTHING (mark stays null) —
  // no guessed circle flashes before the real box shape. `anchorCy` still tracks
  // where the target roughly is (from the fraction) so the caption is already on
  // the correct side and doesn't jump when the box resolves.
  // Only trust a spot measured for THIS step (a stale one from the previous step
  // lingers for a frame because state clears in an effect, not synchronously).
  const curSpot = spot && spot.i === i ? spot : null;
  let mark = null;
  let anchorCy = null;
  if (box.w > 0) {
    if (curSpot) {
      // Hug the element. A small, CAPPED inset — a fraction of the element size,
      // capped low — so a near-full-width element (e.g. the week strip) no longer
      // spills its highlight past the card's side walls, while tiny elements still
      // get a little breathing room. (A flat 12px overhung wide elements.)
      const ew = curSpot.fw * box.w, eh = curSpot.fh * box.h;
      const padX = Math.max(3, Math.min(8, ew * 0.03));
      const padY = Math.max(3, Math.min(8, eh * 0.14));
      const w = ew + padX * 2;
      const h = eh + padY * 2;
      const x = curSpot.fx * box.w - padX;
      const y = curSpot.fy * box.h - padY;
      mark = { type: 'rect', x, y, w, h, rx: 14, cx: x + w / 2, cy: y + h / 2, rad: Math.max(w, h) / 2 };
      anchorCy = mark.cy;
    } else if (fellBack && step.target) {
      const cx = step.target.x * box.w, cy = step.target.y * box.h;
      const ms = measuredSize && measuredSize.i === i ? measuredSize : null;
      if (ms) {
        // We know the element's real size (measured off-screen) — draw a properly
        // sized BOX at the step's location instead of a generic circle.
        const PAD = 6;
        const w = ms.fw * box.w + PAD * 2, h = ms.fh * box.h + PAD * 2;
        const x = cx - w / 2, y = cy - h / 2;
        mark = { type: 'rect', x, y, w, h, rx: 14, cx, cy, rad: Math.max(w, h) / 2 };
      } else {
        mark = { type: 'circle', cx, cy, rad: step.target.r ?? 48 };
      }
      anchorCy = cy;
    } else if (step.target) {
      anchorCy = step.target.y * box.h;   // measuring — position the caption, draw nothing yet
    }
  }

  // ── Park the caption ──
  // A step may FORCE its position (`caption`); otherwise it lands in the dead space
  // opposite the highlighted element (target up top → caption bottom, and vice
  // versa; no target → bottom).
  const capW = box.w > 0 ? Math.min(box.w - 32, 640) : 640;
  const capX = box.w > 0 ? (box.w - capW) / 2 : 16;
  const autoPlacement = (anchorCy == null || anchorCy < box.h * 0.5) ? 'bottom' : 'top';
  const placement = step.caption || autoPlacement;   // 'center' | 'top' | 'bottom'
  const capY =
    placement === 'center' ? Math.max(84, (box.h - capH) / 2)
    : placement === 'top'  ? 84
    // bottom: sit above the ~88px tab bar; a step can lift itself further off the
    // wall via `captionGap` (default 104).
    : /* bottom */           Math.max(96, box.h - capH - (step.captionGap ?? 104));

  // ── Connector arrow: caption edge → mark ──
  let arrow = null;
  if (mark && capH > 0) {
    const startX = capX + capW / 2;
    // Exit whichever caption edge faces the mark (bottom edge if the caption sits
    // above it, top edge if below) so the connector always leaves toward the target.
    const startY = (capY + capH / 2) < mark.cy ? capY + capH : capY;
    const dx = mark.cx - startX, dy = mark.cy - startY;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    // Distance from the mark's center to its border along the arrow direction, so
    // the arrowhead lands ON the edge (a circle uses its radius; a rect uses its
    // real side — max/2 would overshoot a wide/short box).
    let edge;
    if (mark.type === 'rect') {
      const hw = mark.w / 2, hh = mark.h / 2;
      edge = Math.min(hw / (Math.abs(ux) || 1e-6), hh / (Math.abs(uy) || 1e-6));
    } else {
      edge = mark.rad;
    }
    const endX = mark.cx - ux * (edge + 3);
    const endY = mark.cy - uy * (edge + 3);
    const mx = (startX + endX) / 2, my = (startY + endY) / 2;
    // Perpendicular for the bow. A step can flip which SIDE it bows to via
    // `bow: 'left'` (default bows the other way).
    const bowSign = step.bow === 'left' ? -1 : 1;
    const px = -uy * bowSign, py = ux * bowSign;
    // Bow scales with length; the cap only bites on LONG arrows — raise it so long
    // arrows bow more, while short arrows (below the cap) stay exactly as they were.
    const curve = Math.min(150, len * 0.30);
    const ctrlX = mx + px * curve, ctrlY = my + py * curve;
    const d = `M${startX} ${startY} Q${ctrlX} ${ctrlY} ${endX} ${endY}`;
    // Chevron head — drawn with the SAME stroke as the shaft (not a filled
    // triangle), and aimed along the curve's END TANGENT so it flows out of the
    // line as one continuous arrow instead of a separate shape stuck on top.
    let tgx = endX - ctrlX, tgy = endY - ctrlY;
    const tl = Math.hypot(tgx, tgy) || 1; tgx /= tl; tgy /= tl;
    const BARB = 15, a = 0.46;                           // barb length / spread (~26°)
    const cos = Math.cos(a), sin = Math.sin(a);
    const bx = -tgx, by = -tgy;                          // back along the tangent
    const h1x = endX + (bx * cos - by * sin) * BARB, h1y = endY + (bx * sin + by * cos) * BARB;
    const h2x = endX + (bx * cos + by * sin) * BARB, h2y = endY + (-bx * sin + by * cos) * BARB;
    const head = `M${h1x} ${h1y} L${endX} ${endY} L${h2x} ${h2y}`;
    arrow = { d, head, sx: startX, sy: startY };
  }

  const glowO = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const glowW = pulse.interpolate({ inputRange: [0, 1], outputRange: [2, 4] });

  const go = (next) => {
    if (next < 0 || next > total - 1) return;
    // Fade OUT only. The fade back IN is owned by the reveal effect above, which
    // waits until this step's element is measured — so the card appears already in
    // its final spot instead of landing and then hopping.
    Animated.timing(fade, { toValue: 0, duration: FADE_OUT_MS, easing: Easing.in(Easing.quad), useNativeDriver: false })
      .start(() => setI(next));
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View
        ref={overlayRef}
        style={styles.dim}
        onLayout={e => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        {/* Highlight + connector arrow */}
        {mark && (
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} pointerEvents="none">
            <Svg width={box.w} height={box.h} style={StyleSheet.absoluteFill}>
              {mark.type === 'rect' ? (
                <>
                  {/* lit interior + faint full frame */}
                  <Rect x={mark.x} y={mark.y} width={mark.w} height={mark.h} rx={mark.rx} fill={tone} fillOpacity={0.06} />
                  <Rect x={mark.x} y={mark.y} width={mark.w} height={mark.h} rx={mark.rx}
                        stroke={tone} strokeOpacity={0.20} strokeWidth={1.5} fill="none" />
                  {/* breathing system corner brackets (lock-on) */}
                  {cornerBrackets(mark.x, mark.y, mark.w, mark.h).map((d, idx) => (
                    <AP key={idx} d={d} stroke={tone} strokeOpacity={glowO} strokeWidth={glowW}
                        fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  ))}
                </>
              ) : (
                <>
                  <Circle cx={mark.cx} cy={mark.cy} r={mark.rad} fill={tone} fillOpacity={0.06} />
                  <AC cx={mark.cx} cy={mark.cy} r={mark.rad} stroke={tone} strokeOpacity={glowO} strokeWidth={glowW} fill="none" />
                </>
              )}
              {arrow && (
                <>
                  {/* soft glow underlay (shaft + head as one) */}
                  <Path d={arrow.d} stroke={tone} strokeOpacity={0.22} strokeWidth={9}
                        fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  <Path d={arrow.head} stroke={tone} strokeOpacity={0.22} strokeWidth={9}
                        fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  {/* crisp arrow — shaft and chevron share the SAME stroke, so it
                      reads as one continuous shape */}
                  <Path d={arrow.d} stroke={tone} strokeWidth={3.5}
                        fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  <Path d={arrow.head} stroke={tone} strokeWidth={3.5}
                        fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  {/* origin node on the caption edge — reads as a system connector */}
                  <Circle cx={arrow.sx} cy={arrow.sy} r={7.5} stroke={tone} strokeOpacity={0.4} strokeWidth={1.5} fill="none" />
                  <Circle cx={arrow.sx} cy={arrow.sy} r={4} fill={tone} />
                </>
              )}
            </Svg>
          </Animated.View>
        )}

        {/* Caption, parked in dead space */}
        {box.w > 0 && (
          <Animated.View
            style={[styles.card, { left: capX, top: capY, width: capW, borderColor: tone, shadowColor: tone, opacity: fade }]}
            onLayout={e => setCapH(e.nativeEvent.layout.height)}
          >
            <View style={styles.topRow}>
              <View style={styles.topRight}>
                <Text style={styles.counter}>{i + 1} / {total}</Text>
                {!isLast && (
                  <TouchableOpacity onPress={onClose} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 10, right: 6 }}>
                    <Text style={styles.skip}>SKIP</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${((i + 1) / total) * 100}%`, backgroundColor: tone, shadowColor: tone }]} />
            </View>

            <View>
              <Text style={[styles.title, { color: C.text, textShadowColor: tone }]}>{step.title}</Text>
              <Text style={styles.line}>{step.line}</Text>
            </View>

            <View style={styles.footer}>
              <View style={styles.footerSide}>
                {!isFirst && (
                  <PillButton label="BACK" tone="muted" variant="outline" size="sm" onPress={() => go(i - 1)} />
                )}
              </View>
              <View style={styles.footerSide}>
                {isLast ? (
                  <PillButton label="START TRAINING" tone="accent" variant="solid" size="sm" onPress={onClose} />
                ) : (
                  <PillButton label="NEXT" tone="accent" variant="solid" size="sm" onPress={() => go(i + 1)} />
                )}
              </View>
            </View>
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: {
    flex: 1,
    backgroundColor: 'rgba(3,6,14,0.55)',
  },
  card: {
    position: 'absolute',
    maxWidth: 640,
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1.5,
    paddingHorizontal: 28,
    paddingTop: 18,
    paddingBottom: 22,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 20,
    elevation: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  phase: { fontFamily: F.heading, fontSize: 12, letterSpacing: 3 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  counter: { fontFamily: F.heading, fontSize: 12, letterSpacing: 1, color: C.textMuted },
  skip: { fontFamily: F.heading, fontSize: 12, letterSpacing: 2, color: C.textMuted },

  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: C.lockedBorder,
    overflow: 'hidden',
    marginBottom: 14,
  },
  progressFill: {
    height: 3,
    borderRadius: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },

  // System-panel headline: clean Exo2 caps with an ice glow (matches the app's
  // ScreenHeader titles), not the Cinzel serif — reads sharper + more "system".
  title: {
    fontFamily: F.heading,
    fontSize: 25,
    letterSpacing: 2,
    textTransform: 'uppercase',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
    marginBottom: 11,
  },
  // Info text: Exo2 SemiBold, brighter + a touch of tracking for legibility.
  line: {
    fontFamily: F.body,
    fontSize: 21,
    lineHeight: 31,
    letterSpacing: 0.3,
    color: '#D3E6F5',
    marginBottom: 20,
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerSide: { minWidth: 72, flexShrink: 1 },
});
