import { Platform } from 'react-native';

// Procedural SFX via the Web Audio API — no assets, no deps.
//  • VOID DRONE: a deep black-hole hum that sits under the login screen forever
//    (clearly ambient — a continuous tone, never confused with a deviation).
//  • DEVIATION: a quick, sharp "system corruption" zap. It is ONLY ever fired
//    from inside the same call that triggers the visual deviation, so the audio
//    is 1:1 with what you see and never runs on its own.
// Web only; native is a no-op. Browser audio needs a user gesture, so it stays
// silent until the player first clicks/types.

let ctx = null;
function getCtx() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noiseBuffer(c, dur) {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// Long reverb (decaying-noise impulse) → the vast void space.
let reverb = null;
function getReverb(c) {
  if (!reverb) {
    const dur = 3.0, len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    reverb = c.createConvolver();
    reverb.buffer = buf;
    const rg = c.createGain();
    rg.gain.value = 0.5;
    reverb.connect(rg).connect(c.destination);
  }
  return reverb;
}

// ── Black-hole void drone (pure tones, no noise bed) ─────────────────────────
let voidNode = null;
export function startVoid() {
  const c = getCtx(); if (!c || voidNode) return;
  const now = c.currentTime;
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, now);
  out.gain.linearRampToValueAtTime(0.28, now + 3.0); // slow gravitational swell
  out.connect(c.destination);
  const rev = getReverb(c);

  // Deep detuned sine cluster — the gravitational hum of the void.
  const oscs = [32.7, 33.4, 49, 65.4].map((f, i) => {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = c.createGain();
    g.gain.value = i === 3 ? 0.05 : 0.1;
    o.connect(g).connect(out);
    g.connect(rev);
    o.start(now);
    return o;
  });

  // Very slow vibrato on one voice → subtle swirling / event-horizon drift.
  const lfo = c.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.045;
  const lfoG = c.createGain();
  lfoG.gain.value = 3.0;
  lfo.connect(lfoG).connect(oscs[2].frequency);
  lfo.start(now);

  voidNode = { out, nodes: [...oscs, lfo] };
}

export function stopVoid() {
  if (!ctx || !voidNode) return;
  const now = ctx.currentTime;
  const { out, nodes } = voidNode;
  voidNode = null;
  out.gain.cancelScheduledValues(now);
  out.gain.setValueAtTime(out.gain.value, now);
  out.gain.linearRampToValueAtTime(0.0001, now + 0.6);
  nodes.forEach((n) => { try { n.stop(now + 0.7); } catch (e) {} });
}

// ── Deviation = an old-TV channel switch ─────────────────────────────────────
// The "ka-chunk → SHHHT" of an analog set flipping channels: a low mechanical
// thunk, a quick burst of broadband snow/static that flickers, then it cuts to
// the next channel. Short. Always fired the instant a deviation hits, so it
// never plays on its own.
export function playDeviation(intensity = 1) {
  const c = getCtx(); if (!c) return;
  const now = c.currentTime;
  const dur = 0.20 + Math.random() * 0.06; // ~0.20–0.26s

  // 1) Mechanical "thunk" — the channel knob/relay clicking over.
  const click = c.createBufferSource();
  click.buffer = noiseBuffer(c, 0.03);
  const clp = c.createBiquadFilter();
  clp.type = 'lowpass';
  clp.frequency.value = 350;       // dull, low = a physical clunk
  const cg = c.createGain();
  cg.gain.setValueAtTime(0.22 * intensity, now);
  cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
  click.connect(clp).connect(cg).connect(c.destination);
  click.start(now); click.stop(now + 0.05);

  // 2) Snow/static burst — bright broadband hiss, flickering like channel snow.
  const snowStart = now + 0.03;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1400;       // airy TV "snow" hiss
  const g = c.createGain();
  // rapid on/off flicker = the unstable static between channels
  g.gain.setValueAtTime(0.0001, snowStart);
  let t = snowStart, on = true;
  while (t < now + dur) {
    g.gain.setValueAtTime(on ? 0.16 * intensity : 0.03 * intensity, t);
    on = !on;
    t += 0.012 + Math.random() * 0.02;
  }
  g.gain.setValueAtTime(0.0001, now + dur);
  src.connect(hp).connect(g).connect(c.destination);
  src.start(snowStart); src.stop(now + dur + 0.02);

  // 3) Tiny high "lock" blip — the new channel snapping in at the end.
  const o = c.createOscillator();
  o.type = 'sine';
  const ot = now + dur - 0.02;
  o.frequency.setValueAtTime(1500, ot);
  const og = c.createGain();
  og.gain.setValueAtTime(0.0001, ot);
  og.gain.exponentialRampToValueAtTime(0.06 * intensity, ot + 0.004);
  og.gain.exponentialRampToValueAtTime(0.0001, ot + 0.05);
  o.connect(og).connect(c.destination);
  o.start(ot); o.stop(ot + 0.06);
}

// ── Hologram boot-up (screen materializing) ──────────────────────────────────
// A rising filtered sweep + airy shimmer as the hologram powers on, capped by a
// soft high "lock" chime as it stabilizes. Reverb gives it the holographic air.
export function playHologram(intensity = 1) {
  const c = getCtx(); if (!c) return;
  const now = c.currentTime;
  const rev = getReverb(c);
  const dur = 0.7;

  // rising power-up sweep
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(170, now);
  o.frequency.exponentialRampToValueAtTime(920, now + dur);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(380, now);
  bp.frequency.exponentialRampToValueAtTime(2300, now + dur);
  bp.Q.value = 2;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.08 * intensity, now + 0.1);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  o.connect(bp).connect(g).connect(c.destination);
  g.connect(rev);
  o.start(now); o.stop(now + dur + 0.05);

  // airy shimmer rising alongside
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(1200, now);
  hp.frequency.exponentialRampToValueAtTime(5200, now + dur);
  const sg = c.createGain();
  sg.gain.setValueAtTime(0.0001, now);
  sg.gain.linearRampToValueAtTime(0.05 * intensity, now + dur * 0.7);
  sg.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(hp).connect(sg).connect(c.destination);
  src.start(now); src.stop(now + dur);

  // soft high "lock" chime as it stabilizes
  const o2 = c.createOscillator();
  o2.type = 'sine';
  const t2 = now + dur - 0.05;
  o2.frequency.value = 1320;
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.0001, t2);
  g2.gain.exponentialRampToValueAtTime(0.08 * intensity, t2 + 0.01);
  g2.gain.exponentialRampToValueAtTime(0.0001, t2 + 0.32);
  o2.connect(g2).connect(c.destination);
  g2.connect(rev);
  o2.start(t2); o2.stop(t2 + 0.36);
}

// ── Login intro = the screen COLLAPSING into pixels ──────────────────────────
// A big, exciting break-down: a powering-down descending tone, a swelling
// shatter of static, a scatter of "pixel break" ticks across the fall, and a
// final low BOOM as it caves in. ~1.2s — matched to the pixel-collapse visual.
export function playCollapse(intensity = 1) {
  const c = getCtx(); if (!c) return;
  const now = c.currentTime;
  const dur = 1.2;
  const rev = getReverb(c);

  // 1) Powering-down descending tone — the system falling.
  const down = c.createOscillator();
  down.type = 'sawtooth';
  down.frequency.setValueAtTime(240, now);
  down.frequency.exponentialRampToValueAtTime(32, now + dur);
  const dg = c.createGain();
  dg.gain.setValueAtTime(0.0001, now);
  dg.gain.exponentialRampToValueAtTime(0.12 * intensity, now + 0.05);
  dg.gain.exponentialRampToValueAtTime(0.02 * intensity, now + dur * 0.85);
  dg.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  const dlp = c.createBiquadFilter();
  dlp.type = 'lowpass';
  dlp.frequency.setValueAtTime(2400, now);
  dlp.frequency.exponentialRampToValueAtTime(300, now + dur); // darkens as it falls
  down.connect(dlp).connect(dg).connect(c.destination);
  dg.connect(rev);
  down.start(now); down.stop(now + dur + 0.05);

  // 2) Swelling shatter of static — the pixels tearing loose.
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur);
  const sbp = c.createBiquadFilter();
  sbp.type = 'bandpass';
  sbp.frequency.setValueAtTime(3000, now);
  sbp.frequency.exponentialRampToValueAtTime(600, now + dur);
  sbp.Q.value = 0.7;
  const sg = c.createGain();
  sg.gain.setValueAtTime(0.02, now);
  sg.gain.linearRampToValueAtTime(0.16 * intensity, now + dur * 0.6);
  sg.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(sbp).connect(sg).connect(c.destination);
  src.start(now); src.stop(now + dur);

  // 3) Scattered "pixel break" ticks across the collapse.
  for (let i = 0; i < 26; i++) {
    const t = now + Math.random() * dur * 0.92;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = 220 + Math.random() * 1400;
    const g = c.createGain();
    g.gain.setValueAtTime(0.05 * intensity, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + 0.035);
  }

  // 4) Final low BOOM — it caves in.
  const bt = now + dur * 0.82;
  const boom = c.createBufferSource();
  boom.buffer = noiseBuffer(c, 0.5);
  const blp = c.createBiquadFilter();
  blp.type = 'lowpass';
  blp.frequency.value = 180;
  const bg = c.createGain();
  bg.gain.setValueAtTime(0.0001, bt);
  bg.gain.exponentialRampToValueAtTime(0.6 * intensity, bt + 0.02);
  bg.gain.exponentialRampToValueAtTime(0.0001, bt + 0.55);
  boom.connect(blp).connect(bg).connect(c.destination);
  bg.connect(rev);
  boom.start(bt); boom.stop(bt + 0.6);
}
