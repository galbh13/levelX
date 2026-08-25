// Coach-approved quests — a node the PLAYER can never check off themselves.
//
// A quest row with `class_quests.coach_approved = true` is still an ordinary
// node (it owns its own `student_quest_completions` row, pays its own
// `lvl_reward`, gates its children like any other) — the only difference is WHO
// is allowed to toggle it: the coach, from the admin flow, after they've
// actually watched the player do it.
//
// It is the third node palette in the tree, and the rule that keeps them apart:
//   • GOLD   — hidden challenge / prestige requirement (lib/hiddenQuests.js)
//   • VIOLET — mirrored requirement, owned by another quest (lib/mirrorQuests.js)
//   • GREEN  — coach approval, owned by the coach (this file)
// Like a mirror node it is not tappable by the player, but for the opposite
// reason: the mirror lives in another QUEST, this one lives with another PERSON.

/** True when `quest` can only be checked off by the coach. */
export function isCoachQuest(quest) {
  return !!quest?.coach_approved;
}

/**
 * Can the viewer currently on screen toggle `quest`?
 * Every node says yes except a coach-approved one outside the admin flow.
 * `isAdmin` comes from CoachContext — it marks the COACH-side navigator.
 */
export function canToggleCoachQuest(quest, isAdmin) {
  return !isCoachQuest(quest) || !!isAdmin;
}

// What a coach node SAYS. It carries no badge of its own (no ✓ DONE chip, no
// LVL chip) — the sentence in the card is the whole node, and it flips when the
// coach signs it off.
// Kept SHORT on purpose: at the node's 24px type this fits one line in a
// standard 380px card (318px of 330 usable), so the coach row stays one line
// tall and the branch label below it never gets crowded.
export const COACH_PENDING_LABEL = 'Coach certification needed';
export const COACH_DONE_LABEL    = 'Coach Approved';

/** The text to render on `quest`'s card, given whether it's complete. */
export function questNodeLabel(quest, isDone) {
  if (!isCoachQuest(quest)) return quest?.name ?? '';
  return isDone ? COACH_DONE_LABEL : COACH_PENDING_LABEL;
}

/**
 * The LONGEST text the node can ever show — what the layout must reserve height
 * for, since a coach node's label changes with its state and the row height
 * can't (a re-measure on approval would shuffle the whole tree).
 */
export function questLayoutLabel(quest) {
  return isCoachQuest(quest) ? COACH_PENDING_LABEL : (quest?.name ?? '');
}
