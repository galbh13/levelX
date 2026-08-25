// Mirrored quests — a requirement earned in a DIFFERENT quest.
//
// A quest row with `class_quests.mirror_quest_id` set is not a quest of its own:
// it is a read-only reflection of another node (usually in another chain of the
// same class). The HSPU main quest's REQUIREMENT branch is the first one — its
// single node mirrors BALANCE's "Freestanding 20 sec".
//
// Two rules follow from that, and they live here so every screen agrees:
//   • DONE is inherited. Nothing is ever written to
//     `student_quest_completions` for a mirror node; it counts as complete
//     exactly when the node it mirrors is complete.
//   • It can't be toggled where it's shown. The player has to go to the quest
//     that OWNS the node — that's the whole point of the cross-quest link.
// A mirror node therefore also carries `lvl_reward = 0`: the LVL is paid once,
// by the real node.

/** True when `quest` is a mirror of another quest. */
export function isMirrorQuest(quest) {
  return !!quest?.mirror_quest_id;
}

/**
 * `completedIds` plus every mirror node in `quests` whose source is completed.
 * Use this — never the raw completion set — for node state, tree connectors and
 * "x / y complete" counters.
 */
export function withMirrorCompletions(quests, completedIds) {
  const ids = new Set(completedIds ?? []);
  (quests ?? []).forEach(q => {
    if (q?.mirror_quest_id && ids.has(q.mirror_quest_id)) ids.add(q.id);
  });
  return ids;
}
