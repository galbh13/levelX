// Resolving a workout row to its "how to perform" catalog card.
//
// Every exercise title in the app is tappable — Workout Mode, Workout Detail,
// the summary — and every tap must land on a card, even when the movement has
// no catalog entry at all. This module holds the shared resolution so all the
// call sites behave identically.

// Normalize a name for matching — lowercased, punctuation and extra whitespace
// stripped — so minor spacing/formatting differences between the workout row
// and the gallery catalog still match.
export function normName(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Build the two lookup maps from a raw `exercises_gallery` fetch.
export function buildGalleryIndex(rows) {
  const byId = {};
  const byName = {};
  for (const g of rows ?? []) {
    byId[g.id] = g;
    if (g.name) byName[normName(g.name)] = g;
  }
  return { byId, byName };
}

// Loose fallback: a workout row written free-text ("PULL UPS - WIDE GRIP")
// still deserves the "PULL UP" card. Match on whole-word containment in either
// direction and prefer the longest (most specific) catalog name that fits, so
// "ARCHER PUSH UP" beats "PUSH UP" when both are present.
function looseMatch(byName, target) {
  const t = normName(target);
  if (!t) return null;
  const tWords = ` ${t} `;
  let best = null;
  let bestLen = 0;
  for (const [key, row] of Object.entries(byName)) {
    if (!key) continue;
    const hit = tWords.includes(` ${key} `) || ` ${key} `.includes(tWords);
    if (hit && key.length > bestLen) { best = row; bestLen = key.length; }
  }
  return best;
}

// The one resolver: exact `gallery_id` link → exact normalized name → loose
// name match → a name-only placeholder card so the tap is never a dead end.
//
// `fallbackType` is the label to wear when the catalog has no movement type for
// this movement (or there's no catalog row at all) — callers pass the WORKOUT's
// type (MAIN QUEST / SIDE QUEST / ACCESSORIES / LEGS / HANDSTAND). Every card
// gets an eyebrow badge that way, not just the catalogued ones.
export function resolveGuide(ex, byId = {}, byName = {}, fallbackType = null) {
  const row = (ex?.gallery_id ? byId[ex.gallery_id] : null)
    ?? byName[normName(ex?.name)]
    ?? looseMatch(byName, ex?.name);
  const type = row?.movement_type || fallbackType || ex?.variation || null;
  return row
    ? { ...row, movement_type: type }
    : { name: ex?.name ?? 'EXERCISE', movement_type: type };
}
