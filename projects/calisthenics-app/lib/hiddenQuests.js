// Hidden challenges — quests that don't exist for the player until they've
// earned them.
//
// A quest row with `class_quests.is_hidden = true` is filtered OUT of every
// surface (the tree, its node count, the Skills chain progress) until EVERY id
// in its `prerequisites` is completed. Then it appears — already unlocked, since
// its prerequisites are by definition met — as a bonus node at the end of the
// quest. There is nothing else special about it: it carries a normal
// `lvl_reward` and toggles like any other node.
//
// The rule lives here so QuestTreeScreen and SkillsScreen can never disagree
// about whether a challenge has been revealed (a hidden node showing up in a
// "x/y unlocked" counter would give the surprise away).

/** True when `quest` should be visible to a player with `completedIds`. */
export function isRevealed(quest, completedIds) {
  if (!quest?.is_hidden) return true;
  const pre = quest.prerequisites ?? [];
  // A hidden node with no prerequisites could never be earned → stays hidden.
  return pre.length > 0 && pre.every(id => completedIds?.has(id));
}

/** `quests` minus every hidden challenge the player hasn't unlocked yet. */
export function visibleQuests(quests, completedIds) {
  return (quests ?? []).filter(q => isRevealed(q, completedIds));
}
