// Per-class LVL computation.
//
// A player's LVL for a given class is the sum of `lvl_reward` over all quests
// that (a) belong to that class and (b) the player has completed. The legacy
// `profiles.current_lvl` column is no longer read or written by the app.
//
// EXP (`profiles.total_exp`, `profiles.prestige_count`) is intentionally not
// touched here — this module is LVL-only.

import { supabase } from './supabase';

/**
 * Async compute: fetch quests for the class and the player's completions,
 * then return the summed LVL. Returns 0 when classId is missing.
 */
export async function computeLvl(studentId, classId) {
  if (!studentId || !classId) return 0;

  const [questsRes, completionsRes] = await Promise.all([
    supabase
      .from('class_quests')
      .select('id, lvl_reward')
      .eq('class_id', classId),
    supabase
      .from('student_quest_completions')
      .select('quest_id')
      .eq('student_id', studentId),
  ]);

  const quests       = questsRes.data ?? [];
  const completedIds = new Set((completionsRes.data ?? []).map(c => c.quest_id));
  return computeLvlFromData(quests, completedIds);
}

/**
 * Synchronous compute for screens that already have quests + completions in
 * state. `quests` must be rows from `class_quests` already filtered to the
 * target class. `completedIdsSet` is a Set of quest IDs the player completed.
 */
export function computeLvlFromData(quests, completedIdsSet) {
  if (!quests || !completedIdsSet) return 0;
  let sum = 0;
  for (const q of quests) {
    if (completedIdsSet.has(q.id)) sum += q.lvl_reward ?? 0;
  }
  return sum;
}
