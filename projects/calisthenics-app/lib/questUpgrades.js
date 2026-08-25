// Quest upgrades — a main quest's tier-2 face.
//
// Some main quests have a HARDER version of themselves waiting behind them. Clear
// every node of the base quest and a gold UPGRADE button reveals at the foot of
// the tree; take it and the quest BECOMES its upgrade — the tree swaps to the
// harder nodes and the Skills card renders the upgrade's name and progress in the
// base quest's place. It is never a one-way door: an upgraded quest carries a
// switch back to the version below it, and the player can move between them
// freely (the completions on both sides are untouched by switching).
//
// Two things follow from that, and they live here so every screen agrees:
//
//   • An upgrade chain is NOT a side quest. Its rows still sit in the DB as
//     `quest_type = 'side'` (that is how they were seeded), but the app lifts
//     them out of the SIDE QUESTS section entirely — they only ever appear as
//     the upgraded face of their base chain. Filtering them anywhere a side
//     chain is listed is `isUpgradeChain`'s whole job.
//
//   • Whether a player HAS upgraded is per-player state, stored in Supabase
//     (`student_quest_upgrades`, one row per player + base chain), not derived
//     from completions. Completing the base quest only OFFERS the upgrade; the
//     player takes it deliberately, and the reveal fires once.
//
// The map is keyed by base chain slug. Chain slugs are stable across the live
// DB's drift from the migration files (unlike ids and rewards), so this stays
// correct without a schema change — see lib/prestige.js for the same reasoning.

// base chain → the quest it upgrades into.
//   chain     — the upgrade's chain slug in `class_quests`
//   questType — that row's `quest_type` AS SEEDED (not as displayed: both of
//               these read 'side' in the DB but are shown as main quests)
//   baseType  — the BASE chain's `quest_type`, so the version switch can go back
//               without another round-trip
export const QUEST_UPGRADES = {
  comboes:              { chain: 'extreme_combo', questType: 'side', baseType: 'main' },
  straight_arm_presses: { chain: 'pike_press',    questType: 'side', baseType: 'main' },
};

/** The upgrade waiting behind `chain`, or null when it has none. */
export function upgradeFor(chain) {
  return QUEST_UPGRADES[chain] ?? null;
}

/** True when `chain` is some other quest's upgrade (so it is never listed alone). */
export function isUpgradeChain(chain) {
  return Object.values(QUEST_UPGRADES).some(u => u.chain === chain);
}

/**
 * The quest `chain` upgraded FROM — `{ chain, questType }` — or null when `chain`
 * is not an upgrade. The mirror of `upgradeFor`, so the version switch works from
 * either half of a pair.
 */
export function baseOf(chain) {
  const hit = Object.entries(QUEST_UPGRADES).find(([, u]) => u.chain === chain);
  return hit ? { chain: hit[0], questType: hit[1].baseType } : null;
}

/** True when every visible node of `chainQuests` is complete (the upgrade gate). */
export function chainCleared(chainQuests, completedIds) {
  return chainQuests.length > 0 && chainQuests.every(q => completedIds?.has(q.id));
}

// ─── Persistence ────────────────────────────────────────────────────────────
// `student_quest_upgrades` (see migrations/20260824_quest_upgrades.sql):
//   student_id uuid, base_chain text, class_id uuid, upgraded_at timestamptz
// A row's PRESENCE means "this player has taken the upgrade on this chain".

/** The set of base chains this player has upgraded. Never throws. */
export async function fetchUpgrades(supabase, studentId, classId) {
  if (!studentId) return new Set();
  try {
    const { data, error } = await supabase
      .from('student_quest_upgrades')
      .select('base_chain')
      .eq('student_id', studentId)
      .eq('class_id', classId);
    if (error) throw error;
    return new Set((data ?? []).map(r => r.base_chain));
  } catch (e) {
    // The table may not exist yet on a DB that hasn't run the migration — an
    // un-upgraded player is the correct fallback, never a crashed screen.
    console.warn('[questUpgrades] fetchUpgrades:', e?.message ?? e);
    return new Set();
  }
}

/** Record that `studentId` took the upgrade on `baseChain`. Idempotent. */
export async function saveUpgrade(supabase, studentId, classId, baseChain) {
  const { error } = await supabase
    .from('student_quest_upgrades')
    .upsert(
      { student_id: studentId, class_id: classId, base_chain: baseChain },
      { onConflict: 'student_id,base_chain' },
    );
  if (error) throw error;
}

/**
 * Undo the upgrade on `baseChain` — the quest goes back to being its base
 * version, and the gold gate is waiting at the foot of it again (the base is by
 * definition still cleared).
 *
 * This WIPES the upgrade quest as it hands it back: every `questIds` node the
 * player had signed off is un-completed, so re-taking the upgrade starts it from
 * zero rather than resuming a half-finished harder quest. That is the point —
 * the undo has to leave no trace of an upgrade taken by accident. The LVL those
 * nodes paid goes with them (LVL is computed from completions —
 * lib/computeLvl.js), so this is DESTRUCTIVE and the caller must confirm first.
 *
 * The BASE quest's completions are never touched — `questIds` only ever holds
 * the upgrade half's nodes — so the base stays cleared and the gate re-arms.
 *
 * Completions go first: if that fails the upgrade row survives, and the player
 * is left on a working upgraded quest instead of a downgraded one still carrying
 * the old progress.
 */
export async function removeUpgrade(supabase, studentId, baseChain, questIds = []) {
  if (questIds.length > 0) {
    const { error: wipeErr } = await supabase
      .from('student_quest_completions')
      .delete()
      .eq('student_id', studentId)
      .in('quest_id', questIds);
    if (wipeErr) throw wipeErr;
  }

  const { error } = await supabase
    .from('student_quest_upgrades')
    .delete()
    .eq('student_id', studentId)
    .eq('base_chain', baseChain);
  if (error) throw error;
}
