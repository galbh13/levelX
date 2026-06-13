// Per-class LVL computation.
//
// A player's LVL for a given class is the sum of `lvl_reward` over all quests
// that (a) belong to that class and (b) the player has completed. The legacy
// `profiles.current_lvl` column is no longer read or written by the app.
//
// Prestige (`profiles.prestige_count`) is intentionally not touched here — this
// module is LVL-only. (EXP was removed from the app.)

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
      .select('id, lvl_reward, chain')
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
 *
 * Only quests that belong to a chain count toward LVL — orphan quests with a
 * null/empty `chain` are excluded. This is the single definition of LVL, so
 * every screen (Home, Workouts, Skills) agrees on the number.
 */
export function computeLvlFromData(quests, completedIdsSet) {
  if (!quests || !completedIdsSet) return 0;
  let sum = 0;
  for (const q of quests) {
    if (q.chain && completedIdsSet.has(q.id)) sum += q.lvl_reward ?? 0;
  }
  return sum;
}

/**
 * Maximum attainable LVL for a class = sum of `lvl_reward` over ALL its quests
 * (main + side), regardless of completion. This is the natural per-class ceiling
 * and drives the progress-bar denominator, so each class's bar scales to its own
 * total instead of a hardcoded 100. Returns 0 when classId is missing.
 */
export async function computeClassMax(classId) {
  if (!classId) return 0;
  const { data } = await supabase
    .from('class_quests')
    .select('lvl_reward, chain')
    .eq('class_id', classId);
  return computeClassMaxFromData(data ?? []);
}

/**
 * Synchronous variant for screens that already hold the class's quest rows.
 * Only chained quests count, matching `computeLvlFromData` — so the LVL bar's
 * denominator can actually be reached (100 / 100, not 100 / 130).
 */
export function computeClassMaxFromData(quests) {
  if (!quests) return 0;
  let sum = 0;
  for (const q of quests) if (q.chain) sum += q.lvl_reward ?? 0;
  return sum;
}
