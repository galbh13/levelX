// The third rule of the description language (after "goal - …" and "note - …"):
// a line that STARTS with an asterisk is a KIT REQUIREMENT.
//
//   *weights required        →  REQUIRED · WEIGHTS
//   *bands                   →  REQUIRED · RESISTANCE BAND
//   *pull up bar + rings     →  REQUIRED · PULL-UP BAR · RINGS
//
// The coach writes the short-hand; this file fills in the rest — the word
// REQUIRED, the canonical name of the kit, and the "or use…" line where the
// item is really a category. Anything not in the lexicon still becomes a chip
// under its own name, so the asterisk works for kit nobody has named yet.

// Only at the head of a line, and only WITHOUT a space after it — "* item" with
// a space is already a bullet in the exercise-description parser, and that
// meaning is older than this one.
export const GEAR_LINE = /^\*(?!\s)\s*(\S.*)$/;

// Words the coach types around the kit rather than as the kit. Stripped so
// "*weights required" and "*weights" land on the same chip.
const FILLER = /\b(required|require|requires|requirement|needed|need|needs|must have|bring|you need|is|are|a|an|the)\b/gi;

// Ordered: the multi-word entries come first so "dip bars" is a parallette and
// not a pull-up bar, and "barbell" is weight and not a bar.
const LEXICON = [
  { label: 'PARALLETTES',      alt: 'dip bars or two low parallel bars',
    match: /\b(parallettes?|p ?bars|parallel bars?|dip bars?|dip station|dip belt)\b/ },
  { label: 'PULL-UP BAR',      alt: 'a doorway bar or any high bar',
    match: /\b(pull ?-? ?ups? bar|chin ?-? ?ups? bar|high bar|bars?)\b/ },
  { label: 'WEIGHT VEST',      alt: null,
    match: /\b(weight ?vest|vest)\b/ },
  { label: 'WEIGHTS',          alt: 'dumbbells, plates or a vest',
    match: /\b(weights?|weighted|dumbbells?|db|kettlebells?|kb|plates?|barbell)\b/ },
  { label: 'RESISTANCE BAND',  alt: 'any loop or tube band',
    match: /\b(resistance bands?|bands?|elastic)\b/ },
  { label: 'RINGS',            alt: null,
    match: /\brings?\b/ },
  { label: 'AB WHEEL',         alt: null,
    match: /\b(ab ?wheel|wheel|ab ?roller|roller)\b/ },
  { label: 'BOX OR BENCH',     alt: 'a chair or a step works',
    match: /\b(box|bench|chair|step|stool|platform)\b/ },
  { label: 'ELEVATED SURFACE', alt: 'anything you can raise a hand or foot on',
    match: /\b(elevated surface|elevation|elevated)\b/ },
  { label: 'WALL',             alt: null, match: /\bwalls?\b/ },
  { label: 'FLOOR SPACE',      alt: null, match: /\b(floor space|open space|space)\b/ },
  { label: 'MAT',              alt: null, match: /\b(yoga ?mat|mats?)\b/ },
  { label: 'PARTNER',          alt: 'someone to hold or spot you',
    match: /\b(partner|spotter)\b/ },
  { label: 'STRAPS',           alt: null, match: /\bstraps?\b/ },
  { label: 'TOWEL',            alt: null, match: /\btowels?\b/ },
  { label: 'ROPE',             alt: null, match: /\bropes?\b/ },
  { label: 'CHALK',            alt: null, match: /\bchalk\b/ },
  { label: 'TIMER',            alt: null, match: /\b(timer|stopwatch|clock)\b/ },
];

// "weights, bands + a pull up bar" → three items. "/" and "or" stay INSIDE one
// item: "bar / rings" is one requirement with two ways to meet it, not two.
const SPLIT = /\s*(?:,|\+|&|\band\b)\s*/i;

function clean(s) {
  return s.replace(FILLER, ' ').replace(/[.!*]+$/, '').replace(/\s+/g, ' ').trim();
}

function itemFor(raw) {
  const stripped = clean(raw);
  if (!stripped) return null;
  const hay = stripped.toLowerCase();

  for (const g of LEXICON) {
    const m = hay.match(g.match);
    if (!m) continue;
    // The coach wrote the bare item ("bands") — swap in the canonical name.
    // He wrote MORE than the item ("ankle straps", "rings / bar") — those extra
    // words are the point, so they stay — and the hint goes with them, since it
    // describes the plain item and can contradict what he actually wrote
    // ("rings / bar" is not "a doorway bar").
    if (m[0] !== hay) return { label: stripped.toUpperCase(), alt: null };
    return { label: g.label, alt: g.alt };
  }
  // Unknown kit keeps the coach's own words — the rule still fires, we just
  // have nothing to add to it.
  return { label: stripped.toUpperCase(), alt: null };
}

// The text after the asterisk → the chips to render. Never empty: a bare "*"
// with nothing after it isn't a requirement line at all (GEAR_LINE won't match).
export function parseGear(text) {
  const items = [];
  for (const part of String(text ?? '').split(SPLIT)) {
    const item = itemFor(part);
    // Same kit named twice ("*weights, dumbbells") is one chip.
    if (item && !items.some(i => i.label === item.label)) items.push(item);
  }
  return items;
}

// For the places that show a description as ONE cramped preview line (workout
// cards, the mission launcher): pull the requirement out of the prose so the
// raw asterisk never surfaces, and hand the kit back separately so it can be
// shown as its own compact strip.
export function splitGear(raw) {
  const lines = String(raw ?? '').split('\n');
  const items = [];
  const prose = [];
  for (const line of lines) {
    const found = gearFromLine(line);
    if (!found) { prose.push(line); continue; }
    for (const item of found) {
      if (!items.some(i => i.label === item.label)) items.push(item);
    }
  }
  return { prose: prose.join('\n').trim(), items };
}

// Is this line a requirement? Returns the parsed items, or null.
export function gearFromLine(line) {
  const m = String(line ?? '').trim().match(GEAR_LINE);
  if (!m) return null;
  const items = parseGear(m[1]);
  return items.length ? items : null;
}
