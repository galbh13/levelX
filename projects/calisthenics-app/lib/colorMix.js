// Small colour helpers, shared by anything that has to build a family of shades
// out of ONE hex it was handed at runtime — a workout's type colour, say, which
// isn't known until the row renders and so can't live in constants/colors.js.
// Non-hex input (a named colour, an rgba string) is returned untouched rather
// than throwing: a bad colour must never take a screen down.

const parse = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  return m ? parseInt(m[1], 16) : null;
};
const toHex = (r, g, b) =>
  `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;

// Mixed toward white — the "bright" sibling of a colour.
export const lighten = (hex, amt = 0.45) => {
  const n = parse(hex);
  if (n === null) return hex;
  const f = (c) => Math.round(c + (255 - c) * amt);
  return toHex(f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255));
};

// Mixed toward black — the "deep" sibling.
export const darken = (hex, amt = 0.45) => {
  const n = parse(hex);
  if (n === null) return hex;
  const f = (c) => Math.round(c * (1 - amt));
  return toHex(f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255));
};

// The same colour as an `rgba()` string, for translucent fills and shadows.
export const rgba = (hex, a) => {
  const n = parse(hex);
  if (n === null) return hex;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

// A Shimmer palette built from one colour: deep → base → bright → base. Shimmer
// repeats the first stop at the end, so the cycle closes on itself with no jump,
// and the whole ramp stays inside a single hue — a travelling light in the
// colour the caller already owns, not a rainbow.
export const glowRamp = (hex) => [darken(hex, 0.55), hex, lighten(hex, 0.55), hex];
