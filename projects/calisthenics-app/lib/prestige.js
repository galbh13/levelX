// Per-class prestige gating.
//
// Prestige is no longer a single LVL threshold — each class gates on THREE
// kinds of requirement, expressed declaratively in PRESTIGE_REQUIREMENTS and
// evaluated by one pure function, evaluatePrestige():
//
//   1. minLevel        — the player's computed LVL must reach the class's
//                        `prestige_at` (still stored in the DB, drives the bar
//                        marker; passed in as `prestigeAt`).
//   2. mainQuests      — specific MAIN-quest completion (see shapes below).
//   3. requireTier2Side — at least ONE Tier-2 side-quest chain fully completed.
//                        "Tier 2" is detected structurally (a side chain whose
//                        first node is gated by a prereq in a DIFFERENT chain),
//                        the same rule SkillsScreen uses to group side quests.
//
// Config is keyed by class `order_index` (0 = Class I, 1 = Class II, …). Classes
// with no entry fall back to "level only", so the dynamic class count is never
// hardcoded — adding a class without a config entry just gates on its level.
//
// IMPORTANT: requirements reference quests by (chain, name), NEVER by id or by
// `lvl_reward`. The live DB's rewards drift from the migration files, but names
// are stable, so this module stays correct regardless of that drift.

// ─── Declarative requirements ───────────────────────────────────────────────
//
// mainQuests shapes:
//   • 'all'                              — every main quest in the class
//   • { chains: ['handstand'],           — every main quest in each listed chain
//       nodes:  [{ chain, name }, …] }     PLUS each specific named node
// Either `chains` or `nodes` may be omitted.

export const PRESTIGE_REQUIREMENTS = {
  // Class I → Class II
  0: {
    mainQuests: 'all',
    requireTier2Side: true,
  },

  // Class II → Class III
  1: {
    mainQuests: {
      nodes: [
        { chain: 'handstand', name: 'Freestanding 30 sec' },
        { chain: 'hspu', name: '2 HSPU' },
        { chain: 'oapu', name: '2 OAPU' },
      ],
    },
    requireTier2Side: true,
  },

  // Class III → Class IV
  2: {
    mainQuests: {
      nodes: [
        { chain: 'front_lever', name: '1 Negative 5 sec' },
        { chain: 'front_lever', name: 'Front Lever 3 sec' },
        { chain: 'front_lever', name: '7 Front Raises' },
        { chain: 'planche',     name: '1 Negative 5 sec' },
        { chain: 'planche',     name: '5 sec Full Planche' },
      ],
    },
    requireTier2Side: true,
  },
};

// ─── Tier-2 side chains (structural) ────────────────────────────────────────
// A side chain is Tier 2 when any of its quests is gated by a prerequisite that
// lives in a DIFFERENT chain (the cross-chain convergence gate). Mirrors the
// grouping logic in SkillsScreen so both stay in agreement.

export function tier2SideChains(quests) {
  const sideQuests   = quests.filter(q => q.quest_type === 'side');
  const chainOfQuest = new Map(quests.map(q => [q.id, q.chain]));
  const sideChains   = [...new Set(sideQuests.map(q => q.chain).filter(Boolean))];

  return sideChains.filter(chain =>
    sideQuests.some(q =>
      q.chain === chain &&
      (q.prerequisites ?? []).some(pid => {
        const pc = chainOfQuest.get(pid);
        return pc && pc !== chain;
      }),
    ),
  );
}

// ─── Prestige stars (classes overcome) ──────────────────────────────────────
// Stars reflect how many classes the player has CONQUERED, not a raw counter.
// Being in a class means you overcame every class before it, so the base is the
// current class's `order_index` (0-based). The final class has no class above it
// to advance into, so completing all its requirements (`finalClassMet`) grants
// the last star. Bounded by the real class count — never inflated.

export function prestigeStars({ orderIndex = 0, classCount = null, finalClassMet = false }) {
  const isLast = classCount != null && orderIndex >= classCount - 1;
  return (orderIndex ?? 0) + (isLast && finalClassMet ? 1 : 0);
}

// ─── Requirement highlighting ───────────────────────────────────────────────
// Quest ids that are MAIN-quest prestige requirements for a class, matched
// within the provided quest rows. Works on a full class set or just one chain's
// nodes (QuestTreeScreen passes the latter), so it can highlight requirement
// nodes inside a tree. Side-quest requirements are structural ("any 1 Tier-2
// chain") and intentionally not surfaced here.

export function requiredMainQuestIds(orderIndex, quests) {
  const spec = PRESTIGE_REQUIREMENTS[orderIndex]?.mainQuests;
  if (!spec) return new Set();

  const ids = new Set();
  if (spec === 'all') {
    quests.forEach(q => { if (q.quest_type === 'main') ids.add(q.id); });
    return ids;
  }
  (spec.chains ?? []).forEach(chain => {
    quests.forEach(q => {
      if (q.quest_type === 'main' && q.chain === chain) ids.add(q.id);
    });
  });
  (spec.nodes ?? []).forEach(({ chain, name }) => {
    const match = quests.find(
      q => q.quest_type === 'main' && q.chain === chain && q.name === name,
    );
    if (match) ids.add(match.id);
  });
  return ids;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function mainQuestsInChain(quests, chain) {
  return quests.filter(q => q.quest_type === 'main' && q.chain === chain);
}

function prettyChain(chain) {
  return chain.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Builds one breakdown item for a GROUP of quests (a whole chain, or 'all').
// `remaining` lists the names still incomplete, so the player sees exactly what
// is left without dumping the already-done nodes.
function groupItem(label, group, completedIds) {
  const total     = group.length;
  const done      = group.filter(q => completedIds.has(q.id)).length;
  const remaining = group.filter(q => !completedIds.has(q.id)).map(q => q.name);
  return { label, ok: total > 0 && done === total, detail: `${done} / ${total}`, remaining };
}

// Returns { ok, done, total, items } for the mainQuests spec. `items` is the
// per-requirement breakdown the UI renders so the player knows exactly which
// main quests gate prestige.
function checkMainQuests(spec, quests, completedIds) {
  const required = [];
  const items    = [];

  if (spec === 'all') {
    const all = quests.filter(q => q.quest_type === 'main');
    required.push(...all);
    items.push(groupItem('All main quests', all, completedIds));
  } else {
    (spec.chains ?? []).forEach(chain => {
      const group = mainQuestsInChain(quests, chain);
      required.push(...group);
      items.push(groupItem(`All ${prettyChain(chain)} quests`, group, completedIds));
    });
    (spec.nodes ?? []).forEach(({ chain, name }) => {
      const match = quests.find(
        q => q.quest_type === 'main' && q.chain === chain && q.name === name,
      );
      if (match) required.push(match);
      // A named node is its own exact requirement — no `remaining` sub-list.
      items.push({ label: name, ok: !!match && completedIds.has(match.id), detail: '', remaining: [] });
    });
  }

  // De-dupe (a node could be matched twice if it also belongs to a listed chain)
  const uniq = new Map(required.map(q => [q.id, q]));
  const total = uniq.size;
  let done = 0;
  uniq.forEach(q => { if (completedIds.has(q.id)) done++; });

  return { ok: total > 0 && done === total, done, total, items };
}

// Returns { ok, completedChains, totalChains } for the Tier-2-side rule.
function checkTier2Side(quests, completedIds) {
  const chains = tier2SideChains(quests);
  let completedChains = 0;

  chains.forEach(chain => {
    const nodes = quests.filter(q => q.quest_type === 'side' && q.chain === chain);
    const allDone = nodes.length > 0 && nodes.every(q => completedIds.has(q.id));
    if (allDone) completedChains++;
  });

  return { ok: completedChains > 0, completedChains, totalChains: chains.length };
}

// ─── Evaluator ──────────────────────────────────────────────────────────────
//
// Pure: takes everything it needs, returns { ok, checks }. `checks` is an
// ordered list the UI renders as a checklist; `ok` is true only when every
// check passes.
//
//   orderIndex   — current class order_index
//   quests       — ALL class_quests rows for the class (main + side)
//   completedIds — Set of completed quest ids for the player
//   lvl          — player's computed LVL for the class
//   prestigeAt   — the class's prestige_at threshold
//
// Each check: { key, label, ok, detail }.

export function evaluatePrestige({ orderIndex, quests, completedIds, lvl, prestigeAt }) {
  const req    = PRESTIGE_REQUIREMENTS[orderIndex] ?? {};
  const checks = [];

  // 1. Level — always required.
  checks.push({
    key:    'level',
    label:  `Reach LVL ${prestigeAt}`,
    ok:     lvl >= prestigeAt,
    detail: `${lvl} / ${prestigeAt}`,
  });

  // 2. Main quests. `items` is the per-requirement breakdown (each chain / named
  // node) the UI lists so the player sees exactly which mains remain.
  if (req.mainQuests) {
    const { ok, done, total, items } = checkMainQuests(req.mainQuests, quests, completedIds);
    checks.push({
      key:    'main',
      label:  req.mainQuests === 'all'
        ? 'Complete all main quests'
        : 'Complete required main quests',
      ok,
      detail: `${done} / ${total}`,
      items,
    });
  }

  // 3. Tier-2 side skill.
  if (req.requireTier2Side) {
    const { ok, completedChains, totalChains } = checkTier2Side(quests, completedIds);
    checks.push({
      key:    'tier2',
      label:  'Complete 1 Tier II skill',
      ok,
      detail: totalChains > 0 ? `${completedChains} / 1` : '—',
    });
  }

  return { ok: checks.every(c => c.ok), checks };
}
