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

  // Emergency / "deviation" accents — the system-failing palette.
  alarmRed:     '#FF2A3C',  // bright alert red
  bordeaux:     '#8B1538',  // deep wine — the dread/no-hope wash
  glitchCyan:   '#5AC8FA',  // hot cyan for datamosh streaks
  glitchMagenta:'#FF2BD6',  // RGB-split magenta
  glitchGreen:  '#2BFF88',  // corrupted-channel green
};
