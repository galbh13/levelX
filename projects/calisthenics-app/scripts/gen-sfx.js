#!/usr/bin/env node
// ─── THE SYSTEM's sound kit ─────────────────────────────────────────────────
// Builds every UI sound the app plays into assets/sfx (bundled, for the phone)
// and public/sfx (served, for the web) — one render, both homes:
//
//     node scripts/gen-sfx.js
//
// It mixes two ingredients, and WHICH one goes where is the whole point:
//
//   • RECORDED (assets/sfx-src/*.wav, all CC0 — see that folder's LICENSE.md)
//     for anything that has to sound like the physical world. A whoosh is
//     recorded air; synthesized noise can copy its shape but never its grain,
//     which is why the first synth pass read as "static sweeping past" instead
//     of someone blowing air.
//
//   • SYNTHESIZED, below, for anything meant to sound like a machine: the
//     charge ladder's bells and the lock chime. The system IS electronic, so
//     here synthesis is the right answer and not a compromise — and only a
//     synth can be re-rendered at four different lengths on demand.
//
// Everything is 16-bit mono 44.1k. Keep the files SHORT: every player
// downloads them on the next OTA update.

const fs = require('fs');
const path = require('path');

const SR = 44100;
const SRC     = path.join(__dirname, '..', 'assets', 'sfx-src');
const OUT     = path.join(__dirname, '..', 'assets', 'sfx');
const OUT_WEB = path.join(__dirname, '..', 'public', 'sfx');

// ── tiny DSP kit ────────────────────────────────────────────────────────────
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const alloc = sec => new Float64Array(Math.floor(SR * sec));

// Schroeder reverb — four combs into two allpasses. The cold air the rest of
// the app already lives in (the intro, the hologram chime).
function reverb(buf, mix, decay) {
  const combs = [1557, 1617, 1491, 1422].map(n => ({ d: new Float64Array(n), i: 0, g: decay }));
  const aps   = [225, 556].map(n => ({ d: new Float64Array(n), i: 0, g: 0.5 }));
  const out = new Float64Array(buf.length);
  for (let n = 0; n < buf.length; n++) {
    let w = 0;
    for (const c of combs) { const v = c.d[c.i]; w += v; c.d[c.i] = buf[n] + v * c.g; c.i = (c.i + 1) % c.d.length; }
    w /= combs.length;
    for (const a of aps) { const v = a.d[a.i]; const y = -w + v; a.d[a.i] = w + v * a.g; a.i = (a.i + 1) % a.d.length; w = y; }
    out[n] = buf[n] * (1 - mix) + w * mix;
  }
  return out;
}

// Peak-normalize, soft-clip, fade the edges so nothing clicks.
function finish(buf, peak) {
  let max = 0;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
  const g = max > 0 ? peak / max : 0;
  const fade = Math.floor(SR * 0.004);
  for (let i = 0; i < buf.length; i++) {
    let v = Math.tanh(buf[i] * g * 1.15);
    if (i < fade) v *= i / fade;
    if (i > buf.length - fade) v *= (buf.length - i) / fade;
    buf[i] = v;
  }
  return buf;
}

// ── WAV in / WAV out ────────────────────────────────────────────────────────
function readWav(name) {
  const b = fs.readFileSync(path.join(SRC, name));
  let o = 12, data = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4);
    const sz = b.readUInt32LE(o + 4);
    if (id === 'data') { data = { off: o + 8, sz: Math.min(sz, b.length - o - 8) }; break; }
    o += 8 + sz + (sz % 2);
  }
  const n = Math.floor(data.sz / 2);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(data.off + i * 2) / 32768;
  return x;
}

function writeWav(name, buf) {
  const data = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) data.writeInt16LE(Math.round(clamp(buf[i], -1, 1) * 32767), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  const wav = Buffer.concat([head, data]);
  fs.writeFileSync(path.join(OUT, name), wav);
  fs.writeFileSync(path.join(OUT_WEB, name), wav);
  console.log(name + '  ' + (wav.length / 1024).toFixed(0) + ' KB  ' + (buf.length / SR).toFixed(2) + 's');
}

// Mix `src` into `dst` at `atSec`, at `gain`, resampled by `rate` (2 = an octave
// up and half as long), linear interpolation. `fadeIn` is in seconds.
function mixIn(dst, src, atSec, gain = 1, rate = 1, fadeIn = 0) {
  const at = Math.floor(atSec * SR);
  const fadeN = Math.floor(fadeIn * SR);
  const n = Math.floor(src.length / rate);
  for (let i = 0; i < n; i++) {
    const d = at + i;
    if (d < 0 || d >= dst.length) continue;
    const p = i * rate, i0 = Math.floor(p), f = p - i0;
    const s = (src[i0] || 0) * (1 - f) + (src[i0 + 1] || 0) * f;
    dst[d] += s * gain * (fadeN && i < fadeN ? i / fadeN : 1);
  }
}

// ── 1. SWISH — moving between the pages of the system ───────────────────────
// A recorded whoosh, near enough untouched: real moving air, ~0.35s, normalized
// and given a breath of room so it shares a space with the rest of the kit.
// lib/sfx.js pitches it a hair up or down depending on the direction travelled.
function swish() {
  const src = readWav('whoosh-air.wav');
  const buf = alloc(src.length / SR + 0.2);
  mixIn(buf, src, 0, 1);
  writeWav('swoosh.wav', finish(reverb(buf, 0.12, 0.55), 0.6));
}

// ── 2. GATE — entering workout mode ─────────────────────────────────────────
// A sword leaving its sheath. One field recording, played as recorded: the
// metal, the speed of the draw and the room it was recorded in are all in the
// take, so there is nothing to add and nothing to layer under it. It is not
// even reverbed — that tail is the real room.
//
// This is the fourth thing to sit here (a war horn, a cinematic buildup, a
// countdown of digital blips) and the first that isn't built. Everything
// before it was assembled out of parts, and every one of them announced
// itself as designed. Source: freesound.org/s/581594, CC0.
function gate() {
  const sword = readWav('gate-sword.wav');
  const buf = alloc(sword.length / SR + 0.12);
  mixIn(buf, sword, 0, 1);
  writeWav('gate.wav', finish(buf, 0.72));
}

// ── 3. CHARGE — the level bar filling ───────────────────────────────────────
// One sound in four lengths, and it is a COUNTER: the tally of points landing
// one at a time — tack-tack-tack — the way experience stacks up in a game.
// Each tack is a real 20ms recorded tick, and they arrive FASTER and a little
// HIGHER as the count goes on, which is what makes a pile of identical clicks
// read as accumulation instead of a machine gun. Over the top, a few soft bells
// climb a pentatonic scale as milestones, and one chime lands as the bar
// arrives.
//
// More to fill = more ticks over a longer climb, ending higher. `rise` is
// exactly the seconds the bar's animation runs for — CHARGE_STEPS in lib/sfx.js
// is the other half of the pair, so the chime lands on the frame the fill does.
function charge(name, rise) {
  const buf = alloc(rise + 0.3);   // just enough room for the last tick to ring out
  const tick = readWav('tick.wav');

  // The count. ~20 a second on average, but spaced on a curve that tightens
  // toward the end, so the tally visibly speeds up as it fills. Pitch climbs
  // with it (resampling the same tick 1.0 → 1.4× — the counting-up trick), and
  // so does level, from half to full.
  const ticks = Math.max(4, Math.round(rise * 20));
  for (let k = 0; k < ticks; k++) {
    const q = k / (ticks - 1);
    mixIn(buf, tick, rise * Math.pow(q, 0.78), 0.5 + 0.45 * q, 1 + 0.4 * q);
  }

  // No tones over the count. There were soft bells climbing a scale on top of
  // the ticks, and they split the sound in two: a mechanical tally underneath
  // and a digital melody over it. The tally is the part that reads as points
  // stacking up, so it is now the whole sound.
  // NO chime on the end. There was one — the count landing on its top note —
  // and it announced the arrival so plainly that it became the thing you heard
  // instead of the tally. The count simply runs out now: the last tick IS the
  // end, the same way a score counter just stops.
  // Only a touch of room: ticks have to stay dry, or the tally smears.
  writeWav(name, finish(reverb(buf, 0.12, 0.55), 0.6));
}

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(OUT_WEB, { recursive: true });
swish();
gate();
// rise (s) — the tick count follows from it. These are mirrored by CHARGE_STEPS
// in lib/sfx.js, which times the bar's own animation, so the tally runs exactly
// as long as the fill — keep the two in step.
charge('charge-1.wav', 0.45);
charge('charge-2.wav', 0.78);
charge('charge-3.wav', 1.10);
charge('charge-4.wav', 1.46);
