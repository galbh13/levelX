import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';
import { ShimmerFrame, BORDEAUX } from '../components/Shimmer';
import { requiredMainQuestIds } from '../lib/prestige';

// ─── Theme ────────────────────────────────────────────────────────────────────

const SL = {
  bg:     '#050912',
  panel:  '#070d1a',
  border: '#1a3a5c',
  accent: '#4A9EBF',
  text:   '#E8F4FF',
  muted:  '#4a6a8a',
  danger: '#FF4444',
  green:  '#4CAF50',
  gold:   '#FFD700',
  wine:   '#E11D48',
};

// ─── Layout constants ─────────────────────────────────────────────────────────

const NODE_W       = 420;
const NODE_H       = 82;
const COL_GAP      = 70;
const RANK_GAP     = 76;
const TIER_GAP     = 96;      // extra vertical room reserved around a TIER divider
const TREE_PAD_H   = 16;
const TREE_PAD_T   = 28;
const LABEL_H      = 48;
const LABEL_OFFSET = 58;
const BEND_NEAR_CHILD = 12;   // horizontal jog sits this many px above child top

// ─── Per-node height — long names grow taller instead of clipping ─────────────
// Width is fixed by column geometry, so we can't widen a node without colliding
// with its neighbours. Instead each node's HEIGHT is sized to how many lines its
// name needs (up to a cap), so long text wraps fully and short nodes stay compact.
const NODE_LINE_H    = 30;   // must match styles.questName lineHeight
const NODE_V_PAD     = 12;   // must match styles.questCard paddingVertical
// Reserved row for the DONE / +LVL badge + the gap above it. Must comfortably
// cover the badge's real rendered height (text lineHeight 22 + 4 padding = 26)
// plus styles.questCard gap (6) plus slack so the title is never clipped.
const NODE_BADGE_H   = 42;
const NODE_MAX_LINES = 3;

function nodeLineCount(name, nodeW) {
  const usable  = nodeW - 32;                       // minus horizontal padding
  const perLine = Math.max(8, Math.floor(usable / 16)); // ~16px per bold char @27
  const len     = (name?.length ?? 0) + 3;          // +3 buffer for the 🔒 prefix
  return Math.min(NODE_MAX_LINES, Math.max(1, Math.ceil(len / perLine)));
}

function nodeHeightFor(name, nodeW) {
  const lines = nodeLineCount(name, nodeW);
  return Math.max(NODE_H, NODE_V_PAD * 2 + lines * NODE_LINE_H + NODE_BADGE_H);
}

// Branch column priority — left to right
const BRANCH_ORDER = [
  'power', 'hspu_prog', 'negative', 'balance', 'main',
  'mobility', 'active_hold', 'disconnection', 'freestanding', 'band', 'hs_hold',
];

// ─── Per-branch vertical layout (DESIGN CONSTANT, same for every player) ───────
// Controls where a branch's nodes START and END vertically. Two ways to express
// each bound (use whichever reads clearest):
//   • startFrac / endFrac : fraction of tier height (0 = top, 1 = bottom)
//   • startRank / endRank : ABSOLUTE row, aligns to another branch's node at that
//                           rank. Takes precedence over the *Frac form when set.
// The spread between start and end is even. Key = `${chain}.${branch}`. Any
// branch not listed defaults to full spread { startFrac: 0, endFrac: 1 }, so
// adding entries only changes the branches named.
//
// Behaviour depends on the branch:
//   • Independent leaf branch (feeds no merge) → spread evenly across
//     [start, end]; both bounds honoured.
//   • Branch that feeds a convergence/merge → rigidly shifted DOWN to `start`
//     (end ignored), clamped so it can't drop onto its merge and invert a
//     connector. This is how REQUIREMENT aligns under "3 HSPU Wall".
//   • Floating branch (no fixed column — every node is convergence/post-conv,
//     e.g. HSPU's MAIN) → rigidly shifted DOWN to `start`, taking the whole
//     chain with it. Used to add breathing room before a merge in an untiered
//     chain (substitutes for the absent TIER divider).
const BRANCH_LAYOUT = {
  // Planche: NEGATIVE & PRESS start level with HOLD's "15 sec Tuck" (rank 2),
  // still spanning down to the bottom of Tier 1.
  'planche.negative': { startRank: 2 },
  'planche.press':    { startRank: 2 },

  // HSPU: REQUIREMENT branch starts level with "3 HSPU Wall" (rank 3) instead of
  // at the top. It feeds the MAIN convergence, so it's rigidly shifted down (and
  // clamped to stay above the merge) rather than spread. (Keys are matched
  // case-insensitively, so 'requirement' covers Requirement/REQUIREMENT too.)
  'hspu.requirement': { startRank: 3 },

  // HSPU: MAIN is a floating branch that begins with the multi-branch merge.
  // HSPU isn't tiered, so there's no TIER divider giving the merge breathing
  // room. Shifting MAIN to startRank 6 drops the whole branch (merge + chain
  // below it) by ~1 row, creating a tier-divider-like gap before MAIN.
  'hspu.main': { startRank: 6 },

  // OAPU: BAND is an independent leaf branch — without a bound it auto-spreads
  // to fill the full tier height, dragging "3 OAPU with light band" all the way
  // down to row 7. Capping endRank at 4 lines its last node up with the other
  // side branches' last nodes (12 sec Active Hold / 3 Negative OAPU x5 sec).
  'oapu.band': { endRank: 4 },

  // OAPU: MAIN floating branch — same treatment as HSPU. Push it down so the
  // "MAIN" label isn't overlapping the row-4 endings of NEGATIVE / ACTIVE HOLD.
  'oapu.main': { startRank: 6 },
};
const DEFAULT_BRANCH_LAYOUT = { startFrac: 0, endFrac: 1 };

// Class III (order_index 2) is the first class to use a TIER concept. Tiers are
// detected structurally within a tier-enabled class — but the class gate below
// prevents Class I/II (whose multi-branch convergences look identical) from
// rendering a divider. Future tiered classes (IV+) clear this threshold too.
const TIER_MIN_CLASS_ORDER = 2;

// Tier 2 = every tier-crossing convergence node (is_convergence with prereqs
// spanning 2+ branches) plus all of its descendants. Returns a Set of quest ids.
function computeTier2Set(quests) {
  const idMap = new Map(quests.map(q => [q.id, q]));

  const seeds = quests.filter(q => {
    if (q.is_convergence !== true) return false;
    const prereqs = (q.prerequisites ?? []).filter(p => idMap.has(p));
    const parentBranches = new Set(prereqs.map(p => idMap.get(p).branch));
    return parentBranches.size >= 2;
  });

  const childrenOf = new Map();
  quests.forEach(q => {
    (q.prerequisites ?? []).forEach(pid => {
      if (!childrenOf.has(pid)) childrenOf.set(pid, []);
      childrenOf.get(pid).push(q.id);
    });
  });

  const tier2 = new Set(seeds.map(s => s.id));
  const stack = [...tier2];
  while (stack.length) {
    const id = stack.pop();
    (childrenOf.get(id) ?? []).forEach(cid => {
      if (!tier2.has(cid)) { tier2.add(cid); stack.push(cid); }
    });
  }
  return tier2;
}

// Handstand-specific layout constants — narrower columns, fixed split offset
const HS_NODE_W       = 400;
const HS_COL_GAP      = 56;
const HS_SPLIT_OFFSET = 230;

// ─── Handstand layout — strict 3-column tree with intra-branch splits ─────────
//
// Rules (Handstand only):
//   • Rank = max(parent ranks) + 1; nodes with no parents = rank 0
//   • Each branch maps to one fixed column X based on BRANCH_ORDER
//   • Default node X = branch column center
//   • Intra-branch split: when 2+ same-branch nodes share the exact same single
//     prereq, they're rendered ±HS_SPLIT_OFFSET from branch center. Descendants
//     inherit that offset until a merge resets it.
//   • Merge (intra-branch convergence with all parents in same branch) snaps
//     back to branch center.
//   • Cross-branch convergence (parents from 2+ branches) sits at its own
//     branch column center — no offset.

function computeHandstandLayout(quests, { applyTiers = false } = {}) {
  if (quests.length === 0) {
    return {
      positions: {}, firstNodeOfBranch: {},
      width: 0, height: 0,
    };
  }

  const idMap = new Map(quests.map(q => [q.id, q]));

  // Step 1 — rank via topological sort
  const rankOf = {};
  const remaining = [...quests];
  let guard = quests.length * 2 + 5;
  while (remaining.length && guard-- > 0) {
    for (let i = remaining.length - 1; i >= 0; i--) {
      const q = remaining[i];
      const prereqs = (q.prerequisites ?? []).filter(p => idMap.has(p));
      if (prereqs.every(p => p in rankOf)) {
        rankOf[q.id] = prereqs.length === 0
          ? 0
          : Math.max(...prereqs.map(p => rankOf[p])) + 1;
        remaining.splice(i, 1);
      }
    }
  }
  quests.forEach(q => { if (!(q.id in rankOf)) rankOf[q.id] = 0; });
  const maxRank = Math.max(0, ...Object.values(rankOf));

  // Step 2 — branch → column index
  const allBranches = [...new Set(quests.map(q => q.branch).filter(Boolean))];
  const known   = BRANCH_ORDER.filter(b => allBranches.includes(b));
  const unknown = allBranches.filter(b => !BRANCH_ORDER.includes(b)).sort();
  const branches = [...known, ...unknown];

  const colIndex = {};
  branches.forEach((b, i) => { colIndex[b] = i; });
  const colCenterX = (b) =>
    (colIndex[b] ?? 0) * (HS_NODE_W + HS_COL_GAP) + HS_NODE_W / 2;

  const numBranches = branches.length;
  const treeWidth   =
    numBranches * HS_NODE_W + Math.max(0, numBranches - 1) * HS_COL_GAP;

  // Step 3 — detect intra-branch single-parent split children:
  //   2+ nodes in the same branch sharing the exact same single prereq
  //   (and the prereq lives in the same branch).
  const sameBranchSoleParent = {}; // qid → parent id
  quests.forEach(q => {
    const prereqs = (q.prerequisites ?? []).filter(p => idMap.has(p));
    if (prereqs.length !== 1) return;
    const parent = idMap.get(prereqs[0]);
    if (parent && parent.branch === q.branch) {
      sameBranchSoleParent[q.id] = prereqs[0];
    }
  });
  const sharedCount = {};
  Object.values(sameBranchSoleParent).forEach(pid => {
    sharedCount[pid] = (sharedCount[pid] ?? 0) + 1;
  });
  const isSplitChild = new Set(
    Object.entries(sameBranchSoleParent)
      .filter(([, pid]) => sharedCount[pid] >= 2)
      .map(([qid]) => qid)
  );

  // Step 4 — compute per-node X offset relative to its branch center
  const offsetOf = {};

  for (let r = 0; r <= maxRank; r++) {
    const rankQuests = quests.filter(q => (rankOf[q.id] ?? 0) === r);

    // Group split children by their shared parent
    const splitGroups = new Map();
    rankQuests.forEach(q => {
      if (!isSplitChild.has(q.id)) return;
      const pid = sameBranchSoleParent[q.id];
      if (!splitGroups.has(pid)) splitGroups.set(pid, []);
      splitGroups.get(pid).push(q);
    });

    const placed = new Set();

    // Place split children at ±HS_SPLIT_OFFSET, sorted by order_index then name
    splitGroups.forEach(group => {
      const sorted = [...group].sort((a, b) =>
        (a.order_index ?? 0) - (b.order_index ?? 0) ||
        (a.name ?? '').localeCompare(b.name ?? '')
      );
      const k = sorted.length;
      if (k === 2) {
        offsetOf[sorted[0].id] = -HS_SPLIT_OFFSET;
        offsetOf[sorted[1].id] = +HS_SPLIT_OFFSET;
      } else {
        // Generalize to k > 2: spread evenly, centered on 0
        const span = (k - 1) * HS_SPLIT_OFFSET;
        sorted.forEach((q, i) => {
          offsetOf[q.id] = -span / 2 + i * HS_SPLIT_OFFSET;
        });
      }
      sorted.forEach(q => placed.add(q.id));
    });

    // Everything else
    rankQuests.forEach(q => {
      if (placed.has(q.id)) return;

      const prereqs = (q.prerequisites ?? []).filter(p => idMap.has(p));

      if (prereqs.length === 0) {
        offsetOf[q.id] = 0;
        return;
      }

      const parentBranches = new Set(prereqs.map(p => idMap.get(p).branch));
      const isCrossBranch  = parentBranches.size >= 2;

      const isIntraBranchMerge =
        q.is_convergence === true &&
        prereqs.length >= 2 &&
        parentBranches.size === 1 &&
        [...parentBranches][0] === q.branch;

      if (isCrossBranch || isIntraBranchMerge) {
        // Snap back to branch center
        offsetOf[q.id] = 0;
        return;
      }

      // Single same-branch parent (not a split child) → inherit offset
      if (prereqs.length === 1) {
        const parent = idMap.get(prereqs[0]);
        offsetOf[q.id] =
          parent.branch === q.branch ? (offsetOf[prereqs[0]] ?? 0) : 0;
        return;
      }

      // Multiple parents, all same branch, but not flagged convergence
      // → average their offsets (descendants of an unmarked merge)
      const offs = prereqs.map(p => offsetOf[p] ?? 0);
      offsetOf[q.id] = offs.reduce((s, v) => s + v, 0) / offs.length;
    });
  }

  // Step 5 — build positions. A tier-crossing convergence (and its descendants)
  // get pushed down by TIER_GAP so the TIER divider has breathing room.
  const tier2Set = applyTiers ? computeTier2Set(quests) : new Set();
  let firstTier2Rank = Infinity;
  quests.forEach(q => {
    if (tier2Set.has(q.id)) firstTier2Rank = Math.min(firstTier2Rank, rankOf[q.id] ?? 0);
  });
  const rankY = (r) =>
    TREE_PAD_T + LABEL_H + r * (NODE_H + RANK_GAP) +
    (r >= firstTier2Rank ? TIER_GAP : 0);
  const positions = {};
  quests.forEach(q => {
    const r  = rankOf[q.id] ?? 0;
    const cx = colCenterX(q.branch ?? branches[0]) + (offsetOf[q.id] ?? 0);
    positions[q.id] = {
      x: cx - HS_NODE_W / 2,
      y: rankY(r),
      w: HS_NODE_W,
      h: nodeHeightFor(q.name, HS_NODE_W),
      rank: r,
    };
  });

  // Branch labels — first (lowest-rank) node of each branch
  const firstNodeOfBranch = {};
  quests.forEach(q => {
    if (q.branch == null) return;
    const r = rankOf[q.id] ?? 0;
    const cur = firstNodeOfBranch[q.branch];
    if (!cur || r < (rankOf[cur.id] ?? 0)) firstNodeOfBranch[q.branch] = q;
  });

  // For label positioning: anchor on branch column center (not the first
  // node's possibly-offset x), since labels describe the column itself.
  const labelXOf = {};
  Object.keys(firstNodeOfBranch).forEach(b => {
    labelXOf[b] = colCenterX(b) - HS_NODE_W / 2;
  });

  // Normalize horizontal extent — split children sit ±HS_SPLIT_OFFSET from their
  // branch center and can fall outside [0, treeWidth] (even at negative x on the
  // leftmost column). The SVG is sized to `width`, so out-of-band connector lines
  // would be CLIPPED. Shift nodes + labels so the leftmost node sits at 0 and
  // widen `width` to the true content box.
  let minX = Infinity, maxX = -Infinity;
  Object.values(positions).forEach(p => {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x + p.w);
  });
  let width = treeWidth;
  if (minX !== Infinity && (minX < 0 || maxX > treeWidth)) {
    const shift = -minX;
    Object.values(positions).forEach(p => { p.x += shift; });
    Object.keys(labelXOf).forEach(b => { labelXOf[b] += shift; });
    width = maxX - minX;
  }

  let maxBottom = 0;
  Object.values(positions).forEach(p => { maxBottom = Math.max(maxBottom, p.y + p.h); });
  const height = maxBottom + TREE_PAD_T;

  return {
    positions, firstNodeOfBranch, labelXOf,
    width, height,
    nodeWidth: HS_NODE_W,
  };
}

// ─── Layout engine — column-anchored, convergence-only centering ──────────────

function computeLayout(quests, { applyTiers = false, chain = null } = {}) {
  if (quests.length === 0) {
    return {
      positions: {}, firstNodeOfBranch: {},
      rankY: () => 0, width: 0, height: 0,
    };
  }

  const idMap = new Map(quests.map(q => [q.id, q]));
  const branchPriority = b => {
    const i = BRANCH_ORDER.indexOf(b ?? 'main');
    return i === -1 ? 999 : i;
  };

  // Step 1 — rank via topological sort. Empty prereqs (or NULL) → rank 0.
  const rankOf = {};
  const remaining = [...quests];
  let guard = quests.length * 2 + 5;
  while (remaining.length && guard-- > 0) {
    for (let i = remaining.length - 1; i >= 0; i--) {
      const q = remaining[i];
      const prereqs = (q.prerequisites ?? []).filter(p => idMap.has(p));
      if (prereqs.every(p => p in rankOf)) {
        rankOf[q.id] = prereqs.length === 0
          ? 0
          : Math.max(...prereqs.map(p => rankOf[p])) + 1;
        remaining.splice(i, 1);
      }
    }
  }
  quests.forEach(q => { if (!(q.id in rankOf)) rankOf[q.id] = 0; });
  const maxRank = Math.max(0, ...Object.values(rankOf));

  // Step 2 — flag every node whose ancestor chain contains a convergence.
  //          A node is "post-conv" if any transitive prereq is is_convergence.
  const isPostConv = {};
  function checkPost(qid) {
    if (qid in isPostConv) return isPostConv[qid];
    const q = idMap.get(qid);
    if (!q) return (isPostConv[qid] = false);
    const prereqs = (q.prerequisites ?? []).filter(p => idMap.has(p));
    for (const pid of prereqs) {
      const par = idMap.get(pid);
      if (par.is_convergence || checkPost(pid)) return (isPostConv[qid] = true);
    }
    return (isPostConv[qid] = false);
  }
  quests.forEach(q => checkPost(q.id));

  // Step 2b — single-parent split detection.
  //   A node is a "split child" when it has exactly 1 prereq (not convergence,
  //   not post-conv) AND that prereq has 2+ such sole-child nodes.
  const soleParentOf = {};
  quests.forEach(q => {
    const prereqs = (q.prerequisites ?? []).filter(p => idMap.has(p));
    if (prereqs.length === 1 && !q.is_convergence && !isPostConv[q.id])
      soleParentOf[q.id] = prereqs[0];
  });
  const soleChildCount = {};
  Object.values(soleParentOf).forEach(pid => {
    soleChildCount[pid] = (soleChildCount[pid] ?? 0) + 1;
  });
  const isSplitChild = new Set(
    quests
      .filter(q => soleParentOf[q.id] && soleChildCount[soleParentOf[q.id]] >= 2)
      .map(q => q.id)
  );

  // Step 2c — split DESCENDANTS: a sole-child chain hanging off a split child.
  //   These must keep floating on their parent's X (staying in the split lane)
  //   instead of snapping back to the branch column center. Without this, two
  //   lanes' tips (e.g. PULL's "16 Pull-ups" and "12 Mix Grip") both collapse to
  //   the shared branch center and render on top of each other. Mirrors the
  //   handstand layout, which already propagates split offsets to descendants.
  //   Chain stops at a convergence / post-conv node (those re-center on merge).
  const isSplitDescendant = new Set();
  {
    let changed = true;
    while (changed) {
      changed = false;
      quests.forEach(q => {
        if (isSplitChild.has(q.id) || isSplitDescendant.has(q.id)) return;
        if (q.is_convergence || isPostConv[q.id]) return;
        const prereqs = (q.prerequisites ?? []).filter(p => idMap.has(p));
        if (prereqs.length !== 1) return;
        const p = prereqs[0];
        if (isSplitChild.has(p) || isSplitDescendant.has(p)) {
          isSplitDescendant.add(q.id);
          changed = true;
        }
      });
    }
  }

  // Branches that START with a split child — the whole branch floats on parent X
  // rather than occupying a fixed column slot. Determined by the lowest-rank node.
  const splitOnlyBranches = new Set(
    [...new Set(quests.map(q => q.branch).filter(Boolean))].filter(b => {
      const bNodes = quests.filter(q => q.branch === b);
      if (bNodes.length === 0) return false;
      const minRank = Math.min(...bNodes.map(q => rankOf[q.id] ?? 0));
      return bNodes
        .filter(q => (rankOf[q.id] ?? 0) === minRank)
        .every(q => isSplitChild.has(q.id));
    })
  );

  // Step 3 — column slots: every distinct NON-MAIN, NON-SPLIT branch.
  const allBranches = new Set(quests.map(q => q.branch).filter(b => b != null));

  // A "floating" branch is one whose nodes are ALL convergence / post-conv /
  // split children — i.e. it never owns a plain column node. Such a branch (e.g.
  // the hs_beginners "mixed" merge of tuck + straddle) is rendered centered on
  // its parents, so reserving a column slot for it just leaves an empty gap.
  // Excluding it collapses that gap.
  const branchHasColNode = {};
  quests.forEach(q => {
    const eligible =
      !q.is_convergence && !isPostConv[q.id] &&
      !isSplitChild.has(q.id) && !isSplitDescendant.has(q.id) &&
      !splitOnlyBranches.has(q.branch);
    if (eligible && q.branch != null) branchHasColNode[q.branch] = true;
  });
  const floatingBranches = new Set(
    [...allBranches].filter(b => !branchHasColNode[b])
  );

  // 'main' gets a real column too — BRANCH_ORDER centers it among its flanking
  // branches. Previously main floated at the tree midpoint, which dropped the
  // (now wide) main spine into the gap between two side columns and overlapped
  // both. As a column it is cleanly spaced like every other branch.
  const colBranches = [...allBranches].filter(
    b => !splitOnlyBranches.has(b) && !floatingBranches.has(b)
  );
  const known   = BRANCH_ORDER.filter(b => colBranches.includes(b));
  const unknown = colBranches.filter(b => !BRANCH_ORDER.includes(b)).sort();
  const branches = [...known, ...unknown];
  if (branches.length === 0) branches.push('main'); // pure-convergence fallback

  const colIndex = {};
  branches.forEach((b, i) => { colIndex[b] = i; });
  const colCenterX = (b) => (colIndex[b] ?? 0) * (NODE_W + COL_GAP) + NODE_W / 2;

  const numBranches  = branches.length;
  const treeWidth    = numBranches * NODE_W + Math.max(0, numBranches - 1) * COL_GAP;
  // Convergence sub-tracks center on the MAIN spine when one exists (so merges
  // sit directly beneath it); otherwise on the whole tree.
  const hasMainCol   = branches.includes('main');
  const chainAnchorX = hasMainCol ? colCenterX('main') : treeWidth / 2;

  // Step 4 — place nodes rank-by-rank so parents are positioned before children.
  //
  //   • Pre-conv non-conv          → branch column slot (main → chainAnchorX)
  //   • Convergence or post-conv:
  //       group by sorted prereq UUID set:
  //       - group size > 1 (sub-track)  → side by side, centered on chainAnchorX,
  //                                        sorted by branch priority then order_index
  //       - group size = 1              → centered between parent positions
  //                                        (a single-prereq node thus inherits its
  //                                        parent's x — sub-track continues straight)
  // ── Tier-aware vertical spread (Tier 1 column branches) ─────────────────────
  // Within Tier 1, distribute each column branch's chain evenly across the FULL
  // height of the tier, so a short branch (e.g. Planche NEGATIVE / PRESS — 3
  // nodes) spreads out to match the longest branch (HOLD) instead of bunching at
  // the top and leaving dead space below. Only plain column nodes are spread;
  // convergence / merge nodes keep their topological rank.
  const tier2Set = applyTiers ? computeTier2Set(quests) : new Set();
  const inTier2  = id => tier2Set.has(id);

  let firstTier2Rank = Infinity;
  let tier1MaxRank   = 0;
  quests.forEach(q => {
    const r = rankOf[q.id] ?? 0;
    if (inTier2(q.id)) firstTier2Rank = Math.min(firstTier2Rank, r);
    else               tier1MaxRank   = Math.max(tier1MaxRank, r);
  });

  const colBranchSet = new Set(branches);
  const effRank = {};
  quests.forEach(q => { effRank[q.id] = rankOf[q.id] ?? 0; });

  // TEMP DIAG — remove once branch-layout matching is confirmed.
  if (typeof console !== 'undefined') {
    console.log('[QuestTreeScreen] chain =', JSON.stringify(chain));
    console.log('[QuestTreeScreen] branches =', JSON.stringify(branches));
    console.log('[QuestTreeScreen] floating =', JSON.stringify([...floatingBranches]));
    [...new Set(quests.map(q => q.branch))].forEach(b => {
      const key = `${chain}.${b}`.toLowerCase();
      console.log('[QuestTreeScreen] cfg', JSON.stringify(key), '→', JSON.stringify(BRANCH_LAYOUT[key] ?? null));
    });
  }

  // Child lookup — keeps spreading safe: a branch that feeds an intra-tier
  // convergence (or the main spine) must NOT be stretched, or its leaf could
  // slide BELOW the fixed-rank merge node and invert the connector.
  const childrenOf = new Map();
  quests.forEach(q => (q.prerequisites ?? []).forEach(pid => {
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid).push(q.id);
  }));

  const spreadGroups = new Map(); // branch → tier-1 column nodes
  quests.forEach(q => {
    if (inTier2(q.id)) return;
    const isCol =
      !q.is_convergence && !isPostConv[q.id] &&
      !isSplitChild.has(q.id) && !isSplitDescendant.has(q.id) &&
      !splitOnlyBranches.has(q.branch) &&
      colBranchSet.has(q.branch) && q.branch !== 'main';
    if (!isCol) return;
    if (!spreadGroups.has(q.branch)) spreadGroups.set(q.branch, []);
    spreadGroups.get(q.branch).push(q);
  });
  spreadGroups.forEach((group, branch) => {
    if (tier1MaxRank <= 0) return;

    const ids    = new Set(group.map(n => n.id));
    const sorted = group.sort((a, b) => (rankOf[a.id] ?? 0) - (rankOf[b.id] ?? 0));
    const k      = sorted.length;

    // A branch is an "independent leaf" when every child of every node stays in
    // this same branch or crosses into Tier 2 — i.e. it feeds no merge. Only such
    // branches can be freely spread; a branch that feeds a convergence must stay
    // near its natural ranks so its connector can't invert.
    const independent = group.every(n =>
      (childrenOf.get(n.id) ?? []).every(cid => ids.has(cid) || inTier2(cid))
    );

    const cfg = BRANCH_LAYOUT[`${chain}.${branch}`.toLowerCase()];
    // Absolute *Rank wins over *Frac; both resolve to an effRank in [0, max].
    const resolve = (rank, frac, fracDflt) =>
      rank != null
        ? Math.max(0, Math.min(tier1MaxRank, rank))
        : Math.max(0, Math.min(1, frac ?? fracDflt)) * tier1MaxRank;

    if (independent && k > 1) {
      // Spread evenly across [start, end] of the tier (default = full height),
      // ordered so a bad config can't invert.
      const c = cfg ?? DEFAULT_BRANCH_LAYOUT;
      let startR = resolve(c.startRank, c.startFrac, 0);
      let endR   = resolve(c.endRank,   c.endFrac,   1);
      if (endR < startR) [startR, endR] = [endR, startR];
      sorted.forEach((q, i) => { effRank[q.id] = startR + (i * (endR - startR)) / (k - 1); });
      return;
    }

    // Rank-locked branch (feeds a merge): move it ONLY if explicitly configured.
    // Rigid downward shift so the first node lands at `start` while internal
    // spacing is preserved; `end` is ignored. Clamped so the last node can't
    // reach an external child's row (which would invert that connector).
    if (!cfg) return;
    const startR       = resolve(cfg.startRank, cfg.startFrac, 0);
    const firstNatural = rankOf[sorted[0].id] ?? 0;
    let   shift        = startR - firstNatural;

    let maxLastRank = Infinity;
    sorted.forEach(n => (childrenOf.get(n.id) ?? []).forEach(cid => {
      if (!ids.has(cid)) maxLastRank = Math.min(maxLastRank, (rankOf[cid] ?? Infinity) - 1);
    }));
    const lastNatural = rankOf[sorted[k - 1].id] ?? 0;
    if (maxLastRank !== Infinity) shift = Math.min(shift, maxLastRank - lastNatural);
    if (shift <= 0) return;

    sorted.forEach(n => { effRank[n.id] = (rankOf[n.id] ?? 0) + shift; });
  });

  // ── Floating branches (no fixed column) — rigid shift only ─────────────────
  // A floating branch is one whose every node is a convergence / post-conv (so
  // it never owns a plain column slot — e.g. HSPU's MAIN, which begins with the
  // multi-branch merge). It's not in spreadGroups, so handle it separately: shift
  // every node by the same delta so the whole branch (merge + chain below it)
  // drops to the requested start row. Useful for adding breathing room before
  // a merge in an untiered chain (HSPU has no TIER divider).
  const maxAnyRank = Math.max(0, ...Object.values(rankOf));
  floatingBranches.forEach(branch => {
    if (branch == null) return;
    const cfg = BRANCH_LAYOUT[`${chain}.${branch}`.toLowerCase()];
    if (!cfg) return;

    const group = quests.filter(q => q.branch === branch);
    if (group.length === 0) return;
    const sorted = [...group].sort((a, b) => (rankOf[a.id] ?? 0) - (rankOf[b.id] ?? 0));
    const ids = new Set(sorted.map(n => n.id));

    const startR = cfg.startRank != null
      ? Math.max(0, Math.min(maxAnyRank, cfg.startRank))
      : Math.max(0, Math.min(1, cfg.startFrac ?? 0)) * maxAnyRank;
    const firstNatural = rankOf[sorted[0].id] ?? 0;
    let shift = startR - firstNatural;

    // Clamp against any external child (uncommon for floating branches since
    // they typically end the chain, but keep the guard so a bad config can't
    // invert a downstream connector).
    let maxLastRank = Infinity;
    sorted.forEach(n => (childrenOf.get(n.id) ?? []).forEach(cid => {
      if (!ids.has(cid)) maxLastRank = Math.min(maxLastRank, (rankOf[cid] ?? Infinity) - 1);
    }));
    const lastNatural = rankOf[sorted[sorted.length - 1].id] ?? 0;
    if (maxLastRank !== Infinity) shift = Math.min(shift, maxLastRank - lastNatural);
    if (shift <= 0) return;

    sorted.forEach(n => { effRank[n.id] = (rankOf[n.id] ?? 0) + shift; });
  });

  // Tier 2 nodes drop by an extra TIER_GAP to give the divider breathing room.
  const rankY = (r) =>
    TREE_PAD_T + LABEL_H + r * (NODE_H + RANK_GAP) +
    (r >= firstTier2Rank ? TIER_GAP : 0);
  const positions = {};

  for (let r = 0; r <= maxRank; r++) {
    const rankQuests = quests.filter(q => (rankOf[q.id] ?? 0) === r);

    const colNodes   = [];
    const groupNodes = [];
    rankQuests.forEach(q => {
      // Nodes go to colNodes only when they're pre-conv, not a split child,
      // and not in a split-only branch (descendants of split children that
      // haven't re-converged yet must also float on parent X).
      if (
        !q.is_convergence &&
        !isPostConv[q.id] &&
        !isSplitChild.has(q.id) &&
        !isSplitDescendant.has(q.id) &&
        !splitOnlyBranches.has(q.branch)
      ) {
        colNodes.push(q);
      } else {
        groupNodes.push(q);
      }
    });

    // Pre-conv non-split → branch column slot (main is now a column too)
    colNodes.forEach(q => {
      const cx = colCenterX(q.branch ?? branches[0]);
      positions[q.id] = { x: cx - NODE_W / 2, y: rankY(effRank[q.id]), w: NODE_W, h: nodeHeightFor(q.name, NODE_W), rank: r };
    });

    // Group conv / post-conv / split-child nodes by their (sorted) prereq UUID set
    const groups = new Map();
    groupNodes.forEach(q => {
      const key = (q.prerequisites ?? [])
        .filter(p => idMap.has(p)).slice().sort().join(',');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(q);
    });

    for (const [key, group] of groups.entries()) {
      const prereqIds = key ? key.split(',') : [];

      if (group.length === 1) {
        // Single node — inherit mean of positioned parent Xs
        const q = group[0];
        const parentCXs = prereqIds
          .filter(p => positions[p])
          .map(p => positions[p].x + NODE_W / 2);
        let cx;
        if (parentCXs.length > 0) {
          cx = parentCXs.reduce((s, v) => s + v, 0) / parentCXs.length;
        } else {
          cx = colCenterX(q.branch ?? branches[0]);
        }
        positions[q.id] = { x: cx - NODE_W / 2, y: rankY(effRank[q.id]), w: NODE_W, h: nodeHeightFor(q.name, NODE_W), rank: r };
      } else {
        // Multiple nodes sharing the same prereq set:
        //   • 1 shared prereq → single-parent split → center on that parent's X
        //   • 2+ shared prereqs → convergence sub-track → center on chainAnchorX
        const isSingleParentSplit = prereqIds.length === 1;
        const anchorX = (isSingleParentSplit && positions[prereqIds[0]])
          ? positions[prereqIds[0]].x + NODE_W / 2
          : chainAnchorX;

        const sorted = [...group].sort((a, b) => {
          const d = branchPriority(a.branch) - branchPriority(b.branch);
          if (d !== 0) return d;
          return (a.order_index ?? 0) - (b.order_index ?? 0);
        });
        const k      = sorted.length;
        const totalW = k * NODE_W + (k - 1) * COL_GAP;
        const leftX  = anchorX - totalW / 2;
        sorted.forEach((q, i) => {
          const cx = leftX + i * (NODE_W + COL_GAP) + NODE_W / 2;
          positions[q.id] = { x: cx - NODE_W / 2, y: rankY(effRank[q.id]), w: NODE_W, h: nodeHeightFor(q.name, NODE_W), rank: r };
        });
      }
    }
  }

  // Labels — above the FIRST node of each branch, at that node's actual x
  const firstNodeOfBranch = {};
  quests.forEach(q => {
    if (q.branch == null) return;
    const r = rankOf[q.id] ?? 0;
    const cur = firstNodeOfBranch[q.branch];
    if (!cur || r < (rankOf[cur.id] ?? 0)) firstNodeOfBranch[q.branch] = q;
  });

  // Normalize horizontal extent — convergence sub-tracks (and split children)
  // can land outside the nominal [0, treeWidth] column band, even at negative x.
  // e.g. a Tier-2 side chain whose every branch starts with a cross-chain
  // convergence: all branches "float", treeWidth collapses to one column, yet
  // the merge nodes spread wider. The SVG is sized to `width`, so anything past
  // that band has its connector lines CLIPPED. Shift all nodes so the leftmost
  // sits at 0 and widen `width` to the true content box.
  let minX = Infinity, maxX = -Infinity;
  Object.values(positions).forEach(p => {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x + p.w);
  });
  let width = treeWidth;
  if (minX !== Infinity && (minX < 0 || maxX > treeWidth)) {
    const shift = -minX;
    Object.values(positions).forEach(p => { p.x += shift; });
    width = maxX - minX;
  }

  let maxBottom = 0;
  Object.values(positions).forEach(p => { maxBottom = Math.max(maxBottom, p.y + p.h); });
  const height = maxBottom + TREE_PAD_T;

  return { positions, firstNodeOfBranch, rankY, width, height };
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function QuestTreeScreen({ route, navigation }) {
  const { classId, chain, questType } = route.params;

  const [quests,      setQuests]      = useState([]);
  const [completions, setCompletions] = useState(new Set());
  const [loading,     setLoading]     = useState(true);
  const [hasTiers,    setHasTiers]    = useState(false);
  const [classOrder,  setClassOrder]  = useState(0);
  const [studentId,   setStudentId]   = useState(null);
  const [pendingQuest, setPendingQuest] = useState(null);
  const [toggling,     setToggling]     = useState(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setStudentId(user.id);

      const [qRes, cRes, clsRes] = await Promise.all([
        supabase
          .from('class_quests')
          .select('*')
          .eq('class_id', classId)
          .eq('chain', chain)
          .eq('quest_type', questType)
          .order('branch')
          .order('order_index'),
        supabase
          .from('student_quest_completions')
          .select('quest_id')
          .eq('student_id', user.id),
        supabase
          .from('classes')
          .select('order_index')
          .eq('id', classId)
          .single(),
      ]);

      setQuests(qRes.data ?? []);
      setCompletions(new Set((cRes.data ?? []).map(c => c.quest_id)));
      const order = clsRes.data?.order_index ?? 0;
      setClassOrder(order);
      setHasTiers(order >= TIER_MIN_CLASS_ORDER);
    } catch (e) {
      console.error('[QuestTreeScreen]', e);
    }
    setLoading(false);
  }, [classId, chain, questType]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]));

  // ── Layout ────────────────────────────────────────────────────────────────

  // Tiers are an intentional MAIN-quest concept. Side quests must never render a
  // TIER divider — their multi-branch merges (e.g. hs_beginners tuck+straddle)
  // look identical to a tier crossing but are not one.
  const applyTiers = hasTiers && questType === 'main';

  // Nodes that are MAIN-quest prestige requirements for this class — highlighted
  // with a live animated frame (blue while unmet, gold once completed).
  const requiredIds = useMemo(
    () => requiredMainQuestIds(classOrder, quests),
    [classOrder, quests],
  );

  const { positions, firstNodeOfBranch, labelXOf, width, height, nodeWidth } =
    useMemo(
      () => chain === 'handstand'
        ? computeHandstandLayout(quests, { applyTiers })
        : computeLayout(quests, { applyTiers, chain }),
      [quests, chain, applyTiers],
    );

  // ── Tier divider ──────────────────────────────────────────────────────────
  // Decorative "TIER II" rule placed in the existing inter-rank gap between the
  // last Tier 1 row and the first Tier 2 row. Only for tier-enabled classes.

  const tierDividerY = useMemo(() => {
    if (!applyTiers) return null;
    const tier2 = computeTier2Set(quests);
    if (tier2.size === 0) return null;

    let lastT1Bottom = -Infinity;
    let firstT2Top   =  Infinity;
    quests.forEach(q => {
      const p = positions[q.id];
      if (!p) return;
      if (tier2.has(q.id)) firstT2Top   = Math.min(firstT2Top, p.y);
      else                 lastT1Bottom = Math.max(lastT1Bottom, p.y + p.h);
    });
    if (lastT1Bottom === -Infinity || firstT2Top === Infinity) return null;

    // Centered in the (TIER_GAP-enlarged) gap → even breathing room above & below.
    return (lastT1Bottom + firstT2Top) / 2;
  }, [applyTiers, quests, positions]);

  // ── Node state ────────────────────────────────────────────────────────────

  function nodeState(quest) {
    if (completions.has(quest.id)) return 'done';
    const pre = quest.prerequisites ?? [];
    return pre.every(id => completions.has(id)) ? 'unlocked' : 'locked';
  }

  // ── Toggle (self-coach: the player controls their own level) ────────────────

  async function toggleQuest(quest) {
    if (!studentId) return;
    setToggling(true);
    const done = completions.has(quest.id);
    try {
      if (done) {
        const { error: delErr } = await supabase
          .from('student_quest_completions')
          .delete()
          .eq('student_id', studentId)
          .eq('quest_id', quest.id);
        if (delErr) throw delErr;
        setCompletions(prev => { const s = new Set(prev); s.delete(quest.id); return s; });
      } else {
        const { error: insErr } = await supabase
          .from('student_quest_completions')
          .insert({ student_id: studentId, quest_id: quest.id });
        if (insErr) throw insErr;
        setCompletions(prev => new Set([...prev, quest.id]));
      }
    } catch (e) {
      console.error('[QuestTreeScreen] toggleQuest:', e);
    }
    setToggling(false);
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  const doneCount = quests.filter(q => completions.has(q.id)).length;
  const earnedLvl = quests
    .filter(q => completions.has(q.id))
    .reduce((s, q) => s + (q.lvl_reward ?? 0), 0);

  // ── Lines (orthogonal, bend near child) ───────────────────────────────────

  function buildLines() {
    return quests.flatMap(q => {
      const prereqs = q.prerequisites ?? [];
      return prereqs.map(pid => {
        const child  = positions[q.id];
        const parent = positions[pid];
        if (!child || !parent) return null;

        const done  = completions.has(q.id) && completions.has(pid);
        const state = nodeState(q);
        const color = (done || state === 'unlocked') ? SL.accent : SL.muted;

        const px = parent.x + parent.w / 2;
        const py = parent.y + parent.h;
        const cx = child.x + child.w / 2;
        const cy = child.y;

        let d;
        if (Math.abs(px - cx) < 0.5) {
          // Same column — straight vertical drop
          d = `M ${px} ${py} L ${cx} ${cy}`;
        } else {
          // Drop in parent column to BEND_NEAR_CHILD above child top, then jog
          // sideways and drop into child top. Bend is "as late as possible".
          const bendY = cy - BEND_NEAR_CHILD;
          d = `M ${px} ${py} L ${px} ${bendY} L ${cx} ${bendY} L ${cx} ${cy}`;
        }

        return (
          <Path
            key={`${pid}->${q.id}`}
            d={d}
            stroke={color}
            strokeWidth={1.5}
            fill="none"
            opacity={state === 'locked' ? 0.3 : 0.75}
          />
        );
      }).filter(Boolean);
    });
  }

  // ── Node ──────────────────────────────────────────────────────────────────

  function renderNode(quest) {
    const state      = nodeState(quest);
    const isDone     = state === 'done';
    const isLocked   = state === 'locked';
    const isRequired = requiredIds.has(quest.id);

    return (
      <TouchableOpacity
        style={[
          styles.questCard,
          isDone     && styles.questCardDone,
          isLocked   && styles.questCardLocked,
          isRequired && styles.questCardRequired,
        ]}
        disabled={isLocked || toggling}
        activeOpacity={isLocked ? 1 : 0.75}
        onPress={() => { if (!isLocked) setPendingQuest(quest); }}
      >
        {isRequired && (
          <ShimmerFrame
            style={[styles.questFrame, { shadowColor: SL.wine }]}
            colors={BORDEAUX}
            active
          />
        )}
        <Text
          style={[
            styles.questName,
            isDone   && styles.questNameDone,
            isLocked && styles.questNameLocked,
          ]}
          numberOfLines={nodeLineCount(quest.name, nodeWidth ?? NODE_W)}
        >
          {isLocked ? '🔒 ' : ''}{quest.name}
        </Text>

        <View style={styles.nodeBottom}>
          {isDone ? (
            <View style={styles.doneBadge}>
              <Text style={styles.doneBadgeText}>
                ✓ DONE{quest.lvl_reward > 0 ? ` · +${quest.lvl_reward}` : ''}
              </Text>
            </View>
          ) : quest.lvl_reward > 0 ? (
            <View style={[styles.rewardBadge, isLocked && { opacity: 0.4 }]}>
              <Text style={styles.rewardText}>+{quest.lvl_reward} LVL</Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={SL.accent} />
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const confirmBarVisible = pendingQuest !== null;

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.chainTitle}>
          {chain.replace(/_/g, ' ').toUpperCase()}
        </Text>
        <Text style={styles.chainSubtitle}>
          {questType === 'main' ? 'MAIN QUEST' : 'SIDE QUEST'}
        </Text>
        <Text style={styles.statsText}>
          {doneCount}/{quests.length} · +{earnedLvl} LVL earned
        </Text>
        <View style={styles.headerDivider} />
      </View>

      {/* Tree */}
      <ScrollView contentContainerStyle={[
        styles.scrollBody,
        confirmBarVisible && { paddingBottom: 160 },
      ]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingHorizontal: TREE_PAD_H,
          }}
        >
          <View style={styles.treeFrame}>
          <View style={{ width, height, position: 'relative' }}>

            {/* SVG connector lines (under nodes) */}
            <Svg
              width={width}
              height={height}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            >
              {buildLines()}
            </Svg>

            {/* Branch labels — above the FIRST node of each branch.
                Handstand anchors on the branch column center (labelXOf);
                other chains anchor on the first node's actual x. */}
            {Object.entries(firstNodeOfBranch).map(([branch, q]) => {
              const p = positions[q.id];
              if (!p) return null;
              const w   = nodeWidth ?? NODE_W;
              const lx  = labelXOf?.[branch] ?? p.x;
              return (
                <View
                  key={`label-${branch}`}
                  style={{
                    position: 'absolute',
                    left:  lx,
                    top:   p.y - LABEL_OFFSET,
                    width: w,
                    alignItems: 'center',
                  }}
                  pointerEvents="none"
                >
                  <Text style={styles.branchLabel}>
                    {branch.replace(/_/g, ' ').toUpperCase()}
                  </Text>
                </View>
              );
            })}

            {/* Tier divider — between Tier 1 and Tier 2 (tiered classes only) */}
            {tierDividerY != null && (
              <View
                style={[styles.tierDivider, { top: tierDividerY - 14, width }]}
                pointerEvents="none"
              >
                <View style={styles.tierLine} />
                <Text style={styles.tierLabel}>TIER II</Text>
                <View style={styles.tierLine} />
              </View>
            )}

            {/* Nodes */}
            {quests.map(q => {
              const p = positions[q.id];
              if (!p) return null;
              return (
                <View
                  key={q.id}
                  style={{
                    position: 'absolute',
                    left:   p.x,
                    top:    p.y,
                    width:  p.w,
                    height: p.h,
                  }}
                >
                  {renderNode(q)}
                </View>
              );
            })}

          </View>
          </View>
        </ScrollView>
      </ScrollView>

      {/* ── Confirmation bar ── */}
      {pendingQuest && (
        <View style={styles.confirmBar}>
          <Text style={styles.confirmText}>
            {completions.has(pendingQuest.id)
              ? `Remove "${pendingQuest.name}"? (−${pendingQuest.lvl_reward ?? 0} LVL)`
              : `Mark "${pendingQuest.name}" done? (+${pendingQuest.lvl_reward ?? 0} LVL)`
            }
          </Text>
          <View style={styles.confirmButtons}>
            <TouchableOpacity
              style={styles.confirmCancel}
              onPress={() => setPendingQuest(null)}
              disabled={toggling}
            >
              <Text style={styles.confirmCancelText}>CANCEL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.confirmOk}
              disabled={toggling}
              onPress={() => {
                const q = pendingQuest;
                setPendingQuest(null);
                toggleQuest(q);
              }}
            >
              {toggling
                ? <ActivityIndicator color={SL.bg} size="small" />
                : <Text style={styles.confirmOkText}>CONFIRM</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg, position: 'relative' },

  // Header
  header: {
    paddingHorizontal: 24,
    paddingTop: 56,
    paddingBottom: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: SL.border,
  },
  backBtn:  { alignSelf: 'flex-start', marginBottom: 12 },
  backText: { fontFamily: F.bodyMed, fontSize: 24, color: SL.accent, letterSpacing: 2 },
  chainTitle: {
    fontFamily: F.heading,
    fontSize: 66,
    color: SL.text,
    letterSpacing: 5,
    textAlign: 'center',
    // Ice-glow halo, matching the Home hero.
    textShadowColor: 'rgba(74,158,191,0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 22,
  },
  chainSubtitle: {
    fontFamily: F.bodyMed,
    fontSize: 26,
    color: SL.muted,
    letterSpacing: 3,
    marginTop: 6,
    textAlign: 'center',
  },
  statsText: {
    fontFamily: F.bodyMed,
    fontSize: 30,
    color: SL.muted,
    letterSpacing: 1,
    marginTop: 8,
    textAlign: 'center',
  },
  headerDivider: {
    height: 1,
    backgroundColor: SL.border,
    alignSelf: 'stretch',
    marginTop: 16,
    opacity: 0.5,
  },

  // Tree
  scrollBody: { paddingBottom: 60 },

  // Cool ice-glow frame wrapping the whole skill tree.
  treeFrame: {
    padding: 24,
    marginVertical: 18,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 20,
    backgroundColor: SL.bg,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 22,
  },

  // Column label
  branchLabel: {
    fontFamily: F.bodyMed,
    fontSize: 34,
    color: SL.accent,
    letterSpacing: 3,
    textAlign: 'center',
    opacity: 0.95,
    // Ice-glow so the branch headings pop.
    textShadowColor: 'rgba(74,158,191,0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },

  // Tier divider — full-width rule with centered label
  tierDivider: {
    position: 'absolute',
    left: 0,
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 24,
  },
  tierLine: {
    flex: 1,
    height: 2,
    backgroundColor: SL.accent,
    opacity: 0.5,
  },
  tierLabel: {
    fontFamily: F.heading,
    fontSize: 30,
    color: SL.accent,
    letterSpacing: 6,
    textAlign: 'center',
    textShadowColor: 'rgba(74,158,191,0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },

  // Quest cards — fill their absolutely-positioned wrapper so the layout
  // engine controls width (OAPU/HSPU = NODE_W, handstand = HS_NODE_W).
  questCard: {
    width: '100%',
    height: '100%',
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: '100%',
    // Subtle ice-glow on every node.
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  questCardDone: {
    backgroundColor: 'rgba(74,158,191,0.10)',
    borderColor: SL.accent,
    // Brighter glow on completed nodes — feels earned.
    shadowOpacity: 0.32,
    shadowRadius: 12,
  },
  // Live animated frame over prestige-requirement nodes — the BORDEAUX color
  // sweeps clockwise around the border (segments owned by ShimmerFrame; the
  // border here is drawn by that component via `thickness`, not borderWidth).
  questFrame: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },
  questCardLocked: {
    opacity: 0.45,
  },
  // Requirement nodes hand their border over to the bordeaux ShimmerFrame, so
  // the card's own blue border doesn't show through underneath it.
  questCardRequired: {
    borderColor: 'transparent',
  },

  // Node text
  questName: {
    fontFamily: F.heading,
    fontSize: 27,
    color: SL.text,
    letterSpacing: 0.6,
    lineHeight: 30,
    textAlign: 'center',
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 8,
  },
  questNameDone:   { color: SL.accent },
  questNameLocked: { color: SL.muted },

  // Badges
  nodeBottom: { alignSelf: 'center' },
  doneBadge: {
    backgroundColor: 'rgba(74,158,191,0.15)',
    borderWidth: 1,
    borderColor: SL.accent,
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  doneBadgeText: {
    fontFamily: F.heading,
    fontSize: 20,
    lineHeight: 22,
    color: SL.accent,
    letterSpacing: 1.5,
  },
  rewardBadge: {
    borderWidth: 1,
    borderColor: SL.accent,
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  rewardText: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    lineHeight: 22,
    color: SL.accent,
    letterSpacing: 1.2,
  },

  // ── Confirmation bar ──────────────────────────────────────────────────────────

  confirmBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: SL.panel,
    borderTopWidth: 2,
    borderTopColor: SL.accent,
    padding: 16,
    gap: 12,
  },
  confirmText: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.text,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  confirmCancel: {
    flex: 1,
    height: 40,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmCancelText: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.muted,
    letterSpacing: 2,
  },
  confirmOk: {
    flex: 1,
    height: 40,
    backgroundColor: SL.accent,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmOkText: {
    fontFamily: F.heading,
    fontSize: 14,
    color: SL.bg,
    letterSpacing: 2,
  },
});
