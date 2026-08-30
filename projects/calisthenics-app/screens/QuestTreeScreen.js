import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, Modal, Animated, Easing,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';
import { ShimmerFrame, ShimmerText, ShimmerFill, GOLD, BLUE } from '../components/Shimmer';
import PillButton from '../components/PillButton';
import { requiredMainQuestIds } from '../lib/prestige';
import { DEFAULT_JOB } from '../lib/jobs';
import { isRevealed, visibleQuests } from '../lib/hiddenQuests';
import { isMirrorQuest, withMirrorCompletions } from '../lib/mirrorQuests';
import {
  isCoachQuest, canToggleCoachQuest, questNodeLabel, questLayoutLabel,
} from '../lib/coachQuests';
import { useCoach } from '../context/CoachContext';
import {
  upgradeFor, baseOf, chainCleared, fetchUpgrades, saveUpgrade, removeUpgrade,
} from '../lib/questUpgrades';
import { hapticSuccess, hapticTap } from '../lib/haptics';
import { useAppInsets } from '../constants/layout';
import { FRAME_PAD, FRAME_PAD_V } from '../components/ScreenFrame';
import { noteQuestCompleted, noteQuestUncompleted, reconcileQuestProgress } from '../lib/questProgress';

// An SVG path whose props (here strokeDashoffset) can be driven by an Animated
// value — lets completed connectors carry a travelling "energy" dash.
const AnimatedPath = Animated.createAnimatedComponent(Path);

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
  // Coach approval — the brighter "approved" green the coach-owned nodes wear
  // (SL.green is the muted UI green and reads grey beside a lit node).
  approve: '#3BE87A',
  gold:   '#FFD700',
  wine:   '#E11D48',
};

// ─── Layout constants ─────────────────────────────────────────────────────────

const NODE_W       = 380;
// Wide node for single-column, info-dense quests (long names wrap to fewer lines).
const WIDE_NODE_W  = 680;
const NODE_H       = 76;
const COL_GAP      = 40;   // narrower: every unit here is one the nodes lose
const RANK_GAP     = 76;
const TIER_GAP     = 120;     // extra vertical room reserved around a TIER divider
const TREE_PAD_H   = 6;
const TREE_PAD_T   = 28;
const LABEL_H      = 48;
const LABEL_OFFSET = 58;
const TIER_RULE_H     = 40;   // divider row height — must clear the 30px TIER label
const TIER_LABEL_GAP  = 18;   // clear air between the TIER rule and a branch heading below it
// The reveal beat: how long the discovery of a hidden challenge waits after the
// tap that earned it, so the gold completion burst on the node the player DID
// tap gets its moment first, and the reveal reads as a consequence of it.
const REVEAL_DELAY    = 620;
// ─── The header HUD's entrance ───────────────────────────────────────────────
// One beat, in order: the empty meter rail draws itself out from the left, the
// fill chases it down the rail, and the two readouts widen into place off the
// rail's ends as it lands. Nothing else on the screen moves — the tree and the
// header pills are already where they belong, which is why this is the only
// thing that stretches.
const HUD_OPEN_DELAY  = 160;
const HUD_OPEN_MS     = 520;
const HUD_FILL_DELAY  = HUD_OPEN_DELAY + HUD_OPEN_MS - 140;  // overlaps the rail's landing
const HUD_STATS_DELAY = HUD_OPEN_DELAY + HUD_OPEN_MS - 90;
const HUD_TICK_DELAY  = HUD_STATS_DELAY + 60;                // the count-up starts once they're up
const HIDDEN_GAP      = 196;  // extra air above a revealed HIDDEN CHALLENGE (2-line plaque)
// The plaque rides well clear of the node so the gold connector elbow bending in
// from the branch tips passes BELOW it, never alongside the type.
const CHALLENGE_LABEL_OFFSET = 148;

// ─── How BIG a node ends up on screen ────────────────────────────────────────
// The tree is drawn at its natural size and then scaled to fit the card, so the
// node size the player actually sees used to depend entirely on how WIDE the
// quest is: a single-column quest rendered at 1:1 (huge cards) while a two-column
// side quest was squeezed to ~55% (tiny ones). Same app, two different scales.
// So the fit is CLAMPED into a band, expressed as the on-screen width a standard
// node should land at — every tree now reads at roughly one size.
// The band is a CAP only: a lone column can't blow up to fill the card. There is
// deliberately no floor — the WHOLE tree must always be on screen at once, so a
// tree that needs to shrink to fit does shrink. A wider tree buys its node size
// back from the margins instead (TREE_PAD_H / COL_GAP), never from the player's
// thumb.
const NODE_ON_SCREEN_MAX = 250;
const BEND_NEAR_CHILD = 12;   // horizontal jog sits this many px above child top
// ONE size for all three header pills (BACK / version switch / DOWNGRADE) so
// they sit level and, at this size, fit on a single line together. They were all
// 58 high with 24pt type, which ate half the card and pushed the pair onto their
// own row below BACK.
const HEADER_PILL_H   = 44;

// ─── Per-node height — long names grow taller instead of clipping ─────────────
// Width is fixed by column geometry, so we can't widen a node without colliding
// with its neighbours. Instead each node's HEIGHT is sized to how many lines its
// name needs (up to a cap), so long text wraps fully and short nodes stay compact.
const NODE_LINE_H    = 27;   // must match styles.questName lineHeight
const NODE_V_PAD     = 12;   // must match styles.questCard paddingVertical
// Reserved row for the DONE / +LVL badge + the gap above it. Must comfortably
// cover the badge's real rendered height (text lineHeight 22 + 4 padding = 26)
// plus styles.questCard gap (6) plus slack so the title is never clipped.
const NODE_BADGE_H   = 38;
// Cap on wrapped title lines. 4 (was 3) so long combo names like
// "…negative press (2 rounds in a row)" show in full instead of truncating with
// an ellipsis. Rows are height-aware, so taller nodes just reserve more room;
// short names still compute 1–2 lines and are unchanged.
const NODE_MAX_LINES = 4;

// How many lines a title really takes. The old estimate was a flat character
// count at ~14px/char, which is far wider than Exo2 Bold actually sets: it read
// "Weighted Superman 5 sec" (one line on screen) as TWO, so that card reserved a
// whole extra line of height and stood visibly taller than its one-line
// neighbours. Now each glyph gets an approximate advance and words wrap whole,
// like the real text layout — so the reserved height matches what renders.
// Advance widths for the node title face (Exo2 Bold) at fontSize 24, read
// straight out of the shipped TTF (hmtx/cmap) — not guessed. Anything not listed
// (emoji, rare punctuation) falls back to GLYPH_FALLBACK.
const GLYPH_W = {
  ' ': 5.18, '-': 9.94, '/': 13.27, '(': 8.78, ')': 8.78, "'": 5.09, '"': 8.95, '.': 5.86, ',': 5.81,
  '0': 15.14, '1': 10.37, '2': 13.94, '3': 13.61, '4': 15.29,
  '5': 13.25, '6': 14.16, '7': 12.67, '8': 14.95, '9': 14.16,
  A: 15.67, B: 15.36, C: 14.11, D: 16.39, E: 13.87, F: 13.37, G: 15.55,
  H: 16.58, I: 7.01,  J: 8.93,  K: 15.22, L: 12.86, M: 21.96, N: 17.33,
  O: 16.51, P: 14.83, Q: 16.51, R: 15.53, S: 14.06, T: 14.45, U: 16.46,
  V: 15.36, W: 23.42, X: 15.46, Y: 14.69, Z: 14.06,
  a: 13.68, b: 14.26, c: 12.22, d: 14.33, e: 13.54, f: 9.7,  g: 13.94,
  h: 14.42, i: 6.62,  j: 6.65,  k: 13.42, l: 7.87,  m: 21.14, n: 14.42,
  o: 14.16, p: 14.4,  q: 14.26, r: 10.25, s: 12.74, t: 9.84,  u: 14.23,
  v: 13.58, w: 20.4,  x: 13.61, y: 13.58, z: 12.62,
};
const GLYPH_FALLBACK = 24;      // emoji (🔒) render about one em wide

const LETTER_SPACING = 0.6;                         // must match styles.questName

function textWidth(str) {
  let w = 0;
  for (const ch of String(str ?? '')) w += (GLYPH_W[ch] ?? GLYPH_FALLBACK) + LETTER_SPACING;
  return w;
}

// Usable text width inside a node: minus the card's paddingHorizontal (16×2) and
// the title's own paddingHorizontal (8×2), then 2px of slack so a title landing
// exactly on the boundary counts as wrapping rather than being ellipsised.
function usableTextWidth(nodeW) {
  return Math.max(60, nodeW - 32 - 16 - 2);
}

function nodeLineCount(name, nodeW) {
  const usable = usableTextWidth(nodeW);
  const words  = String(name ?? '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;

  let lines = 1;
  let cur   = 0;
  for (const word of words) {
    const wWidth = textWidth(word);
    const withSp = cur === 0 ? wWidth : cur + textWidth(' ') + wWidth;
    if (withSp <= usable) {
      cur = withSp;
    } else {
      lines += 1;
      // A single word too long for the line breaks by character (native does the
      // same); count how many lines it eats.
      cur = wWidth;
      while (cur > usable && lines < NODE_MAX_LINES) { cur -= usable; lines += 1; }
    }
    if (lines >= NODE_MAX_LINES) return NODE_MAX_LINES;
  }
  return Math.min(NODE_MAX_LINES, lines);
}

// Height reserved for a node — the same in every state. Locked or not the title
// is identical (the padlock sits in the badge row below it); a coach node, whose
// label DOES change on approval, is measured at its longest via
// questLayoutLabel() so approving it can't reshuffle the tree.
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
// detected structurally within a tier-enabled class — but the threshold below
// prevents Class I/II (whose multi-branch convergences look identical) from
// rendering a divider. Future tiered classes (IV+) clear this threshold too.
const TIER_MIN_CLASS_ORDER = 2;

// The handstand JOB doesn't gate tiers on class order (its classes are 0/1/2 but
// most are faithful single-tier copies of static quests). Tiers there are an
// explicit per-quest choice: ONLY these chains render a TIER divider. Everything
// else (push / foundation / balance / shapes …) reads like its un-tiered source.
// (PUSH used to carry the power/mobility TIER II, but that was moved into its own
// flat FOUNDATION main quest — 20260716_handstand_push_tier2_to_foundation.)
// HSPU is tiered: its MAIN convergence + the HSPU branch below it are TIER II.
const HANDSTAND_TIERED_CHAINS = ['hspu'];

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
const HS_NODE_W       = 360;
// A single-column linear quest (one branch, no splits) owns the whole frame, so
// its nodes widen to this — long info-dense names then wrap to far fewer lines.
const HS_NODE_W_WIDE  = 680;
const HS_COL_GAP      = 50;
const HS_SPLIT_OFFSET = 205;

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

  const numBranches = branches.length;

  // Single linear column (one branch, no node with 2+ children) has no neighbour
  // to collide with, so its nodes widen to HS_NODE_W_WIDE. Multi-column / split
  // trees keep HS_NODE_W (widening them would overlap adjacent columns/siblings).
  const childCount = {};
  quests.forEach(q => (q.prerequisites ?? []).forEach(p => {
    if (idMap.has(p)) childCount[p] = (childCount[p] ?? 0) + 1;
  }));
  const isSingleColumn =
    numBranches === 1 && Object.values(childCount).every(c => c <= 1);
  // Only widen when at least one name is genuinely long — short-name quests
  // (e.g. "One Straddle Press") would just look empty at the wider size.
  const hasLongNames = quests.some(q => (q.name?.length ?? 0) > 44);
  const NW = isSingleColumn && hasLongNames ? HS_NODE_W_WIDE : HS_NODE_W;

  const colCenterX = (b) =>
    (colIndex[b] ?? 0) * (NW + HS_COL_GAP) + NW / 2;

  const treeWidth   =
    numBranches * NW + Math.max(0, numBranches - 1) * HS_COL_GAP;

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
  // Row spacing is HEIGHT-AWARE: each rank reserves the tallest node it holds,
  // so multi-line names (e.g. long combo descriptions) no longer crowd the row
  // below. Ranks are plain integers in this path (no fractional effRank), so a
  // cumulative top table is exact. When every node is a single line this reduces
  // to the old uniform NODE_H + RANK_GAP step, leaving short chains unchanged.
  const rankHeight = {};
  quests.forEach(q => {
    const r = rankOf[q.id] ?? 0;
    rankHeight[r] = Math.max(rankHeight[r] ?? NODE_H, nodeHeightFor(questLayoutLabel(q), NW));
  });
  const rankTop = {};
  let acc = TREE_PAD_T + LABEL_H;
  for (let r = 0; r <= maxRank; r++) {
    if (r === firstTier2Rank) acc += TIER_GAP;   // breathing room around the divider
    rankTop[r] = acc;
    acc += (rankHeight[r] ?? NODE_H) + RANK_GAP;
  }
  const rankY = (r) => rankTop[r] ?? (TREE_PAD_T + LABEL_H + r * (NODE_H + RANK_GAP));
  const positions = {};
  quests.forEach(q => {
    const r  = rankOf[q.id] ?? 0;
    const cx = colCenterX(q.branch ?? branches[0]) + (offsetOf[q.id] ?? 0);
    positions[q.id] = {
      x: cx - NW / 2,
      y: rankY(r),
      w: NW,
      // The whole ROW's height, not this node's own — side-by-side siblings must
      // read as one row of equal cards. (A row is only taller than NODE_H when
      // some node in it genuinely needs a second line.)
      h: rankHeight[r] ?? NODE_H,
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
    labelXOf[b] = colCenterX(b) - NW / 2;
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
    nodeWidth: NW,
  };
}

// A revealed HIDDEN CHALLENGE hangs off the BOTTOM of the tree (its prerequisites
// are the branch tips), so it can simply be pushed further down than its
// topological rank would place it. That gap is what makes it read as a separate,
// earned thing instead of "one more row" crowding the branch tips — and it gives
// its banner room to breathe. Applied AFTER either layout engine, so both get it.
function spaceOutHiddenNodes(layout, quests) {
  const hidden = (quests ?? []).filter(q => q.is_hidden);
  if (hidden.length === 0) return layout;

  const positions = { ...layout.positions };
  let moved = false;
  hidden.forEach(q => {
    const p = positions[q.id];
    if (!p) return;
    positions[q.id] = { ...p, y: p.y + HIDDEN_GAP };
    moved = true;
  });
  if (!moved) return layout;

  let maxBottom = 0;
  Object.values(positions).forEach(p => { maxBottom = Math.max(maxBottom, p.y + p.h); });
  return { ...layout, positions, height: Math.max(layout.height, maxBottom + TREE_PAD_T) };
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

  const numBranches  = branches.length;

  // Single linear column (one branch, no node with 2+ children) owns the whole
  // frame → widen its nodes so info-dense names wrap to far fewer lines. Any
  // multi-column / split / convergence tree keeps NODE_W (identical behavior),
  // and short-name quests stay narrow so they don't look empty.
  const childCount = {};
  quests.forEach(q => (q.prerequisites ?? []).forEach(p => {
    if (idMap.has(p)) childCount[p] = (childCount[p] ?? 0) + 1;
  }));
  const isSingleColumn =
    numBranches === 1 && Object.values(childCount).every(c => c <= 1);
  const hasLongNames = quests.some(q => (q.name?.length ?? 0) > 44);
  const NW = isSingleColumn && hasLongNames ? WIDE_NODE_W : NODE_W;

  const colCenterX = (b) => (colIndex[b] ?? 0) * (NW + COL_GAP) + NW / 2;
  const treeWidth    = numBranches * NW + Math.max(0, numBranches - 1) * COL_GAP;
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
  //
  // For a simple single-column quest (integer ranks, no fractional effRank),
  // row spacing is HEIGHT-AWARE: each rank reserves the tallest node it holds, so
  // multi-line combo descriptions no longer overlap the row below. Complex trees
  // (fractional effRank from spread/floating shifts) keep the original uniform
  // step, so their tuned layouts are untouched.
  // Row height = the tallest node the rank holds. Used for BOTH the vertical
  // step (single-column path) and every node's rendered height, so no card in a
  // row is shorter than its neighbour.
  const rankHeight = {};
  quests.forEach(q => {
    const r = rankOf[q.id] ?? 0;
    rankHeight[r] = Math.max(rankHeight[r] ?? NODE_H, nodeHeightFor(questLayoutLabel(q), NW));
  });
  const rowH = (r) => rankHeight[Math.round(r)] ?? NODE_H;

  // ONE height-aware ladder for every tree. Each rank's top is the previous
  // rank's top plus the TALLEST node that rank holds — so a row containing a
  // two-line name (e.g. a coach node's "Coach certification needed") pushes the
  // row below it down instead of growing into the gap and colliding with the
  // next branch's label, which sits LABEL_OFFSET above its first node.
  // A branch shifted by BRANCH_LAYOUT lands on a FRACTIONAL rank, so the ladder
  // is interpolated between the two integer rungs it falls between (and
  // extrapolated with the last step past the bottom). When every node is one
  // line this reduces exactly to the old uniform NODE_H + RANK_GAP step, so
  // existing trees are untouched.
  const rankTop = {};
  {
    let acc = TREE_PAD_T + LABEL_H;
    for (let r = 0; r <= maxRank; r++) {
      if (r === firstTier2Rank) acc += TIER_GAP;
      rankTop[r] = acc;
      acc += (rankHeight[r] ?? NODE_H) + RANK_GAP;
    }
  }
  const rungAt = (r) => {
    if (r <= 0) return rankTop[0] ?? (TREE_PAD_T + LABEL_H);
    if (r >= maxRank) {
      const step = (rankHeight[maxRank] ?? NODE_H) + RANK_GAP;
      return (rankTop[maxRank] ?? 0) + (r - maxRank) * step;
    }
    const lo = Math.floor(r);
    const t  = r - lo;
    return rankTop[lo] + t * (rankTop[lo + 1] - rankTop[lo]);
  };
  const rankY = (r) => rungAt(Number.isFinite(r) ? r : 0);
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
      positions[q.id] = { x: cx - NW / 2, y: rankY(effRank[q.id]), w: NW, h: rowH(r), rank: r };
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
        positions[q.id] = { x: cx - NODE_W / 2, y: rankY(effRank[q.id]), w: NODE_W, h: rowH(r), rank: r };
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
          positions[q.id] = { x: cx - NODE_W / 2, y: rankY(effRank[q.id]), w: NODE_W, h: rowH(r), rank: r };
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

  return { positions, firstNodeOfBranch, rankY, width, height, nodeWidth: NW };
}

// A number that RUSHES up from 0 to `value` on mount — the count-up flourish the
// header stat chips share with the Skills LVL number. Renders a bare <Text> so it
// inherits whatever styled <Text> it's nested inside. Color can't run on the
// native driver, so a JS listener feeds the displayed integer.
function Ticker({ value, duration = 1000, delay = 250 }) {
  const v = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    v.setValue(0);
    const id = v.addListener(({ value: x }) => setShown(Math.round(x)));
    const anim = Animated.timing(v, {
      toValue: value, duration, delay,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    });
    anim.start();
    return () => { anim.stop(); v.removeListener(id); };
  }, [value, v, duration, delay]);
  return <Text>{shown}</Text>;
}

// The hero quest name makes an ENTRANCE — fades, rises and scales up into place
// on mount. Its color and ice-glow (styles.chainTitle) are untouched; only the
// arrival is animated, so "HANDSTAND" lands with weight.
function HeroTitle({ text }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(a, {
      toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [a]);
  const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  const scale      = a.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });
  return (
    <Animated.View style={{ opacity: a, transform: [{ translateY }, { scale }] }}>
      <Text style={styles.chainTitle}>{text}</Text>
    </Animated.View>
  );
}

// Quest-type emblem — a sleek capsule with a faint inner frame line (the "tech"
// double-border) around the label alone — no flanking ornament. Ice for BOTH
// quest types — the label alone says which (the old ember side-quest tone read
// as a warning next to the ice UI).
function QuestTypeBadge({ questType }) {
  const isMain = questType === 'main';

  return (
    <View style={styles.typeBadge}>
      <View style={styles.typeBadgeInner} pointerEvents="none" />
      <Text style={[styles.typeBadgeText, { color: SL.accent }]}>
        {isMain ? 'MAIN QUEST' : 'SIDE QUEST'}
      </Text>
    </View>
  );
}

// The header status HUD — a big completion meter + ticking stat readouts. The
// fill GROWS in on mount and carries a live shimmer (ice while in progress, GOLD
// once every node is cleared); at 100% it breathes a gold glow and a "MASTERED"
// seal appears overhead — the payoff for finishing a whole quest line.
function QuestHUD({ done, total, earnedLvl }) {
  const pct      = total > 0 ? done / total : 0;
  const complete = total > 0 && done === total;

  const open    = useRef(new Animated.Value(0)).current;   // the track unfurling
  const grow    = useRef(new Animated.Value(0)).current;   // the fill inside it
  const stats   = useRef(new Animated.Value(0)).current;   // the two readouts
  const breathe = useRef(new Animated.Value(0)).current;

  // The empty TRACK draws itself out from the left first — so the fill has a
  // rail to run along instead of appearing inside a bar that was always there.
  useEffect(() => {
    open.setValue(0);
    const anim = Animated.timing(open, {
      toValue: 1, duration: HUD_OPEN_MS, delay: HUD_OPEN_DELAY,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [open]);

  useEffect(() => {
    grow.setValue(0);
    const anim = Animated.timing(grow, {
      toValue: 1, duration: 1100, delay: HUD_FILL_DELAY,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [pct, grow]);

  // …and the readouts arrive as the rail lands, widening into place with it
  // (a touch of overshoot) rather than sitting there waiting for it.
  useEffect(() => {
    stats.setValue(0);
    const anim = Animated.timing(stats, {
      toValue: 1, duration: 460, delay: HUD_STATS_DELAY,
      easing: Easing.out(Easing.back(1.7)), useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [stats]);

  useEffect(() => {
    if (!complete) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breathe, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(breathe, { toValue: 0, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [complete, breathe]);

  // min 3% so even 0-progress shows a glint of fill at the left.
  const fillW       = grow.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${Math.max(pct * 100, 3)}%`] });
  const glowOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.65] });
  // The track's own width — this is the bar EXPANDING, drawn before any fill.
  const trackW      = open.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  // The readouts widen out of the rail: squat and low, then full size.
  const statsScaleX = stats.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const statsLift   = stats.interpolate({ inputRange: [0, 1], outputRange: [-9, 0] });

  return (
    <View style={styles.hud}>
      {complete && (
        <View style={styles.masteredWrap}>
          <ShimmerText text="✦ MASTERED ✦" style={styles.masteredText} colors={GOLD} direction="ltr" active />
        </View>
      )}

      <Animated.View style={[styles.meterTrack, { width: trackW }]}>
        <Animated.View style={[styles.meterFillWrap, { width: fillW }]}>
          <ShimmerFill style={styles.meterFill} colors={complete ? GOLD : BLUE} active />
        </Animated.View>
        {complete && (
          <Animated.View pointerEvents="none" style={[styles.meterGlow, { opacity: glowOpacity }]} />
        )}
      </Animated.View>

      {/* Each readout expands from its OWN end of the rail — the count out of
          the left, the LVL out of the right — so the pair reads as the bar's
          two ends resolving into numbers. */}
      <View style={styles.hudStats}>
        <Animated.View style={{
          opacity: stats,
          transform: [{ translateY: statsLift }, { scaleX: statsScaleX }],
          transformOrigin: 'left center',
        }}>
          <Text style={[styles.hudStatNum, complete && styles.hudStatNumGold]}>
            <Ticker value={done} delay={HUD_TICK_DELAY} />/{total}{'  '}
            <Text style={styles.hudStatTag}>COMPLETE</Text>
          </Text>
        </Animated.View>
        <Animated.View style={{
          opacity: stats,
          transform: [{ translateY: statsLift }, { scaleX: statsScaleX }],
          transformOrigin: 'right center',
        }}>
          <Text style={styles.hudStatNumGold}>
            +<Ticker value={earnedLvl} delay={HUD_TICK_DELAY} />{'  '}
            <Text style={styles.hudStatTagGold}>LVL EARNED</Text>
          </Text>
        </Animated.View>
      </View>
    </View>
  );
}

// The gold banner over a revealed HIDDEN CHALLENGE — the branch label's
// replacement. On the reveal tap it holds back until the node has punched in
// (same beat as the shockwave), then fades down into place; on every later visit
// it's just there, like any other branch heading.
function ChallengeBanner({ reveal }) {
  const enter = useRef(new Animated.Value(reveal ? 0 : 1)).current;

  useEffect(() => {
    if (!reveal) return;
    enter.setValue(0);
    const anim = Animated.timing(enter, {
      toValue: 1, duration: 520, delay: REVEAL_DELAY + 260,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [reveal, enter]);

  // A gold PLAQUE, not loose text. The connector line runs up through this spot,
  // so the banner needs an opaque back — text sitting on a wire looked like a
  // mistake. Two stacked lines (small tracked-out "HIDDEN" kicker over a heavy
  // "CHALLENGE"), boxed in gold with a glow, so it reads as a prize plate.
  return (
    <Animated.View style={[styles.challengeBanner, {
      opacity: enter,
      transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }],
    }]}>
      <ShimmerText
        text="HIDDEN"
        numberOfLines={1}
        style={styles.challengeKicker}
        colors={GOLD}
        direction="ltr"
        active
      />
      <ShimmerText
        text="CHALLENGE"
        numberOfLines={1}
        style={styles.challengeLabel}
        colors={GOLD}
        direction="ltr"
        active
      />
    </Animated.View>
  );
}

// One quest node, brought to life. On mount it RISES + fades + scales in, delayed
// by its `delay` (derived from tree rank) so the whole tree cascades into place
// from roots to leaves. On press it DIPS to 0.95 under the finger — the tactile
// "tap me" cue locked nodes deliberately don't get. All the visual states (done /
// locked / required frame) are unchanged; only motion is added on top.
function QuestNode({ quest, state, isRequired, nodeWidth, delay, disabled, celebrate = false, reveal = false, mirrorSource = null, coachLocked = false, pickIndex = null, pickMode = null, pickable = false, onPress }) {
  const isDone   = state === 'done';
  // A mirror node is a requirement earned in ANOTHER quest. It's never locked in
  // the "can't get there yet" sense — it's just not yours to tap here — so it
  // stays pressable (the tap explains where to earn it) and wears a link glyph
  // instead of a padlock.
  const isMirror = isMirrorQuest(quest);
  // A coach-approved node is the coach's to check, not the player's. Same
  // pressable-but-not-yours treatment as a mirror node — the tap explains who
  // owns it — and it wears GREEN in every state (see lib/coachQuests.js).
  const isCoach  = isCoachQuest(quest);
  // In MULTI-SIGN mode a locked node is still tappable when the picks already
  // queued ahead of it would unlock it — that is the whole point of picking a
  // run of nodes in order. `pickable` is decided by the screen, which owns the queue.
  const isLocked = state === 'locked' && !isMirror && !pickable;
  const isPicked = pickIndex != null;
  // A revealed HIDDEN CHALLENGE — it only ever renders once earned, so it wears
  // the GOLD treasure palette (never the blue of a normal node) so it reads as a
  // prize. A prestige requirement still wins the frame — same palette, and it
  // is the more important of the two.
  const isChallenge = !!quest.is_hidden && !isRequired;
  // DONE is the DEFAULT palette (ice blue) — it must never repaint a node that
  // owns a palette of its own. A hidden challenge stays GOLD and a mirrored
  // requirement stays VIOLET once complete; they get their own "earned" variant
  // (brighter tint + glow, same hue) instead of the blue one.
  const isDonePlain = isDone && !isChallenge && !isMirror && !isCoach;
  // A coach node says one sentence and nothing else: what it still needs, or —
  // once the coach has signed it off — that it's approved. No chips below it.
  const label = questNodeLabel(quest, isDone);

  const enter = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const gate  = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const wave  = useRef(new Animated.Value(0)).current;

  // Completion burst — the moment THIS node is confirmed done, a gold halo
  // flashes and the card gives a little punch, then both decay away. One-shot.
  useEffect(() => {
    if (!celebrate) return;
    burst.setValue(1);
    const anim = Animated.timing(burst, {
      toValue: 0, duration: 1000, easing: Easing.out(Easing.quad), useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [celebrate, burst]);

  useEffect(() => {
    // A REVEALED hidden challenge doesn't rise into place like the rest of the
    // tree — it punches out of nothing: a beat of silence after the tap that
    // earned it, then a back-eased pop from far too small, with the shockwave
    // below riding the same clock.
    const anim = reveal
      ? Animated.timing(enter, {
          toValue: 1, duration: 760, delay: REVEAL_DELAY,
          easing: Easing.out(Easing.back(2.2)), useNativeDriver: true,
        })
      : Animated.timing(enter, {
          toValue: 1, duration: 440, delay,
          easing: Easing.out(Easing.cubic), useNativeDriver: true,
        });
    anim.start();
    return () => anim.stop();
  }, [enter, delay, reveal]);

  // Shockwave — two gold rings blown outward from the new node, staggered, once.
  useEffect(() => {
    if (!reveal) return;
    wave.setValue(0);
    const anim = Animated.timing(wave, {
      toValue: 1, duration: 1400, delay: REVEAL_DELAY,
      easing: Easing.out(Easing.quad), useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [reveal, wave]);

  // Available-but-not-done nodes BREATHE — a soft ice halo that draws the eye to
  // the player's next possible move. Only the actionable nodes pulse; done and
  // locked nodes stay calm.
  // (A coach-gated node never breathes for the player — it isn't their next
  // move, however available it looks.)
  useEffect(() => {
    if (state !== 'unlocked' || coachLocked) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1150, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1150, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [state, coachLocked, pulse]);

  // CLASS-GATE nodes (prestige requirements for the next class) get their OWN
  // life: the gold crown ribbon bobs and its halo breathes, in every state, so a
  // milestone always reads as a milestone — not just "the next tap".
  useEffect(() => {
    if (!isRequired) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(gate, { toValue: 1, duration: 1250, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(gate, { toValue: 0, duration: 1250, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [isRequired, gate]);

  const translateY = reveal
    ? 0
    : enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });
  const enterScale = enter.interpolate({
    inputRange: [0, 1], outputRange: [reveal ? 0.3 : 0.9, 1],
  });
  const pressScale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.95] });
  const burstScale = burst.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] });
  const scale = Animated.multiply(Animated.multiply(enterScale, pressScale), burstScale);
  const dip = to => Animated.timing(press, {
    toValue: to, duration: to ? 90 : 150, easing: Easing.out(Easing.quad), useNativeDriver: true,
  }).start();

  return (
    <Animated.View
      style={{ width: '100%', height: '100%', opacity: enter, transform: [{ translateY }, { scale }] }}
    >
      {/* Discovery shockwave — only ever on screen for the one tap that
          unearthed this challenge. */}
      {reveal && [0, 0.18].map((stagger, i) => (
        <Animated.View
          key={`wave-${i}`}
          pointerEvents="none"
          style={[
            styles.revealRing,
            {
              opacity: wave.interpolate({
                inputRange: [stagger, stagger + 0.05, stagger + 0.55],
                outputRange: [0, 0.85, 0],
                extrapolate: 'clamp',
              }),
              transform: [{
                scale: wave.interpolate({
                  inputRange: [stagger, stagger + 0.55],
                  outputRange: [0.85, 2.1],
                  extrapolate: 'clamp',
                }),
              }],
            },
          ]}
        />
      ))}

      {state === 'unlocked' && !isRequired && !coachLocked && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.unlockedHalo,
            { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.9] }) },
          ]}
        />
      )}

      {/* CLASS-GATE breathing gold halo — its own glow, always on for required
          nodes (replaces the ice halo so the gate reads as gold, not blue). */}
      {isRequired && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.gateHalo,
            { opacity: gate.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.85] }) },
          ]}
        />
      )}

      {/* One-shot gold completion flash (see the `burst` clock above). */}
      <Animated.View pointerEvents="none" style={[styles.burstHalo, { opacity: burst }]} />
      <TouchableOpacity
        style={[
          styles.questCard,
          isDonePlain && styles.questCardDone,
          isLocked   && styles.questCardLocked,
          isRequired && styles.questCardRequired,
          isChallenge && styles.questCardChallenge,
          isChallenge && isDone && styles.questCardChallengeDone,
          isMirror   && styles.questCardMirror,
          isMirror && isDone && styles.questCardMirrorDone,
          isCoach    && styles.questCardCoach,
          isCoach && isDone && styles.questCardCoachDone,
          // Queued in MULTI-SIGN — wins over every palette above, because while
          // the queue is open the only thing that matters is what is in it.
          isPicked && (pickMode === 'remove' ? styles.questCardPickRemove : styles.questCardPickAdd),
        ]}
        disabled={isLocked || disabled}
        activeOpacity={isLocked ? 1 : 0.85}
        onPress={() => { if (!isLocked) onPress(); }}
        onPressIn={() => { if (!isLocked) dip(1); }}
        onPressOut={() => { if (!isLocked) dip(0); }}
      >
        {/* MULTI-SIGN order chip — the position this node holds in the queue, so
            the run reads back as 1 -> 2 -> 3 before anything is committed. */}
        {isPicked && (
          <View style={[
            styles.pickChip,
            pickMode === 'remove' ? styles.pickChipRemove : styles.pickChipAdd,
          ]}>
            <Text style={[
              styles.pickChipText,
              pickMode === 'remove' ? styles.pickChipTextRemove : styles.pickChipTextAdd,
            ]}>{pickIndex + 1}</Text>
          </View>
        )}

        {isRequired && (
          <ShimmerFrame
            style={[styles.questFrame, { shadowColor: SL.gold }]}
            colors={GOLD}
            thickness={4}
            active
          />
        )}

        {/* HIDDEN CHALLENGE — the same live gold frame a prestige requirement wears. */}
        {isChallenge && (
          <ShimmerFrame
            style={[styles.questFrame, { shadowColor: SL.gold }]}
            colors={GOLD}
            thickness={4}
            active
          />
        )}

        {/* Floating crown ribbon — marks this node as a gate to the next class.
            Bobs gently (gate clock) so it always draws the eye. */}
        {isRequired && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.gateRibbonWrap,
              { transform: [{ translateY: gate.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }] },
            ]}
          >
            <View style={styles.gateRibbon}>
              <Text style={styles.gateRibbonText} numberOfLines={1}>✦ PRESTIGE REQUIRED ✦</Text>
            </View>
          </Animated.View>
        )}
        <Text
          style={[
            styles.questName,
            isDonePlain && styles.questNameDone,
            isLocked && styles.questNameLocked,
            isChallenge && styles.questNameChallenge,
            isMirror && styles.questNameMirror,
            isCoach && styles.questNameCoach,
          ]}
          // Mirror titles render a size up, so wrap them against a proportionally
          // narrower width or a title that just fits would get ellipsised.
          numberOfLines={nodeLineCount(label, isMirror ? nodeWidth * (24 / 29) : nodeWidth)}
        >
          {label}
        </Text>

        <View style={styles.nodeBottom}>
          {/* The padlock lives in the badge row, NOT prefixed to the title: as a
              prefix it stole ~30px of the first line, so a locked node could wrap
              one line further than the same node unlocked — and every card had to
              reserve that extra line whether it used it or not. */}
          {isLocked && <Text style={styles.lockGlyph}>🔒</Text>}
          {/* Where this requirement actually lives. Shown in BOTH states — the
              point of the node is that another quest owns it. */}
          {isMirror && (
            <View style={[styles.mirrorTag, isDone && styles.mirrorTagDone]}>
              <Text style={[styles.mirrorTagText, isDone && styles.mirrorTagTextDone]}>
                {(mirrorSource?.chain ?? 'another quest').replace(/_/g, ' ').toUpperCase()}
              </Text>
            </View>
          )}
          {/* A coach node wears no chip — not ✓ DONE, not +LVL. Its sentence
              already says exactly where it stands. */}
          {isCoach ? null : isDone ? (
            <View style={[
              styles.doneBadge,
              isChallenge && styles.doneBadgeChallenge,
              isMirror && styles.doneBadgeMirror,
            ]}>
              <Text style={[
                styles.doneBadgeText,
                isChallenge && styles.doneBadgeTextChallenge,
                isMirror && styles.doneBadgeTextMirror,
              ]}>
                ✓ DONE{quest.lvl_reward > 0 ? ` · +${quest.lvl_reward}` : ''}
              </Text>
            </View>
          ) : quest.lvl_reward > 0 ? (
            <View style={[
              styles.rewardBadge,
              isChallenge && styles.rewardBadgeChallenge,
              isLocked && { opacity: 0.4 },
            ]}>
              <Text style={[
                styles.rewardText,
                isChallenge && styles.rewardTextChallenge,
              ]}>
                +{quest.lvl_reward} LVL
              </Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Upgrade gate ─────────────────────────────────────────────────────────────
// The payoff for clearing every node of an upgradable quest: after the last
// node's gold burst has had its moment, a gold plinth rises from the foot of the
// tree carrying the UPGRADE button. It doesn't fade in — it ARRIVES: a beam of
// light climbs out of the tree, the plinth lifts and settles, the frame catches
// fire, and the button breathes until it's taken.

const GATE_BEAT = 520;   // held back this long so the node burst lands first

function UpgradeGate({ onPress, busy }) {
  const rise  = useRef(new Animated.Value(0)).current;   // 0 → 1: the arrival
  const beam  = useRef(new Animated.Value(0)).current;   // the light that climbs
  const pulse = useRef(new Animated.Value(0)).current;   // the idle breath
  const [lit, setLit] = useState(false);                 // frame shimmer armed

  useEffect(() => {
    const seq = Animated.sequence([
      Animated.delay(GATE_BEAT),
      // The beam shoots up out of the last node…
      Animated.timing(beam, {
        toValue: 1, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      // …and the plinth rides up on it, overshooting slightly as it lands.
      Animated.spring(rise, {
        toValue: 1, friction: 6, tension: 70, useNativeDriver: true,
      }),
    ]);
    seq.start(() => setLit(true));
    return () => seq.stop();
  }, [beam, rise]);

  // Idle breath — starts only once the gate has landed, so nothing competes
  // with the arrival.
  useEffect(() => {
    if (!lit) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [lit, pulse]);

  const beamScaleY = beam.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const beamFade   = beam.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 0.35] });
  const lift       = rise.interpolate({ inputRange: [0, 1], outputRange: [34, 0] });
  const grow       = rise.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] });
  const breathe    = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] });
  const halo       = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.28, 0.6] });

  return (
    <View style={styles.gateWrap} pointerEvents="box-none">
      {/* The beam of light the plinth rides up on. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.gateBeam, { opacity: beamFade, transform: [{ scaleY: beamScaleY }] }]}
      />

      <Animated.View style={[
        styles.gatePlinth,
        { opacity: rise, transform: [{ translateY: lift }, { scale: grow }] },
      ]}>
        <Animated.View style={{ transform: [{ scale: breathe }] }}>
          {/* Gold bloom behind the button, breathing with it. */}
          <Animated.View pointerEvents="none" style={[styles.gateHalo, { opacity: halo }]} />

          <TouchableOpacity
            style={styles.gateBtn}
            onPress={onPress}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color={SL.gold} size="small" />
            ) : (
              <>
                <Text style={styles.gateBtnChevron}>▲</Text>
                <ShimmerText
                  text="UPGRADE"
                  style={styles.gateBtnText}
                  colors={GOLD}
                  direction="ltr"
                  active
                />
              </>
            )}
            {lit && (
              <ShimmerFrame style={styles.gateBtnFrame} colors={GOLD} active radius={14} thickness={2.5} />
            )}
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

// ─── Downgrade ────────────────────────────────────────────────────────────────
// UPGRADE's opposite: the way OUT of an upgrade taken by accident. Not the
// version switch beside it — that only changes which half you're looking at.
// This one gives the upgrade back AND resets the upgraded quest, so it asks
// before it does anything.
//
// Muted, outline-only. It sits in the header next to the switch because they're
// the same kind of control (what happens to this pair), but it must never read
// as the primary action of the screen.

function DowngradeButton({ onPress, busy }) {
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(fade, {
      toValue: 1, duration: 420, delay: 200,
      easing: Easing.out(Easing.quad), useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [fade]);

  // The wrapper is shrinkable, or the button inside it can never give width
  // back to the row and the three header pills run off the card.
  return (
    <Animated.View style={{ opacity: fade, flexShrink: 1, minWidth: 0 }}>
      <TouchableOpacity
        style={styles.downBtn}
        onPress={onPress}
        disabled={busy}
        activeOpacity={0.85}
      >
        {busy ? (
          <ActivityIndicator color={SL.muted} size="small" />
        ) : (
          <>
            <Text style={styles.downBtnChevron}>▼</Text>
            <Text
              style={styles.downBtnText}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >DOWNGRADE</Text>
          </>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Version switch ───────────────────────────────────────────────────────────
// Once a pair is upgraded the two versions are both permanently the player's —
// this moves between them. Lives in the header next to BACK, because that is
// exactly what it is: the way back to the quest below (or forward again).

function VersionSwitch({ toUpgrade, label, onPress }) {
  return (
    <TouchableOpacity style={styles.verSwitch} onPress={onPress} activeOpacity={0.85}>
      <Text style={styles.verSwitchArrow}>{toUpgrade ? '▲' : '▼'}</Text>
      <Text
        style={styles.verSwitchText}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >{label.replace(/_/g, ' ').toUpperCase()}</Text>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function QuestTreeScreen({ route, navigation }) {
  // `studentId` is set by admin-as-coach (managing another player's tree). Absent
  // in the player's own flow, where the toggle targets the signed-in user.
  const {
    classId, chain: paramChain, questType: paramType,
    job = DEFAULT_JOB, studentId: overrideStudentId,
  } = route.params;

  // Is the COACH looking at this tree? Coach-approved nodes are only togglable
  // from the admin flow — the player sees them, but can never check them off.
  const { isAdmin: isCoachViewer = false } = useCoach() ?? {};

  // ── Which VERSION of this quest is on screen ───────────────────────────────
  // A quest with an upgrade is really two trees behind one card (see
  // lib/questUpgrades.js), and the player moves between them WITHOUT leaving the
  // screen — so the chain being rendered is state, not a route param. It starts
  // at whatever the Skills card opened and is re-pointed by the UPGRADE button
  // and the version switch.
  const [view, setView] = useState({ chain: paramChain, questType: paramType });
  const { chain, questType } = view;
  // Re-sync if the same screen is re-opened at a different chain (nav reuse).
  useEffect(() => {
    setView({ chain: paramChain, questType: paramType });
  }, [paramChain, paramType]);

  // The pairing this tree sits in: what it upgrades INTO, and what it upgraded
  // FROM. At most one of the two is set for any chain.
  const upgrade  = upgradeFor(chain);
  const base     = baseOf(chain);
  // The pair's BASE chain — the key the upgrade state is stored under, whichever
  // half is currently on screen.
  const pairBase = base?.chain ?? chain;

  // ALL quest rows for this chain — including hidden challenges the player has
  // not unlocked yet. Everything below renders `quests`, the revealed subset.
  const [allQuests,   setAllQuests]   = useState([]);
  // Completions AS STORED — only real, self-owned nodes are ever in here. The
  // set the tree renders from is `completions` below, which adds the mirrored
  // nodes (see lib/mirrorQuests.js).
  const [rawCompletions, setRawCompletions] = useState(new Set());
  // id → { name, chain } of every quest a mirror node on this tree points at,
  // so the node can say WHERE its requirement is actually earned.
  const [mirrorSources, setMirrorSources] = useState({});
  const [loading,     setLoading]     = useState(true);
  const [hasTiers,    setHasTiers]    = useState(false);
  const [classOrder,  setClassOrder]  = useState(0);
  const [studentId,   setStudentId]   = useState(null);
  const [pendingQuest, setPendingQuest] = useState(null);
  const [toggling,     setToggling]     = useState(false);
  // ── MULTI-SIGN ──
  // Signing off a whole run of nodes one confirm-card at a time is a chore, so
  // the tree has a second mode: open a queue, tap the nodes in order, commit the
  // lot in one go. There is no direction switch — the FIRST node tapped decides
  // it: start on an unsigned node and the run signs off; start on a signed one
  // and the run takes back.
  const [picking,  setPicking]  = useState(false);  // is the queue open?
  const [picks,    setPicks]    = useState([]);     // quest ids, IN TAP ORDER
  const [applying, setApplying] = useState(false);
  // Which way the open run goes, read off its first pick. Empty queue = no
  // direction committed yet, so BOTH kinds of node are live to start from.
  const pickMode = picks.length === 0
    ? null
    : (rawCompletions.has(picks[0]) ? 'remove' : 'add');
  // Moving between the two halves of an upgrade pair (or any refetch driven by
  // it) lands on a different set of nodes — an open queue from the old one would
  // be meaningless there, so it closes with the view.
  useEffect(() => { setPicking(false); setPicks([]); }, [view]);
  // The node that JUST got confirmed done — fires its gold completion burst.
  const [celebrateId,  setCelebrateId]  = useState(null);
  // The hidden challenge that JUST revealed itself — the node the player didn't
  // know existed until this tap. Drives its own dramatic entrance (see the
  // `reveal` prop on QuestNode); cleared on every refetch so it fires ONCE, at
  // the moment of discovery, and never again on a later visit.
  const [revealId,     setRevealId]     = useState(null);
  // The connectors feeding a challenge would otherwise be drawn the instant the
  // node joins the tree — two gold-lit lines pointing at empty space, spoiling
  // the beat. Held back until the node itself lands.
  const [linksArmed,   setLinksArmed]   = useState(true);
  // Safe-area padding for the full-page card (canvas units — see constants/layout).
  const insets = useAppInsets();
  // Available width inside the frame → used to fit the whole tree to the phone.
  const [availW,       setAvailW]       = useState(0);
  // COMBOES-only "SHAPES" glossary popup — explains the shapes sequence the combo
  // nodes reference. Gated to this one chain so no other tree grows the button.
  const [showShapesInfo, setShowShapesInfo] = useState(false);
  // Keyed on the PAIR, not the chain — EXTREME COMBO's nodes lean on the shapes
  // sequence just as hard as the basic combos do, so the glossary follows the
  // quest through its upgrade.
  const hasShapesGloss = pairBase === 'comboes';
  // Has this player taken the upgrade on this pair? Drives BOTH the reveal (an
  // un-taken upgrade behind a cleared tree) and the version switch (a taken one
  // means the two halves are freely interchangeable from here on).
  const [pairUpgraded, setPairUpgraded] = useState(false);
  // The upgrade is being written / the swap is animating.
  const [upgrading,    setUpgrading]    = useState(false);
  // Downgrading WIPES this quest's completions, so it asks first.
  const [confirmDowngrade, setConfirmDowngrade] = useState(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const targetId = overrideStudentId ?? user.id;
      setStudentId(targetId);

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
          .eq('student_id', targetId),
        supabase
          .from('classes')
          .select('order_index')
          .eq('id', classId)
          .single(),
      ]);

      const rows = qRes.data ?? [];
      setAllQuests(rows);
      // Same overlay the list screens use — a refetch that races the player's
      // own just-committed toggle must not un-light the node they just cleared.
      setRawCompletions(reconcileQuestProgress(
        targetId, new Set((cRes.data ?? []).map(c => c.quest_id))));

      // A mirror node points at a quest in ANOTHER chain, so its source row is
      // not in the fetch above — pull just those, to label the node with the
      // quest that actually owns it.
      const mirrorIds = [...new Set(rows.map(q => q.mirror_quest_id).filter(Boolean))];
      if (mirrorIds.length) {
        const { data: srcRows } = await supabase
          .from('class_quests')
          .select('id, name, chain')
          .in('id', mirrorIds);
        setMirrorSources(Object.fromEntries((srcRows ?? []).map(r => [r.id, r])));
      } else {
        setMirrorSources({});
      }
      // Only pairs need the lookup — every other quest is definitionally not
      // upgraded and shouldn't pay for a round-trip.
      setPairUpgraded(
        upgradeFor(pairBase)
          ? (await fetchUpgrades(supabase, targetId, classId)).has(pairBase)
          : false,
      );

      const order = clsRes.data?.order_index ?? 0;
      setClassOrder(order);
      // Tier gating:
      //  • static ladder — Class III+ (the order gate), as before.
      //  • handstand job — NOT by class order; tiers are opt-in per quest, so only
      //    the chains in HANDSTAND_TIERED_CHAINS draw a divider (currently NONE —
      //    push's old power/mobility TIER II now lives in its own flat FOUNDATION
      //    quest). The rest are faithful single-tier copies of static quests, so
      //    they stay un-tiered even at order >= 2 (e.g. shapes/hspu).
      setHasTiers(
        job === 'handstand'
          ? HANDSTAND_TIERED_CHAINS.includes(chain)
          : order >= TIER_MIN_CLASS_ORDER,
      );
    } catch (e) {
      console.error('[QuestTreeScreen]', e);
    }
    setLoading(false);
  }, [classId, chain, questType, job, pairBase, overrideStudentId]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    setRevealId(null);
    setLinksArmed(true);
    fetchData();
  }, [fetchData]));

  // What the tree renders from: stored completions PLUS every mirror node whose
  // source quest is done. A mirror node never has a row of its own, so without
  // this it would read locked forever and would gate its children.
  const completions = useMemo(
    () => withMirrorCompletions(allQuests, rawCompletions),
    [allQuests, rawCompletions],
  );

  // A hidden challenge doesn't exist for the player until every prerequisite is
  // done — it's filtered out of the tree, the node count and the LVL readout, so
  // nothing hints at it. The moment the last prerequisite lands it drops in
  // (mounting fresh, so its normal entrance animation plays as the reveal).
  const quests = useMemo(
    () => visibleQuests(allQuests, completions),
    [allQuests, completions],
  );

  // ── Layout ────────────────────────────────────────────────────────────────

  // Tiers are an intentional MAIN-quest concept. Side quests must never render a
  // TIER divider — their multi-branch merges (e.g. hs_beginners tuck+straddle)
  // look identical to a tier crossing but are not one.
  const applyTiers = hasTiers && questType === 'main';

  // Nodes that are MAIN-quest prestige requirements for this class — highlighted
  // with a live animated frame (blue while unmet, gold once completed).
  const requiredIds = useMemo(
    () => requiredMainQuestIds(classOrder, quests, job),
    [classOrder, quests, job],
  );

  const { positions, firstNodeOfBranch, labelXOf, width, height, nodeWidth } =
    useMemo(
      () => spaceOutHiddenNodes(
        chain === 'handstand'
          ? computeHandstandLayout(quests, { applyTiers })
          : computeLayout(quests, { applyTiers, chain }),
        quests,
      ),
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

    // A branch label sits LABEL_OFFSET above the first node of its branch, so when
    // the first Tier-2 row starts a branch (e.g. HSPU) that label lives inside this
    // same gap. Reserve its band at the BOTTOM and centre the rule in what's left,
    // so the rule and the branch heading never collide.
    const labelBelow = Object.values(firstNodeOfBranch ?? {})
      .some(q => tier2.has(q.id));
    const bottom = firstT2Top - (labelBelow ? LABEL_OFFSET + TIER_LABEL_GAP : 0);

    return (lastT1Bottom + Math.max(lastT1Bottom, bottom)) / 2;
  }, [applyTiers, quests, positions, firstNodeOfBranch]);

  // Fit-to-width: scale the whole tree down so its full width fits the phone.
  // (≤1 only — never blow a small tree up past its natural size.)
  const treeScale = useMemo(() => {
    if (!(availW > 0 && width > 0)) return 1;
    // The cap is expressed against the STANDARD node so a deliberately wide node
    // (WIDE_NODE_W, used for long single-column names) scales like everything
    // else instead of being shrunk to unreadable type.
    const cap = Math.min(1, NODE_ON_SCREEN_MAX / NODE_W);
    return Math.min(cap, availW / width);
  }, [availW, width]);

  // Shared "energy flow" clock — a single looping value that marches the dashed
  // overlay along every COMPLETED connector (parent → child), so mastery visibly
  // courses down the tree. One value drives them all, so the cost is one timer.
  const flow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(flow, {
      toValue: 1, duration: 850, easing: Easing.linear, useNativeDriver: false,
    }));
    loop.start();
    return () => loop.stop();
  }, [flow]);
  // One dash period (dash 5 + gap 13 = 18). Negative offset moves dashes in the
  // path's drawn direction = downstream toward the child.
  const dashOffset = flow.interpolate({ inputRange: [0, 1], outputRange: [0, -18] });

  // ── Node state ────────────────────────────────────────────────────────────

  function nodeState(quest) {
    if (completions.has(quest.id)) return 'done';
    // A mirror node is never "unlocked" — there is nothing to tap here. Until
    // its source quest is done it stays dim, so it never breathes at the player
    // like a next move they could make on this tree.
    if (isMirrorQuest(quest)) return 'locked';
    const pre = quest.prerequisites ?? [];
    return pre.every(id => completions.has(id)) ? 'unlocked' : 'locked';
  }

  // ── Un-complete gate ───────────────────────────────────────────────────────
  // A node can only be un-done from the BOTTOM of the tree. If something
  // downstream of it is already done, undoing it would leave the tree in a state
  // that can't exist — a cleared node hanging off an un-cleared prerequisite. So
  // the removal is refused and the card names what has to come off first.
  // (Mirror children are excluded: they own no row here, their state is decided
  // in the quest that owns them.)
  function removalBlockers(quest) {
    return allQuests.filter(q =>
      !isMirrorQuest(q) &&
      completions.has(q.id) &&
      (q.prerequisites ?? []).includes(quest.id));
  }

  // ── Toggle (self-coach: the player controls their own level) ────────────────

  async function toggleQuest(quest) {
    if (!studentId) return;
    // Same rule the card enforces — kept here too so no path can slip a
    // dependent-orphaning delete past it.
    if (rawCompletions.has(quest.id) && removalBlockers(quest).length > 0) return;
    // Mirrored requirement — owned by another quest, so it can only be earned
    // there. The tap already opened the "where to earn it" card instead.
    if (isMirrorQuest(quest)) return;
    // Coach-approved node — owned by the COACH. Same block, other reason: the
    // player's tap opened the "your coach checks this one" card.
    if (!canToggleCoachQuest(quest, isCoachViewer)) return;
    setToggling(true);
    const done = rawCompletions.has(quest.id);
    try {
      if (done) {
        const { error: delErr } = await supabase
          .from('student_quest_completions')
          .delete()
          .eq('student_id', studentId)
          .eq('quest_id', quest.id);
        if (delErr) throw delErr;
        setRawCompletions(prev => { const s = new Set(prev); s.delete(quest.id); return s; });
        // Hand the change to the list screens as well, so a card that stops being
        // maxed drops its gold on the way back instead of a refetch later.
        noteQuestUncompleted(studentId, quest.id);
        hapticTap();
      } else {
        const { error: insErr } = await supabase
          .from('student_quest_completions')
          .insert({ student_id: studentId, quest_id: quest.id });
        if (insErr) throw insErr;
        const next = withMirrorCompletions(allQuests, new Set([...rawCompletions, quest.id]));
        setRawCompletions(prev => new Set([...prev, quest.id]));
        // The list screens get it NOW, not on their next refetch — so a chain this
        // tap just cleared is already MAXED OUT the moment the player swipes back.
        noteQuestCompleted(studentId, quest.id);
        // The payoff: gold burst on the node + a success thump in the hand.
        setCelebrateId(quest.id);
        hapticSuccess();

        // Did THIS tap complete the last prerequisite of a hidden challenge?
        // If so the node is about to mount for the very first time — flag it so
        // it enters with the discovery sequence instead of a plain fade-in, and
        // land a second thump under the shockwave.
        const unveiled = allQuests.find(q =>
          q.is_hidden && !isRevealed(q, completions) && isRevealed(q, next));
        if (unveiled) {
          setRevealId(unveiled.id);
          setLinksArmed(false);
          setTimeout(hapticSuccess, REVEAL_DELAY);
          setTimeout(() => setLinksArmed(true), REVEAL_DELAY + 260);
        }
      }
    } catch (e) {
      console.error('[QuestTreeScreen] toggleQuest:', e);
    }
    setToggling(false);
  }

  // ── MULTI-SIGN queue ───────────────────────────────────────────────────────
  // The queue is only ever allowed to hold a run that is legal *in order*:
  //   add    → a node can join once its prerequisites are done OR already queued
  //            ahead of it, so the run climbs the tree (easiest → hardest).
  //   remove → a node can join once everything completed that depends on it is
  //            already queued ahead of it, so the run comes DOWN the tree
  //            (hardest → easiest) and never orphans a cleared node.
  // That means whatever order the picks are tapped in is a valid order to apply
  // them in, and the chips on the nodes read back as 1, 2, 3...

  function pickEligible(quest, selected, mode = pickMode) {
    if (isMirrorQuest(quest)) return false;
    if (!canToggleCoachQuest(quest, isCoachViewer)) return false;
    // No direction committed yet: this tap is the one that decides it, so the
    // node only has to be a legal FIRST pick of whichever run it would start.
    if (!mode) {
      return pickEligible(quest, selected,
        rawCompletions.has(quest.id) ? 'remove' : 'add');
    }
    if (mode === 'add') {
      if (completions.has(quest.id)) return false;
      return (quest.prerequisites ?? [])
        .every(id => completions.has(id) || selected.has(id));
    }
    if (mode === 'remove') {
      if (!rawCompletions.has(quest.id)) return false;
      return removalBlockers(quest).every(b => selected.has(b.id));
    }
    return false;
  }

  const pickSet = useMemo(() => new Set(picks), [picks]);

  // Re-walk a queue in order and drop anything that is no longer legal — used
  // after a pick is pulled out of the middle of the run, which can strand every
  // pick that was leaning on it.
  function prunePicks(list) {
    const kept = [];
    const sel  = new Set();
    // Pulling the first pick out of the run hands the direction to whatever
    // survives as the new first pick, so the mode is re-read as we walk.
    let mode = null;
    list.forEach(id => {
      const q = allQuests.find(x => x.id === id);
      const m = mode ?? (rawCompletions.has(id) ? 'remove' : 'add');
      if (!q || !pickEligible(q, sel, m)) return;
      kept.push(id);
      sel.add(id);
      mode = m;
    });
    return kept;
  }

  function togglePick(quest) {
    if (picks.includes(quest.id)) {
      setPicks(prev => prunePicks(prev.filter(id => id !== quest.id)));
      hapticTap();
      return;
    }
    if (!pickEligible(quest, pickSet)) return;
    setPicks(prev => [...prev, quest.id]);
    hapticTap();
  }

  function closePicker() {
    setPicking(false);
    setPicks([]);
  }

  // Commit the whole run at once. The queue is already a legal order, so the
  // rows go in (or come out) in a single round-trip instead of one per node.
  async function applyPicks() {
    if (!studentId || applying || picks.length === 0) return;
    setApplying(true);
    const ids = [...picks];
    try {
      if (pickMode === 'add') {
        const { error } = await supabase
          .from('student_quest_completions')
          .insert(ids.map(id => ({ student_id: studentId, quest_id: id })));
        if (error) throw error;
        setRawCompletions(prev => new Set([...prev, ...ids]));
        ids.forEach(id => noteQuestCompleted(studentId, id));
        // One burst, on the last node of the run — the top of what was climbed.
        setCelebrateId(ids[ids.length - 1]);
        hapticSuccess();
      } else {
        const { error } = await supabase
          .from('student_quest_completions')
          .delete()
          .eq('student_id', studentId)
          .in('quest_id', ids);
        if (error) throw error;
        setRawCompletions(prev => {
          const next = new Set(prev);
          ids.forEach(id => next.delete(id));
          return next;
        });
        ids.forEach(id => noteQuestUncompleted(studentId, id));
        hapticTap();
      }
      closePicker();
    } catch (e) {
      console.error('[QuestTreeScreen] applyPicks:', e);
    }
    setApplying(false);
  }

  // What the run is worth, shown on the bar before it is committed.
  const pickLvl = picks.reduce((sum, id) => {
    const q = allQuests.find(x => x.id === id);
    return sum + (q?.lvl_reward ?? 0);
  }, 0);

  // ── Upgrade ───────────────────────────────────────────────────────────────
  // The gate opens only on the BASE half of a pair, only once every visible node
  // is done, and only while the upgrade hasn't been taken yet. (Hidden challenges
  // are already excluded from `quests` until revealed, so an unrevealed one can't
  // hold the gate shut — but a revealed one has to be cleared like any node.)
  const upgradeReady = !!upgrade && !pairUpgraded && chainCleared(quests, completions);

  async function takeUpgrade() {
    if (!studentId || !upgrade || upgrading) return;
    setUpgrading(true);
    try {
      await saveUpgrade(supabase, studentId, classId, chain);
      hapticSuccess();
      setPairUpgraded(true);
      // Become the harder quest. The refetch is driven by the chain change (the
      // focus effect re-runs when fetchData's identity moves with it).
      setLoading(true);
      setView({ chain: upgrade.chain, questType: upgrade.questType });
    } catch (e) {
      console.error('[QuestTreeScreen] takeUpgrade:', e);
    }
    setUpgrading(false);
  }

  // The undo, offered on the UPGRADED half only: hand the upgrade back and land
  // on the base quest, where the gate is waiting again. Shown whatever the
  // progress is — an upgrade taken by accident gets fixed the moment it's
  // noticed, which is usually before a single node of it is done.
  const canDowngrade = !!base && pairUpgraded;

  async function undoUpgrade() {
    if (!studentId || !base || upgrading) return;
    setUpgrading(true);
    try {
      // `allQuests` (not `quests`) — an unrevealed hidden challenge can't be
      // completed, but a REVEALED one can, and it has to be wiped with the rest.
      // Mirror nodes have no rows of their own, so listing them is a harmless
      // no-op.
      await removeUpgrade(supabase, studentId, base.chain, allQuests.map(q => q.id));
      hapticTap();
      setConfirmDowngrade(false);
      setPairUpgraded(false);
      setLoading(true);
      setView({ chain: base.chain, questType: base.questType });
    } catch (e) {
      console.error('[QuestTreeScreen] undoUpgrade:', e);
    }
    setUpgrading(false);
  }

  // Where the header switch goes: down to the base quest from the upgrade, or
  // back up to the upgrade from the base. Null when this quest has no pair, or
  // has one the player hasn't unlocked yet.
  const switchTarget = !pairUpgraded ? null
    : base    ? { ...base, toUpgrade: false }
    : upgrade ? { ...upgrade, toUpgrade: true }
    : null;

  // ── Stats ─────────────────────────────────────────────────────────────────

  const doneCount = quests.filter(q => completions.has(q.id)).length;
  const earnedLvl = quests
    .filter(q => completions.has(q.id))
    .reduce((s, q) => s + (q.lvl_reward ?? 0), 0);

  // ── Lines (orthogonal, bend near child) ───────────────────────────────────

  function buildLines() {
    return quests.flatMap(q => {
      if (!linksArmed && q.id === revealId) return [];
      const prereqs = q.prerequisites ?? [];
      return prereqs.map(pid => {
        const child  = positions[q.id];
        const parent = positions[pid];
        if (!child || !parent) return null;

        const done  = completions.has(q.id) && completions.has(pid);
        const state = nodeState(q);
        // Links INTO a hidden challenge run gold, not ice — the two branch tips
        // visibly feed the treasure they just unearthed.
        const lit   = q.is_hidden ? SL.gold : SL.accent;
        const color = (done || state === 'unlocked') ? lit : SL.muted;

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

        const key = `${pid}->${q.id}`;

        // Completed link — a dim solid "wire" with a bright energy dash flowing
        // down it. The dash shares the screen's single `flow` clock. Returned as a
        // flat array (not a Fragment) so it survives react-native-svg's child
        // handling on every platform.
        if (done) {
          return [
            <Path key={`${key}-wire`} d={d} stroke={lit} strokeWidth={2} fill="none" opacity={0.4} />,
            <AnimatedPath
              key={`${key}-flow`}
              d={d}
              stroke={q.is_hidden ? '#FFE9A3' : '#9FE4FF'}
              strokeWidth={2.5}
              strokeLinecap="round"
              fill="none"
              strokeDasharray="5 13"
              strokeDashoffset={dashOffset}
              opacity={0.95}
            />,
          ];
        }

        // Unmet link — static hairline (faint when the child is still locked).
        return (
          <Path
            key={key}
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

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={SL.accent} />
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* One page-sized ice-glow frame (matches SkillsScreen's body width) wraps
          EVERYTHING — header + the tree. The tree scrolls horizontally INSIDE
          the frame instead of stretching it. */}
      {/* The frame is ALWAYS the full page (top inset → bottom), exactly like
          ScreenFrame's card: its size never depends on how many nodes the quest
          has, so a 3-node side quest draws the same box as a 40-node main quest.
          The content scrolls INSIDE it. */}
      {/* While the MULTI-SIGN bar is docked it covers the foot of the tree, so
          the scroll grows by its height and the last nodes stay reachable. */}
      <View style={[styles.frameOuter, { paddingTop: FRAME_PAD_V + insets.top }]}>
        <View style={styles.treeFrame}>
        <ScrollView style={styles.frameScroll} contentContainerStyle={styles.scrollBody}>

        {/* Header */}
        <View style={styles.header}>
          {/* Standard glowing BACK pill, left-aligned */}
          <View style={styles.headerTopRow}>
            {/* Sized to match the pair controls on the right, so the header
                reads as one row of equals rather than a big pair beside a
                leftover small button. */}
            <PillButton
              label="← BACK"
              size="lg"
              onPress={() => navigation.goBack()}
              style={styles.headerBackPill}
              textStyle={styles.headerBackText}
            />
            {/* Yields its width first, so the three pills keep their row. */}
            <View style={styles.headerSpacer} />

            {/* The pair's two controls, together on the right: move BETWEEN the
                versions, or give the upgrade back entirely. */}
            <View style={styles.headerActions}>
              {switchTarget && (
                <VersionSwitch
                  toUpgrade={switchTarget.toUpgrade}
                  label={switchTarget.chain}
                  onPress={() => {
                    hapticTap();
                    setLoading(true);
                    setView({ chain: switchTarget.chain, questType: switchTarget.questType });
                  }}
                />
              )}
              {canDowngrade && (
                <DowngradeButton
                  onPress={() => setConfirmDowngrade(true)}
                  busy={upgrading}
                />
              )}
            </View>
          </View>

          {/* Quest name — the hero title (color + shining kept; entrance added) */}
          <HeroTitle text={chain.replace(/_/g, ' ').toUpperCase()} />

          {/* Quest-type badge — gem emblem. An upgrade's rows are SEEDED as
              'side' but it is shown as the main quest it replaced, so the badge
              follows the pair, not the raw column. */}
          <QuestTypeBadge questType={base?.questType ?? questType} />

          {/* COMBOES only — "SHAPES ?" glossary button. Explains the shapes
              sequence the combo nodes build on. */}
          {hasShapesGloss && (
            <TouchableOpacity
              style={styles.shapesGlossBtn}
              onPress={() => setShowShapesInfo(true)}
              activeOpacity={0.85}
            >
              <Text style={styles.shapesGlossBtnText}>SHAPES</Text>
              <View style={styles.shapesGlossQ}>
                <Text style={styles.shapesGlossQText}>?</Text>
              </View>
            </TouchableOpacity>
          )}

          {/* Status HUD — completion meter + ticking readouts (gold at 100%) */}
          <QuestHUD done={doneCount} total={quests.length} earnedLvl={earnedLvl} />

          {/* MULTI-SIGN — sign off (or take back) a whole run of nodes in one
              go instead of one confirm card per node. Closed, it is a single
              pill; open, it stays the same small slot and just becomes the two
              buttons the run needs: CLEAR and the action. Which action it is
              follows the first node tapped — start on an unsigned node and the
              run signs off, start on a signed one and it takes back. */}
          {!picking ? (
            <TouchableOpacity
              style={styles.multiOpen}
              activeOpacity={0.85}
              onPress={() => { hapticTap(); setPicking(true); setPicks([]); }}
            >
              <Text style={styles.multiOpenText}>MULTI-SIGN</Text>
            </TouchableOpacity>
          ) : (
            <View style={[
              styles.pickBarTop,
              pickMode === 'remove' && styles.pickBarTopRemove,
            ]}>
              <TouchableOpacity
                style={styles.pickClear}
                activeOpacity={0.85}
                disabled={applying}
                onPress={() => {
                  hapticTap();
                  if (picks.length > 0) setPicks([]);
                  else closePicker();
                }}
              >
                <Text style={styles.pickClearText}>
                  {picks.length > 0 ? 'CLEAR' : 'CLOSE'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.pickGo,
                  pickMode === 'remove' && styles.pickGoRemove,
                  picks.length === 0 && styles.pickApplyOff,
                ]}
                activeOpacity={0.85}
                disabled={applying || picks.length === 0}
                onPress={applyPicks}
              >
                {applying
                  ? <ActivityIndicator color={SL.bg} size="small" />
                  : (
                    <Text style={styles.pickGoText}>
                      {pickMode === 'remove' ? 'REMOVE' : 'CONFIRM'}
                      {picks.length > 0
                        ? ` ${picks.length} · ${pickMode === 'remove' ? '−' : '+'}${pickLvl}`
                        : ''}
                    </Text>
                  )}
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.headerDivider} />
        </View>

        {/* Tree — scaled into the node-size band (see NODE_ON_SCREEN_MAX). It
            still fits the card in almost every case; a tree that lands a little
            over pans sideways inside the card rather than shrinking further. */}
        <View
          style={styles.treeFitArea}
          onLayout={e => setAvailW(e.nativeEvent.layout.width - TREE_PAD_H * 2)}
        >
          {availW > 0 && width > 0 ? (
          <View style={{ width: width * treeScale, height: height * treeScale }}>
          <View style={{
            width, height, position: 'relative',
            transform: [{ scale: treeScale }],
            transformOrigin: 'top left',
          }}>

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
              // A branch made of hidden challenges gets the gold "HIDDEN
              // CHALLENGE" banner instead of its raw branch name — it can only
              // be on screen at all once the challenge has been unlocked.
              const challengeBranch = q.is_hidden;
              if (challengeBranch) {
                return (
                  <View
                    key={`label-${branch}`}
                    // The banner is far bigger than a branch label, so it gets a
                    // container wider than the node (centred on it) — the space
                    // either side is empty anyway, and it must never wrap.
                    style={{
                      position: 'absolute',
                      left:  lx - w / 2,
                      top:   p.y - CHALLENGE_LABEL_OFFSET,
                      width: w * 2,
                      alignItems: 'center',
                    }}
                    pointerEvents="none"
                  >
                    <ChallengeBanner reveal={revealId === q.id} />
                  </View>
                );
              }
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
                style={[styles.tierDivider, { top: tierDividerY - TIER_RULE_H / 2, width }]}
                pointerEvents="none"
              >
                <View style={[styles.tierLine, styles.tierLineGold]} />
                <ShimmerText text="TIER II" style={styles.tierLabel} colors={GOLD} direction="ltr" active />
                <View style={[styles.tierLine, styles.tierLineGold]} />
              </View>
            )}

            {/* Nodes — each cascades in delayed by its tree rank, so the tree
                grows downward from its roots. */}
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
                  <QuestNode
                    quest={q}
                    state={nodeState(q)}
                    isRequired={requiredIds.has(q.id)}
                    nodeWidth={nodeWidth ?? NODE_W}
                    delay={Math.min((p.rank ?? 0) * 80, 720)}
                    disabled={toggling || applying}
                    celebrate={celebrateId === q.id}
                    reveal={revealId === q.id}
                    mirrorSource={mirrorSources[q.mirror_quest_id] ?? null}
                    coachLocked={!canToggleCoachQuest(q, isCoachViewer)}
                    pickMode={pickMode}
                    pickIndex={picks.indexOf(q.id) >= 0 ? picks.indexOf(q.id) : null}
                    pickable={picking && pickEligible(q, pickSet)}
                    onPress={() => (picking ? togglePick(q) : setPendingQuest(q))}
                  />
                </View>
              );
            })}

          </View>
          </View>
          ) : null}
        </View>

        {/* Every node cleared and an upgrade waiting → the gold gate rises. */}
        {upgradeReady && (
          <UpgradeGate onPress={takeUpgrade} busy={upgrading} />
        )}
        </ScrollView>
        </View>
      </View>

      {/* ── Confirmation popup — system-notification style card ── */}
      <Modal
        visible={pendingQuest !== null}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!toggling) setPendingQuest(null); }}
      >
        <View style={styles.confirmOverlay}>
          {pendingQuest && isMirrorQuest(pendingQuest) && (() => {
            // Mirrored requirement: not a confirm dialog at all. It exists to
            // say WHERE this node is earned — the player has to go and do it in
            // the quest that owns it.
            const src   = mirrorSources[pendingQuest.mirror_quest_id] ?? null;
            const where = (src?.chain ?? '').replace(/_/g, ' ').toUpperCase();
            const met   = completions.has(pendingQuest.id);
            return (
              <View style={styles.confirmCard}>
                <Text style={styles.confirmCardTitle}>OUTSIDE REQUIREMENT</Text>
                <Text style={styles.confirmCardName}>{pendingQuest.name}</Text>
                <Text style={styles.mirrorNote}>
                  {met
                    ? `Earned in the ${where || 'other'} main quest — it counts here automatically.`
                    : `This one belongs to the ${where || 'other'} main quest. Confirm it there and it unlocks here on its own.`}
                </Text>
                <View style={styles.confirmButtons}>
                  <TouchableOpacity
                    style={styles.confirmOk}
                    activeOpacity={0.85}
                    onPress={() => setPendingQuest(null)}
                  >
                    <Text style={styles.confirmOkText}>GOT IT</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })()}

          {pendingQuest && !isMirrorQuest(pendingQuest)
            && !canToggleCoachQuest(pendingQuest, isCoachViewer) && (() => {
            // Coach-approved node, seen by the PLAYER: not a confirm dialog —
            // there is nothing here they can press. It says who signs it off.
            const met = completions.has(pendingQuest.id);
            return (
              <View style={styles.confirmCard}>
                <Text style={[styles.confirmCardTitle, styles.confirmCardTitleCoach]}>
                  COACH APPROVAL
                </Text>
                <Text style={styles.confirmCardName}>{pendingQuest.name}</Text>
                <Text style={styles.mirrorNote}>
                  {met
                    ? 'Your coach signed this one off — it counts.'
                    : 'Only your coach can check this one. Show them the skill and they will approve it from their side.'}
                </Text>
                <View style={styles.confirmButtons}>
                  <TouchableOpacity
                    style={styles.confirmOk}
                    activeOpacity={0.85}
                    onPress={() => setPendingQuest(null)}
                  >
                    <Text style={styles.confirmOkText}>GOT IT</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })()}

          {pendingQuest && !isMirrorQuest(pendingQuest)
            && canToggleCoachQuest(pendingQuest, isCoachViewer) && (() => {
            const removing = completions.has(pendingQuest.id);
            const reward   = pendingQuest.lvl_reward ?? 0;
            const blockers = removing ? removalBlockers(pendingQuest) : [];

            // Blocked removal — everything downstream has to come off first, so
            // this isn't a confirm dialog either. It just names the way back.
            if (blockers.length > 0) {
              return (
                <View style={styles.confirmCard}>
                  <Text style={styles.confirmCardTitle}>LOCKED IN</Text>
                  <Text style={styles.confirmCardName}>{pendingQuest.name}</Text>
                  <Text style={styles.mirrorNote}>
                    {`Cancel: ${blockers.map(b => b.name).join(', ')}`}
                  </Text>
                  <View style={styles.confirmButtons}>
                    <TouchableOpacity
                      style={styles.confirmOk}
                      activeOpacity={0.85}
                      onPress={() => setPendingQuest(null)}
                    >
                      <Text style={styles.confirmOkText}>GOT IT</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }

            return (
              <View style={styles.confirmCard}>
                <Text style={[
                  styles.confirmCardTitle,
                  isCoachQuest(pendingQuest) && styles.confirmCardTitleCoach,
                ]}>
                  {isCoachQuest(pendingQuest)
                    ? (removing ? 'WITHDRAW APPROVAL' : 'APPROVE QUEST')
                    : (removing ? 'REMOVE QUEST' : 'COMPLETE QUEST')}
                </Text>
                <Text style={styles.confirmCardName}>{pendingQuest.name}</Text>
                <Text style={[
                  styles.confirmCardDelta,
                  removing ? styles.confirmCardDeltaDown : styles.confirmCardDeltaUp,
                ]}>
                  {removing ? `−${reward}` : `+${reward}`} LVL
                </Text>

                <View style={styles.confirmButtons}>
                  <TouchableOpacity
                    style={styles.confirmCancel}
                    onPress={() => setPendingQuest(null)}
                    disabled={toggling}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.confirmCancelText}>CANCEL</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.confirmOk}
                    disabled={toggling}
                    activeOpacity={0.85}
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
            );
          })()}
        </View>
      </Modal>

      {/* ── Downgrade confirmation ── */}
      {/* The one place in the app where progress is destroyed in bulk, so it
          says exactly what goes and exactly what survives before it happens. */}
      <Modal
        visible={confirmDowngrade}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!upgrading) setConfirmDowngrade(false); }}
      >
        <View style={styles.confirmOverlay}>
          {/* `base` is guaranteed by canDowngrade, but Modal renders its children
              even while hidden — so never reach into it unguarded. */}
          {confirmDowngrade && base && (
          <View style={styles.confirmCard}>
            <Text style={styles.confirmCardTitle}>CONFIRM DOWNGRADE</Text>
            {/* Name the destination, not the quest being given up — the player
                is choosing where they land, which is the original chain. */}
            <Text style={styles.confirmCardName} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>
              {`RETURN TO ${base.chain.replace(/_/g, ' ').toUpperCase()}`}
            </Text>
            {doneCount > 0 && (
              <Text style={[styles.confirmCardDelta, styles.confirmCardDeltaDown]}>
                −{earnedLvl} LVL
              </Text>
            )}
            <View style={styles.confirmButtons}>
              <TouchableOpacity
                style={styles.confirmCancel}
                onPress={() => setConfirmDowngrade(false)}
                disabled={upgrading}
                activeOpacity={0.8}
              >
                <Text style={styles.confirmCancelText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmOk}
                onPress={undoUpgrade}
                disabled={upgrading}
                activeOpacity={0.85}
              >
                {upgrading
                  ? <ActivityIndicator color={SL.bg} size="small" />
                  : <Text style={[styles.confirmOkText, styles.confirmOkTextLong]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>DOWNGRADE</Text>}
              </TouchableOpacity>
            </View>
          </View>
          )}
        </View>
      </Modal>

      {/* ── SHAPES glossary popup (COMBOES only) ── */}
      <Modal
        visible={showShapesInfo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowShapesInfo(false)}
      >
        <TouchableOpacity
          style={styles.confirmOverlay}
          activeOpacity={1}
          onPress={() => setShowShapesInfo(false)}
        >
          <View style={styles.shapesInfoCard}>
            <Text style={styles.shapesInfoTitle}>SHAPES</Text>
            <Text style={styles.shapesInfoBody}>
              Start with STRAIGHT for 5 sec → STRADDLE → DIAMOND → TUCK, then
              reverse back: TUCK → DIAMOND → STRADDLE → STRAIGHT.
            </Text>
            <TouchableOpacity
              style={styles.shapesInfoClose}
              onPress={() => setShowShapesInfo(false)}
              activeOpacity={0.85}
            >
              <Text style={styles.shapesInfoCloseText}>GOT IT</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg, position: 'relative' },

  // Header
  header: {
    // Narrow: on a phone this row carries THREE pills (BACK + the upgrade pair)
    // and every unit of side padding is one they have to give up.
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: SL.border,
  },
  headerSpacer: { flexGrow: 1, flexShrink: 1, minWidth: 8 },
  headerTopRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    marginBottom: 10,
  },
  // BACK, matched to the pair controls: same height, padding, border weight and
  // type size, so all three header pills sit on one line as equals. (Overrides
  // PillButton's `lg` — the shared component tops out smaller than this row.)
  headerBackPill: {
    flexShrink: 0,
    minHeight: HEADER_PILL_H,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderWidth: 2,
  },
  headerBackText: {
    fontSize: 17,
    letterSpacing: 1.1,
  },

  // The pair controls, right-aligned. NEVER wraps: BACK, the version switch and
  // DOWNGRADE are one row, full stop. If a long chain name runs the row out of
  // width, the two pills shrink (and their labels scale down inside them) rather
  // than one of them dropping to a second line.
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'nowrap',
    flexShrink: 1,
    minWidth: 0,
    gap: 8,
  },

  // ── Version switch (header) ────────────────────────────────────────────────
  // Gold-tinted so it reads as part of the upgrade language, and sized one step
  // below BACK — it still says which of the two versions you're on without
  // dominating the screen.
  verSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    minWidth: 0,
    gap: 7,
    minHeight: HEADER_PILL_H,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(255,215,0,0.45)',
    backgroundColor: 'rgba(255,215,0,0.08)',
  },
  verSwitchArrow: {
    fontFamily: F.body,
    fontSize: 13,
    lineHeight: 17,
    color: SL.gold,
  },
  verSwitchText: {
    flexShrink: 1,
    fontFamily: F.heading,
    fontSize: 17,
    letterSpacing: 1.1,
    color: SL.gold,
  },

  // ── Upgrade gate (foot of a cleared tree) ──────────────────────────────────
  gateWrap: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 34,
  },
  // The beam the plinth rides up on — anchored at the bottom so scaleY grows it
  // upward, out of the tree.
  gateBeam: {
    position: 'absolute',
    top: 0,
    width: 2,
    height: 66,
    backgroundColor: SL.gold,
    shadowColor: SL.gold,
    shadowOpacity: 0.9,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    // Anchored at the tree end so scaleY draws the light DOWN out of the last
    // node and into the plinth that rises to meet it.
    transformOrigin: 'top',
  },
  // Clears the beam above it, so the button lands at the beam's foot rather than
  // inside it.
  gatePlinth: { marginTop: 70 },

  // ── Downgrade (header, beside the version switch) ──────────────────────────
  // Matched to the switch in size so the two read as one pair of controls, but
  // muted and outline-only: an escape hatch should be findable without ever
  // inviting the tap.
  downBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 1,
    minWidth: 0,
    gap: 7,
    minHeight: HEADER_PILL_H,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(74,106,138,0.55)',
    backgroundColor: 'rgba(74,106,138,0.10)',
  },
  downBtnChevron: {
    fontFamily: F.body,
    fontSize: 13,
    lineHeight: 17,
    color: SL.muted,
  },
  downBtnText: {
    flexShrink: 1,
    fontFamily: F.heading,
    fontSize: 17,
    letterSpacing: 1.1,
    color: SL.muted,
  },
  gateHalo: {
    position: 'absolute',
    left: -18,
    right: -18,
    top: -14,
    bottom: -14,
    borderRadius: 999,
    backgroundColor: 'rgba(255,215,0,0.16)',
  },
  gateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minWidth: 232,
    minHeight: 56,
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(255,215,0,0.75)',
    backgroundColor: 'rgba(255,215,0,0.10)',
    position: 'relative',
  },
  gateBtnFrame: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 14,
  },
  gateBtnChevron: {
    fontFamily: F.body,
    fontSize: 14,
    lineHeight: 18,
    color: SL.gold,
  },
  gateBtnText: {
    fontFamily: F.heading,
    fontSize: 22,
    letterSpacing: 3,
    color: SL.gold,
  },
  chainTitle: {
    fontFamily: F.heading,
    fontSize: 46,
    color: SL.text,
    letterSpacing: 4,
    textAlign: 'center',
    // Strong ice-glow halo so the quest name reads as the hero.
    textShadowColor: 'rgba(74,158,191,0.7)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },

  // Quest-type emblem — a glowing capsule with a double-frame line.
  typeBadge: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 999,
    paddingHorizontal: 26,
    paddingVertical: 10,
    backgroundColor: 'rgba(74,158,191,0.14)',
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 18,
    position: 'relative',
  },
  // Faint inner hairline, inset from the border → the "tech" double-frame look.
  typeBadgeInner: {
    position: 'absolute',
    top: 3, left: 3, right: 3, bottom: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(74,158,191,0.32)',
  },
  typeBadgeText: {
    fontFamily: F.heading,
    fontSize: 19,
    letterSpacing: 5,
  },

  // ── Status HUD — completion meter + readouts ────────────────────────────────
  hud: {
    width: '100%',
    maxWidth: 820,
    alignSelf: 'center',
    alignItems: 'stretch',
    marginTop: 20,
    gap: 14,
  },
  // The MASTERED seal floats over the meter when a line is fully cleared.
  masteredWrap: { alignItems: 'center', marginBottom: 2 },
  masteredText: {
    fontFamily: F.heading,
    fontSize: 24,
    color: SL.gold,
    letterSpacing: 6,
    textShadowColor: 'rgba(255,215,0,0.7)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
  },
  // The completion meter — a dark capsule track that the shimmer fill grows into.
  meterTrack: {
    width: '100%',
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(26,58,92,0.45)',
    borderWidth: 1,
    borderColor: SL.border,
    overflow: 'hidden',
    position: 'relative',
  },
  meterFillWrap: {
    height: '100%',
    borderRadius: 11,
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    width: '100%',
    borderRadius: 11,
    backgroundColor: SL.accent,
  },
  // Breathing gold ring on a maxed meter (opacity pulsed by the HUD).
  meterGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: SL.gold,
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 12,
  },
  // Readouts flanking under the meter: count on the left, LVL earned on the right.
  hudStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hudStatNum: {
    fontFamily: F.heading,
    fontSize: 28,
    color: SL.accent,
    letterSpacing: 1,
  },
  hudStatNumGold: {
    fontFamily: F.heading,
    fontSize: 28,
    color: SL.gold,
    letterSpacing: 1,
    textShadowColor: 'rgba(255,215,0,0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  hudStatTag: {
    fontFamily: F.bodyMed,
    fontSize: 15,
    color: SL.muted,
    letterSpacing: 2,
  },
  hudStatTagGold: {
    fontFamily: F.bodyMed,
    fontSize: 15,
    color: SL.gold,
    opacity: 0.85,
    letterSpacing: 2,
  },
  // ── MULTI-SIGN ─────────────────────────────────────────────────────────────
  multiOpen: {
    alignSelf: 'center',
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(74,158,191,0.55)',
    backgroundColor: 'rgba(74,158,191,0.10)',
  },
  multiOpenText: {
    fontFamily: F.heading,
    fontSize: 15,
    letterSpacing: 1.6,
    color: SL.accent,
  },
  // Open queue — the same small header slot the MULTI-SIGN pill sat in, now
  // holding just the two controls a run needs: CLEAR and the action.
  pickBarTop: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    padding: 5,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(74,158,191,0.55)',
    backgroundColor: 'rgba(74,158,191,0.07)',
  },
  // Tints red the moment the run's first pick makes it a take-back.
  pickBarTopRemove: {
    borderColor: 'rgba(255,68,68,0.55)',
    backgroundColor: 'rgba(255,68,68,0.06)',
  },
  pickClear: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: SL.border,
  },
  pickClearText: {
    fontFamily: F.heading,
    fontSize: 13,
    letterSpacing: 1.2,
    color: SL.muted,
  },
  pickGo: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 30,
    minWidth: 116,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: SL.accent,
  },
  pickGoRemove: { backgroundColor: SL.danger },
  pickGoText: {
    fontFamily: F.heading,
    fontSize: 13,
    letterSpacing: 1.2,
    color: SL.bg,
  },
  pickApplyOff:    { opacity: 0.35 },
  pickApplyText: {
    fontFamily: F.heading,
    fontSize: 15,
    letterSpacing: 1.4,
    color: SL.bg,
  },

  // Queued node — tinted by direction, so a run reads at a glance.
  questCardPickAdd: {
    borderColor: SL.accent,
    backgroundColor: 'rgba(74,158,191,0.22)',
    shadowColor: SL.accent,
    shadowOpacity: 0.5,
    shadowRadius: 14,
  },
  questCardPickRemove: {
    borderColor: SL.danger,
    backgroundColor: 'rgba(255,68,68,0.18)',
    shadowColor: SL.danger,
    shadowOpacity: 0.5,
    shadowRadius: 14,
  },
  // The order chip sitting on a queued node.
  pickChip: {
    position: 'absolute',
    top: -10,
    right: -10,
    minWidth: 26,
    height: 26,
    paddingHorizontal: 6,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  pickChipAdd: {
    borderColor: SL.accent,
    backgroundColor: SL.bg,
  },
  pickChipRemove: {
    borderColor: SL.danger,
    backgroundColor: SL.bg,
  },
  pickChipText: {
    fontFamily: F.heading,
    fontSize: 14,
    lineHeight: 16,
  },
  pickChipTextAdd:    { color: SL.accent },
  pickChipTextRemove: { color: SL.danger },

  headerDivider: {
    height: 1,
    backgroundColor: SL.border,
    alignSelf: 'stretch',
    marginTop: 16,
    opacity: 0.5,
  },

  // The page behind the card: full bleed, constant margin — mirrors
  // ScreenFrame's `outer`, so the quest card sits exactly where every other
  // screen's card sits.
  frameOuter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: FRAME_PAD,
    paddingVertical: FRAME_PAD_V,
  },

  // The card's inner scroll: fills the card and scrolls only when the content
  // outgrows it — so the CARD never changes size, only the content does.
  frameScroll: { flex: 1, width: '100%' },

  // Tree
  scrollBody: {
    flexGrow: 1,
    // STRETCH, not center: the header sizes itself from the card, and its own
    // children (the pill row, the HUD meter) stretch to it. Centering here
    // makes the header shrink-wrap its content instead, so those stretched
    // children run off the edge of the card.
    alignItems: 'stretch',
    paddingTop: 12,
    // No side padding: the header brings its own, and the tree wants every unit
    // of width it can get (it is scaled to fit, so padding here comes straight
    // out of the node size).
    paddingHorizontal: 0,
    paddingBottom: 60,
  },

  // One page-sized ice-glow frame wrapping the whole skill tree — same width as
  // SkillsScreen's body so the quest tree matches the skills page. The tree
  // itself scrolls horizontally inside it (overflow clips to the frame).
  // flex: 1 → always exactly as tall as the page allows, content-independent.
  treeFrame: {
    flex: 1,
    width: '100%',
    maxWidth: 1440,
    alignSelf: 'center',
    padding: 16,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 18,
    backgroundColor: SL.bg,
    overflow: 'hidden',
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
  },

  // Fit area — measures the usable width; the scaled tree centers in it.
  treeFitArea: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: TREE_PAD_H,
  },

  // Column label
  branchLabel: {
    fontFamily: F.bodyMed,
    fontSize: 30,
    color: SL.accent,
    letterSpacing: 3,
    textAlign: 'center',
    opacity: 0.95,
    // Ice-glow so the branch headings pop.
    textShadowColor: 'rgba(74,158,191,0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },

  // Hidden-challenge banner — the gold counterpart of a branch label, shown
  // above a challenge node the player has just unlocked.
  challengeBanner: {
    alignItems: 'center',
    alignSelf: 'center',
    // Opaque plate — masks the gold connector line that passes behind it, so the
    // type never sits ON a wire. Generous padding keeps the words off the border.
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: SL.gold,
    backgroundColor: SL.bg,
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 22,
    elevation: 8,
  },
  // Line 1 — small, wide-tracked kicker.
  challengeKicker: {
    fontFamily: F.heading,
    fontSize: 18,
    lineHeight: 22,
    color: SL.gold,
    letterSpacing: 10,
    // Tracking leaves a trailing gap after the last glyph; pull the word back so
    // it still reads optically centred over CHALLENGE.
    marginLeft: 10,
    textAlign: 'center',
    opacity: 0.9,
    textShadowColor: 'rgba(255,215,0,0.55)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
  // Line 2 — the loudest heading in the tree, in the HEAVY face, because finding
  // this is the moment the whole quest was hiding.
  challengeLabel: {
    fontFamily: F.heading,
    fontSize: 36,
    lineHeight: 44,
    color: SL.gold,
    letterSpacing: 2,
    marginLeft: 2,
    textAlign: 'center',
    textShadowColor: 'rgba(255,215,0,0.75)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },

  // Tier divider — full-width rule with centered label
  tierDivider: {
    position: 'absolute',
    left: 0,
    height: TIER_RULE_H,
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
  // The TIER II rule reads as a gold milestone threshold, not just another divider.
  tierLineGold: {
    backgroundColor: SL.gold,
    opacity: 0.55,
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
  },
  tierLabel: {
    fontFamily: F.heading,
    fontSize: 30,
    color: SL.gold,
    letterSpacing: 6,
    textAlign: 'center',
    textShadowColor: 'rgba(255,215,0,0.6)',
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
  // Live animated frame over CLASS-GATE nodes — the GOLD palette sweeps clockwise
  // around the border (segments owned by ShimmerFrame; the border here is drawn by
  // that component via `thickness`, not borderWidth).
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
  // Breathing ice halo behind an AVAILABLE node — its own glow is static; the
  // wrapping Animated.View pulses this layer's opacity to make it breathe.
  unlockedHalo: {
    position: 'absolute',
    top: -3, left: -3, right: -3, bottom: -3,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: SL.accent,
    backgroundColor: 'rgba(74,158,191,0.06)',
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 14,
  },
  // CLASS-GATE nodes hand their border over to the gold ShimmerFrame (so the
  // card's own blue border doesn't show through underneath) and trade their faint
  // ice glow for a richer gold one — the gate feels like a prestige milestone.
  questCardRequired: {
    borderColor: 'transparent',
    backgroundColor: 'rgba(255,215,0,0.05)',
    shadowColor: SL.gold,
    shadowOpacity: 0.4,
    shadowRadius: 16,
  },

  // A revealed HIDDEN CHALLENGE hands its border to a gold ShimmerFrame, exactly
  // the way a prestige requirement does.
  questCardChallenge: {
    borderColor: 'transparent',
    backgroundColor: 'rgba(255,215,0,0.06)',
    shadowColor: SL.gold,
    shadowOpacity: 0.45,
    shadowRadius: 16,
  },
  // Completing a challenge must NOT hand it the blue "done" card — it stays
  // gold and simply burns brighter (the gold equivalent of questCardDone).
  questCardChallengeDone: {
    backgroundColor: 'rgba(255,215,0,0.12)',
    shadowOpacity: 0.6,
  },

  // Expanding gold ring — the shockwave of a hidden challenge revealing itself.
  revealRing: {
    position: 'absolute',
    top: -6, left: -6, right: -6, bottom: -6,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: SL.gold,
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 18,
  },

  // Breathing gold halo behind a CLASS-GATE node (opacity pulsed by `gate`).
  gateHalo: {
    position: 'absolute',
    top: -3, left: -3, right: -3, bottom: -3,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: SL.gold,
    backgroundColor: 'rgba(255,215,0,0.06)',
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 16,
  },
  // The one-shot gold flash a node fires the moment it's confirmed complete —
  // hotter than the gate halo so the payoff outshines the ambient glows.
  burstHalo: {
    position: 'absolute',
    top: -5, left: -5, right: -5, bottom: -5,
    borderRadius: 15,
    borderWidth: 2.5,
    borderColor: SL.gold,
    backgroundColor: 'rgba(255,215,0,0.14)',
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 26,
  },

  // Floating "✦ PRESTIGE REQUIRED ✦" crown ribbon, centered above the node's
  // top edge. The wording names what the node actually gates — a prestige
  // requirement — so it reads the same as the prestige checklist in Skills.
  gateRibbonWrap: {
    position: 'absolute',
    top: -15,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 6,
  },
  gateRibbon: {
    backgroundColor: '#140d02',
    borderWidth: 1.5,
    borderColor: SL.gold,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 3,
    shadowColor: SL.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 12,
  },
  gateRibbonText: {
    fontFamily: F.heading,
    // Slightly smaller and tighter than the node title: the phrase is long, and
    // the ribbon floats free of the node's width, so it has to stay compact
    // enough not to reach the node beside it.
    fontSize: 13,
    color: SL.gold,
    letterSpacing: 1.8,
    textShadowColor: 'rgba(255,215,0,0.8)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },

  // Node text
  questName: {
    fontFamily: F.heading,
    fontSize: 24,
    color: SL.text,
    letterSpacing: 0.6,
    lineHeight: 27,
    textAlign: 'center',
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 8,
  },
  questNameDone:   { color: SL.accent },
  questNameLocked: { color: SL.muted },
  // A hidden challenge reads GOLD in every state — done included, where the
  // default `questNameDone` would otherwise turn the title ice blue inside a
  // gold frame.
  questNameChallenge: {
    color: SL.gold,
    textShadowColor: 'rgba(255,215,0,0.55)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  // A requirement node carries the whole point of the detour, so its title reads
  // a size up and in full-strength violet instead of the locked grey.
  questNameMirror: {
    fontSize: 29,
    lineHeight: 31,
    color: '#D5CCFF',
    textShadowColor: 'rgba(139,120,255,0.55)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },

  // Badges
  nodeBottom: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6 },
  lockGlyph: { fontSize: 15, lineHeight: 20, opacity: 0.75 },

  // ── Mirrored requirement (earned in another main quest) ──────────────────
  // Same solid frame as a normal node, just in violet, plus a "⇥ CHAIN" tag:
  // the node reads as a pointer OUT of this tree without looking half-drawn.
  questCardMirror: {
    // Tighter box than a normal node: a requirement card only holds a title and
    // one word, so the reserved height goes to type instead of padding.
    paddingVertical: 6,
    gap: 2,
    borderColor: '#8B78FF',
    backgroundColor: 'rgba(110,91,224,0.14)',
    shadowColor: '#8B78FF',
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
  // Earned — still the requirement node's violet, just brighter. (Before this it
  // fell through to the generic blue `questCardDone`, which erased the violet
  // frame the moment the requirement was met in the quest that owns it.)
  questCardMirrorDone: {
    borderColor: '#A996FF',
    backgroundColor: 'rgba(110,91,224,0.22)',
    shadowOpacity: 0.55,
  },
  // No frame: the badge row only has ~26px of reserved height, and spending it
  // on a border + padding is what kept the label microscopic. Bare text lets the
  // type itself fill the row.
  mirrorTag: {},
  mirrorTagDone: {},
  mirrorTagText: {
    fontFamily: F.bodyMed,
    fontSize: 30,
    lineHeight: 40,
    letterSpacing: 2,
    color: '#C4B8FF',
  },
  // The chain tag stays violet when done — it names where the requirement lives,
  // which doesn't stop being a violet cross-quest pointer once it's met.
  mirrorTagTextDone: { color: '#D5CCFF' },
  // ── Coach-approved node (only the coach can check it) ────────────────────
  // Third palette in the tree: gold = challenge, violet = owned by another
  // quest, GREEN = owned by the coach. Same solid frame as a normal node.
  questCardCoach: {
    borderColor: SL.approve,
    backgroundColor: 'rgba(59,232,122,0.12)',
    shadowColor: SL.approve,
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
  // Approved — still green, just lit. (Without this the node would fall through
  // to the generic blue `questCardDone` and lose its palette on approval.)
  questCardCoachDone: {
    borderColor: '#7CFFAE',
    backgroundColor: 'rgba(59,232,122,0.2)',
    shadowOpacity: 0.6,
  },
  questNameCoach: {
    color: '#9CFFC6',
    textShadowColor: 'rgba(59,232,122,0.55)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  mirrorNote: {
    fontFamily: F.body,
    fontSize: 15,
    lineHeight: 22,
    color: SL.muted,
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 6,
  },
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
    fontSize: 18,
    lineHeight: 20,
    color: SL.accent,
    letterSpacing: 1.5,
  },
  // The DONE chip follows the node's palette, not the default ice blue.
  doneBadgeChallenge:     { backgroundColor: 'rgba(255,215,0,0.15)', borderColor: SL.gold },
  doneBadgeTextChallenge: { color: SL.gold },
  doneBadgeMirror:        { backgroundColor: 'rgba(110,91,224,0.22)', borderColor: '#8B78FF' },
  doneBadgeTextMirror:    { color: '#D5CCFF' },
  rewardBadge: {
    borderWidth: 1,
    borderColor: SL.accent,
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  rewardText: {
    fontFamily: F.bodyMed,
    fontSize: 18,
    lineHeight: 20,
    color: SL.accent,
    letterSpacing: 1.2,
  },
  // Gold reward badge on a revealed hidden challenge (matches its frame).
  rewardBadgeChallenge: { borderColor: SL.gold },
  rewardTextChallenge:  { color: SL.gold },

  // ── Confirmation popup — system-notification style card ──────────────────────

  // Dim backdrop, card centered like a system notification.
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  confirmCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 18,
    paddingHorizontal: 24,
    paddingVertical: 22,
    alignItems: 'center',
    gap: 8,
    // Strong ice-glow so the card reads as a popped-out notification.
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 28,
    elevation: 12,
  },
  confirmCardTitle: {
    fontFamily: F.heading,
    fontSize: 26,
    color: SL.accent,
    letterSpacing: 3,
    textAlign: 'center',
    textShadowColor: 'rgba(74,158,191,0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  // The coach's own dialog wears the node's green, so approving reads as a
  // different act from the player checking their own box.
  confirmCardTitleCoach: {
    color: '#9CFFC6',
    textShadowColor: 'rgba(59,232,122,0.6)',
  },
  confirmCardName: {
    fontFamily: F.heading,
    fontSize: 30,
    color: SL.text,
    letterSpacing: 0.5,
    textAlign: 'center',
    marginTop: 2,
  },
  confirmCardDelta: {
    fontFamily: F.bodyMed,
    fontSize: 24,
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 6,
  },
  confirmCardDeltaUp:   { color: SL.gold },
  confirmCardDeltaDown: { color: SL.danger },
  confirmButtons: {
    flexDirection: 'row',
    gap: 12,
    alignSelf: 'stretch',
    marginTop: 6,
  },
  confirmCancel: {
    flex: 1,
    height: 48,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmCancelText: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.muted,
    letterSpacing: 2,
  },
  confirmOk: {
    flex: 1,
    height: 48,
    backgroundColor: SL.accent,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmOkText: {
    fontFamily: F.heading,
    fontSize: 20,
    color: SL.bg,
    letterSpacing: 2,
  },
  // A long word ("DOWNGRADE") blows past the half-width button at the base
  // size, so it drops the tracking and shrinks to fit on one line.
  confirmOkTextLong: {
    fontSize: 17,
    letterSpacing: 0.5,
  },

  // COMBOES "SHAPES ?" glossary button + its popup card.
  shapesGlossBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255,215,0,0.5)',
    backgroundColor: 'rgba(255,215,0,0.08)',
  },
  shapesGlossBtnText: {
    fontFamily: F.heading,
    fontSize: 16,
    color: '#FFD700',
    letterSpacing: 2,
  },
  shapesGlossQ: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,215,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shapesGlossQText: {
    fontFamily: F.heading,
    fontSize: 13,
    color: '#FFD700',
    lineHeight: 16,
  },
  shapesInfoCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: 'rgba(255,215,0,0.7)',
    borderRadius: 18,
    paddingHorizontal: 24,
    paddingVertical: 22,
    alignItems: 'center',
    gap: 14,
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 28,
    elevation: 12,
  },
  shapesInfoTitle: {
    fontFamily: F.heading,
    fontSize: 26,
    color: '#FFD700',
    letterSpacing: 3,
    textAlign: 'center',
    textShadowColor: 'rgba(255,215,0,0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  shapesInfoBody: {
    fontFamily: F.body,
    fontSize: 18,
    lineHeight: 26,
    color: SL.text,
    textAlign: 'center',
  },
  shapesInfoClose: {
    alignSelf: 'stretch',
    height: 48,
    backgroundColor: '#FFD700',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  shapesInfoCloseText: {
    fontFamily: F.heading,
    fontSize: 20,
    color: SL.bg,
    letterSpacing: 2,
  },
});
