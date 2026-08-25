// Optimistic bridge between the tree (where a quest is actually completed) and
// the screens that only LIST chain progress (Skills).
//
// The list refetches its completions on every focus, and a Supabase round-trip
// takes a beat. So a player who cleared the last node of a chain and swiped back
// used to watch the stale card sit there for a second or two before it flipped
// to MAXED OUT — the payoff landed late, which reads as a bug, not a reward.
//
// The tree writes every toggle here the instant the DB accepts it (never before —
// these are confirmed writes, not guesses). The list merges those deltas over
// whatever it last fetched, so the maxed state is already on screen the moment
// the back transition starts, and the refetch that lands after just agrees.
//
// Module-level and deliberately not persisted: it only has to outlive one
// navigation, and the server is the source of truth the moment it answers.

const added   = new Map(); // studentId -> Set(questId) completed but not yet refetched
const removed = new Map(); // studentId -> Set(questId) un-completed but not yet refetched

function bucket(map, studentId) {
  let s = map.get(studentId);
  if (!s) { s = new Set(); map.set(studentId, s); }
  return s;
}

export function noteQuestCompleted(studentId, questId) {
  if (!studentId || !questId) return;
  bucket(added, studentId).add(questId);
  removed.get(studentId)?.delete(questId);
  emit();
}

export function noteQuestUncompleted(studentId, questId) {
  if (!studentId || !questId) return;
  bucket(removed, studentId).add(questId);
  added.get(studentId)?.delete(questId);
  emit();
}

// Pure: the given completion set with the pending deltas laid over it. Safe to
// call during render.
export function mergeQuestProgress(studentId, completions) {
  if (!studentId) return completions;
  const a = added.get(studentId);
  const r = removed.get(studentId);
  if (!a?.size && !r?.size) return completions;
  const out = new Set(completions);
  a?.forEach(id => out.add(id));
  r?.forEach(id => out.delete(id));
  return out;
}

// Call with a freshly FETCHED set: drops every delta the server now agrees with
// (so the overlay can't outlive its usefulness or mask a later change made
// elsewhere) and returns the set to store.
export function reconcileQuestProgress(studentId, fetched) {
  if (!studentId) return fetched;
  added.get(studentId)?.forEach(id => { if (fetched.has(id)) added.get(studentId).delete(id); });
  removed.get(studentId)?.forEach(id => { if (!fetched.has(id)) removed.get(studentId).delete(id); });
  return mergeQuestProgress(studentId, fetched);
}

// ── Live notification ────────────────────────────────────────────────────────
// Writing a delta has to WAKE the list screens: they sit mounted underneath the
// tree in the stack, and React has no reason to re-render them just because this
// module changed. Subscribers bump their own state, so a chain the player clears
// in the tree is already gold on the card behind them — the back transition then
// reveals a finished state instead of flipping one mid-animation.
const listeners = new Set();

export function subscribeQuestProgress(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() { listeners.forEach(fn => fn()); }

// Anything committed since the last fetch agreed with it? The list uses this to
// decide whether returning from a tree deserves a replayed celebration.
export function hasPendingQuestProgress(studentId) {
  if (!studentId) return false;
  return !!(added.get(studentId)?.size || removed.get(studentId)?.size);
}
