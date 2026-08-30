import { Platform } from 'react-native';

// Procedural UI SFX via the Web Audio API — no assets, no deps.
//  • HOLOGRAM: the boot-up chime played by <HoloBuild> as a card materializes.
// Web only; native is a no-op. Browser audio needs a user gesture, so it stays
// silent until the player first clicks/types.
//
// This file used to also hold the login screen's glitch kit (void drone,
// deviation zap, collapse crash). The login glitches are gone, and so are they.

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
