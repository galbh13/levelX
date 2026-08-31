export const C = {
  bg:           '#050912',
  surface:      '#07111F',
  deepBlue:     '#4A9EBF',  // neon cyan accent (was #5B8EFF blue-purple)
  iceGlow:      '#4A9EBF',
  lockedBg:     '#0a1a2e',
  lockedBorder: '#1a3050',
  text:         '#E8F4FF',
  textMuted:    '#2a4a6a',
  cardBorder:   '#0a2040',
  navBg:        '#040810',
  // The intro clip's own background, sampled from its edges (RGB 5,9,17 at every
  // corner, every frame — the "Intro 2" master matches `bg` almost exactly; the
  // first cut was #000005 and left a visible seam). The title sequence is
  // letterboxed with THIS so the bars are indistinguishable from the video on any
  // aspect ratio. Re-sample if the clip is ever re-exported.
  introBg:      '#050911',
  lvlBadgeBg:   '#0a2a4a',
  nodeLine:     '#4A9EBF',  // neon cyan accent (was #5B8EFF blue-purple)
  nodeLineLock: '#1a3050',

  // A "common mistake" callout on the exercise card. Softer than `alarmRed`,
  // which means the system itself is failing — this one means "careful", not
  // "stop", so it must never be the emergency red.
  mistake:      '#FF8A9B',

  // Emergency / "deviation" accents — the system-failing palette.
  alarmRed:     '#FF2A3C',  // bright alert red
  bordeaux:     '#8B1538',  // deep wine — the dread/no-hope wash
  glitchCyan:   '#5AC8FA',  // hot cyan for datamosh streaks
  glitchMagenta:'#FF2BD6',  // RGB-split magenta
  glitchGreen:  '#2BFF88',  // corrupted-channel green
};

// Variation tints for the exercise card — the coaching cues and the description
// legend that names them. Deliberately OFF `iceGlow`: every label, rail and
// header on that card is already the accent, so a variation painted in it reads
// as chrome instead of as a code. Close neighbours by design — they say "these
// belong together", never "this one is more important".
export const CUE_TINTS = [
  { chip: '#6FCFE8', bg: 'rgba(111,207,232,0.15)', text: '#EAF9FF' },  // glacier
  { chip: '#CDEFFA', bg: 'rgba(205,239,250,0.13)', text: '#F6FDFF' },  // white ice
  { chip: '#9DB8F0', bg: 'rgba(157,184,240,0.14)', text: '#EDF1FF' },  // frost blue
];
