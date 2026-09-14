/**
 * Display names for quest chains and branches.
 *
 * Chains are stored as slugs (`extreme_combo`, `pike_press`) and every screen
 * used to title them with a bare `slug.replace(/_/g, ' ').toUpperCase()`. That
 * works right up until a slug is misspelled — `comboes` shipped to players as
 * "COMBOES" on the Skills card, the quest-tree header, the branch switcher and
 * the RETURN TO plate, all at once.
 *
 * The slug is load-bearing: it is the `chain` column, it keys
 * questUpgrades.js's pair map, and migrations match on it. Renaming it in the
 * database would mean rewriting all of that. So the slug stays as-is and the
 * SPELLING is fixed here, at the one place the player actually reads it.
 *
 * Add an entry only when the derived label is wrong. Anything absent falls
 * through to the underscore/upper-case rule, which is right for the rest.
 */
const OVERRIDES = {
  comboes: 'COMBOS',
};

export function chainLabel(slug) {
  if (!slug) return '';
  const key = String(slug).trim().toLowerCase();
  return OVERRIDES[key] ?? String(slug).replace(/_/g, ' ').toUpperCase();
}
