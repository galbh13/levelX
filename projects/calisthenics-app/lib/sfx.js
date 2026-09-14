import { Platform } from 'react-native';

// ─── THE SYSTEM's sound kit ─────────────────────────────────────────────────
// One API, two engines, because the app is two apps:
//
//   • WEB  — the WAV is fetched once, decoded into an AudioBuffer and fired
//            through an AudioContext. Zero latency, and a buffer source can be
//            re-triggered while the previous one is still ringing (which is
//            what a fast tab swipe does).
//   • APK  — expo-video's headless player. It is ALREADY in the binary (the
//            title sequence uses it), so the whole kit ships over `eas update`
//            with no new native module and no new build. One player per sound,
//            created once and rewound on each play.
//
// Rules this file lives by:
//   1. Sound must NEVER break a flow. Every call is fire-and-forget, every
//      failure is swallowed, and an engine that won't start just goes quiet.
//   2. Browsers block audio until the player has interacted with the page, so
//      the context is created lazily and resumed on every play — the first
//      swipe (a gesture) is what unlocks it.
//   3. Nothing here is awaited by the UI.
//
// The WAVs are built, not shipped in by hand: `node scripts/gen-sfx.js`
// assembles all six from CC0 source recordings plus synthesis (see that script
// and assets/sfx-src/LICENSE.md). Re-run it after touching either.

// Native reads the BUNDLED asset (require → expo-video). Web can't: react-native-web
// has no resolveAssetSource, so a require() there is an opaque module id with no
// URL behind it. The same WAVs are therefore also emitted into public/sfx, which
// expo export copies to the web build's root — hence the two tables. Both are
// written by scripts/gen-sfx.js in one pass, so they can never drift.
const KEYS = ['swoosh', 'gate', 'charge1', 'charge2', 'charge3', 'charge4'];

// Behind a switch rather than a top-level table so the web build never touches
// the bundled-asset path at all.
function nativeSource(key) {
  switch (key) {
    case 'swoosh':  return require('../assets/sfx/swoosh.wav');
    case 'gate':    return require('../assets/sfx/gate.wav');
    case 'charge1': return require('../assets/sfx/charge-1.wav');
    case 'charge2': return require('../assets/sfx/charge-2.wav');
    case 'charge3': return require('../assets/sfx/charge-3.wav');
    case 'charge4': return require('../assets/sfx/charge-4.wav');
    default: return null;
  }
}

const WEB_URLS = {
  swoosh:  '/sfx/swoosh.wav',
  gate:    '/sfx/gate.wav',
  charge1: '/sfx/charge-1.wav',
  charge2: '/sfx/charge-2.wav',
  charge3: '/sfx/charge-3.wav',
  charge4: '/sfx/charge-4.wav',
};

// Per-sound trim, so the kit sits at one level. The swoosh fires dozens of times
// a session and must stay under the UI; the gate is an event and is allowed to be.
const VOLUME = {
  swoosh: 0.4, gate: 0.55,
  charge1: 0.45, charge2: 0.45, charge3: 0.45, charge4: 0.45,
};

let muted = false;
export function setSfxMuted(v) { muted = !!v; }
export function isSfxMuted() { return muted; }

const isWeb = Platform.OS === 'web';

// ── web engine ──────────────────────────────────────────────────────────────
let ctx = null;
const buffers = {};   // key → AudioBuffer (decoded once, kept)

function webCtx() {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

async function webLoad(key) {
  const c = webCtx(); if (!c || buffers[key]) return;
  try {
    const uri = WEB_URLS[key];
    if (!uri) return;
    const res = await fetch(uri);
    const raw = await res.arrayBuffer();
    buffers[key] = await c.decodeAudioData(raw);
  } catch {}
}

function webPlay(key, { rate = 1, volume = 1 } = {}) {
  const c = webCtx(); if (!c) return;
  const buf = buffers[key];
  if (!buf) { webLoad(key); return; }          // first call warms it; the next one sounds
  try {
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = (VOLUME[key] ?? 0.6) * volume;
    src.connect(g).connect(c.destination);
    src.start();
  } catch {}
}

// ── native engine ───────────────────────────────────────────────────────────
// expo-video is imported lazily: on web the module is dead weight, and a failed
// import must not take the bundle down with it.
let players = null;   // key → VideoPlayer, or null until primed
function nativePlayers() {
  if (players) return players;
  try {
    const { createVideoPlayer } = require('expo-video');
    players = {};
    for (const key of KEYS) {
      try {
        const p = createVideoPlayer(nativeSource(key));
        p.volume = VOLUME[key] ?? 0.6;
        p.loop = false;
        // Never duck or stop the player's own music — this is UI garnish.
        try { p.audioMixingMode = 'mixWithOthers'; } catch {}
        players[key] = p;
      } catch {}
    }
  } catch { players = {}; }
  return players;
}

function nativePlay(key, { rate = 1, volume = 1 } = {}) {
  try {
    const p = nativePlayers()[key];
    if (!p) return;
    p.volume = (VOLUME[key] ?? 0.6) * volume;
    try { p.playbackRate = rate; } catch {}
    p.currentTime = 0;      // rewind: the same player is re-fired every time
    p.play();
  } catch {}
}

function play(key, opts) {
  if (muted) return;
  if (isWeb) webPlay(key, opts); else nativePlay(key, opts);
}

// Warm the kit so the FIRST sound isn't the one that gets swallowed. Safe to
// call more than once; safe to call before any user gesture.
export function primeSfx() {
  try {
    if (isWeb) KEYS.forEach(webLoad);
    else nativePlayers();
  } catch {}
}

// ── the kit ─────────────────────────────────────────────────────────────────

// Moving between the pages of the system. `dir` (-1 back / +1 forward) tilts the
// pitch a hair so the two directions don't read as the same click — going
// forward is brighter, going back is lower.
export function playSwoosh(dir = 1) {
  play('swoosh', { rate: dir >= 0 ? 1.06 : 0.94 });
}

// Opening the gate into a live session.
export function playGate() { play('gate'); }

// The level bar charging — a tally of ticks stacking up, one per point.
// `frac` is how much of the track fills (0…1): little to fill, a short count;
// nearly full, a long one that speeds up and locks on a higher note.
// CHARGE_STEPS is the single source of truth for BOTH — `ms` is what the bar's
// own animation should run for, so the lock chime lands exactly as the fill
// arrives (see HomeScreen's level bar and SkillsScreen's LevelGauge).
export const CHARGE_STEPS = [
  { upTo: 0.25, key: 'charge1', ms: 450 },
  { upTo: 0.50, key: 'charge2', ms: 780 },
  { upTo: 0.75, key: 'charge3', ms: 1100 },
  { upTo: 1.01, key: 'charge4', ms: 1460 },
];

function chargeStep(frac) {
  const f = Math.max(0, Math.min(1, Number(frac) || 0));
  return CHARGE_STEPS.find(s => f < s.upTo) ?? CHARGE_STEPS[CHARGE_STEPS.length - 1];
}

// How long the bar should take to fill for this much charge.
export function chargeMs(frac) { return chargeStep(frac).ms; }

export function playCharge(frac) { play(chargeStep(frac).key); }
