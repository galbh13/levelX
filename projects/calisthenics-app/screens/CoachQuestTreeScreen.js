import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';

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
};

// ─── Layout constants ─────────────────────────────────────────────────────────

const NODE_W       = 340;
const NODE_H       = 50;
const COL_GAP      = 60;
const RANK_GAP     = 72;
const TREE_PAD_H   = 16;
const TREE_PAD_T   = 24;
const LABEL_H      = 40;
const LABEL_OFFSET = 50;
const BEND_NEAR_CHILD = 12;   // horizontal jog sits this many px above child top

// Branch column priority — left to right
const BRANCH_ORDER = [
  'power', 'hspu_prog', 'negative', 'balance', 'main',
  'mobility', 'active_hold', 'freestanding', 'band', 'hs_hold',
];

// Handstand-specific layout constants — narrower columns, fixed split offset
const HS_NODE_W       = 320;
const HS_COL_GAP      = 40;
const HS_SPLIT_OFFSET = 180;

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

function computeHandstandLayout(quests) {
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

  // Step 5 — build positions
  const rankY = (r) => TREE_PAD_T + LABEL_H + r * (NODE_H + RANK_GAP);
  const positions = {};
  quests.forEach(q => {
    const r  = rankOf[q.id] ?? 0;
    const cx = colCenterX(q.branch ?? branches[0]) + (offsetOf[q.id] ?? 0);
    positions[q.id] = {
      x: cx - HS_NODE_W / 2,
      y: rankY(r),
      w: HS_NODE_W,
      h: NODE_H,
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

  const height = rankY(maxRank) + NODE_H + TREE_PAD_T;

  return {
    positions, firstNodeOfBranch, labelXOf,
    width: treeWidth, height,
    nodeWidth: HS_NODE_W,
  };
}

// ─── Layout engine — column-anchored, convergence-only centering ──────────────

function computeLayout(quests) {
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
  const colBranches = [...allBranches].filter(b => b !== 'main' && !splitOnlyBranches.has(b));
  const known   = BRANCH_ORDER.filter(b => colBranches.includes(b));
  const unknown = colBranches.filter(b => !BRANCH_ORDER.includes(b)).sort();
  const branches = [...known, ...unknown];
  const usesMainAsCol = branches.length === 0;
  if (usesMainAsCol) branches.push('main');

  const colIndex = {};
  branches.forEach((b, i) => { colIndex[b] = i; });
  const colCenterX = (b) => (colIndex[b] ?? 0) * (NODE_W + COL_GAP) + NODE_W / 2;

  const numBranches  = branches.length;
  const treeWidth    = numBranches * NODE_W + Math.max(0, numBranches - 1) * COL_GAP;
  const chainAnchorX = treeWidth / 2;

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
  const rankY = (r) => TREE_PAD_T + LABEL_H + r * (NODE_H + RANK_GAP);
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
        !splitOnlyBranches.has(q.branch)
      ) {
        colNodes.push(q);
      } else {
        groupNodes.push(q);
      }
    });

    // Pre-conv non-split → branch column slot
    colNodes.forEach(q => {
      const cx = (q.branch === 'main' && !usesMainAsCol)
        ? chainAnchorX
        : colCenterX(q.branch ?? branches[0]);
      positions[q.id] = { x: cx - NODE_W / 2, y: rankY(r), w: NODE_W, h: NODE_H, rank: r };
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
        } else if (q.branch === 'main' && !usesMainAsCol) {
          cx = chainAnchorX;
        } else {
          cx = colCenterX(q.branch ?? branches[0]);
        }
        positions[q.id] = { x: cx - NODE_W / 2, y: rankY(r), w: NODE_W, h: NODE_H, rank: r };
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
          positions[q.id] = { x: cx - NODE_W / 2, y: rankY(r), w: NODE_W, h: NODE_H, rank: r };
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

  const height = rankY(maxRank) + NODE_H + TREE_PAD_T;

  return { positions, firstNodeOfBranch, rankY, width: treeWidth, height };
}

// ─── Screen ───────────────────────────────────────────────────────────────────
//
// Coach version of QuestTreeScreen.
//   • Reads the target student from route params (not auth.getUser()).
//   • Tap a node → opens a confirmation bar at the bottom.
//   • Locked nodes are disabled — coach must respect prerequisites.
//   • Confirm writes / deletes a row in student_quest_completions. LVL is no
//     longer stored on profiles; it is computed per-class from completions.

export default function CoachQuestTreeScreen({ route, navigation }) {
  const { student, classId, chain, questType } = route.params;

  const [quests,        setQuests]        = useState([]);
  const [completions,   setCompletions]   = useState(new Set());
  const [loading,       setLoading]       = useState(true);
  const [pendingQuest,  setPendingQuest]  = useState(null);
  const [toggling,      setToggling]      = useState(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const [qRes, cRes] = await Promise.all([
        supabase
          .from('class_quests')
          .select('*')
          .eq('class_id', classId)
          .eq('chain', chain)
          .order('branch')
          .order('order_index'),
        supabase
          .from('student_quest_completions')
          .select('quest_id')
          .eq('student_id', student.id),
      ]);

      setQuests(qRes.data ?? []);
      setCompletions(new Set((cRes.data ?? []).map(c => c.quest_id)));
    } catch (e) {
      console.error('[CoachQuestTreeScreen]', e);
    }
    setLoading(false);
  }, [classId, chain, student.id]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]));

  // ── Layout ────────────────────────────────────────────────────────────────

  const { positions, firstNodeOfBranch, labelXOf, width, height, nodeWidth } =
    useMemo(
      () => chain === 'handstand'
        ? computeHandstandLayout(quests)
        : computeLayout(quests),
      [quests, chain],
    );

  // ── Node state ────────────────────────────────────────────────────────────

  function nodeState(quest) {
    if (completions.has(quest.id)) return 'done';
    const pre = quest.prerequisites ?? [];
    return pre.every(id => completions.has(id)) ? 'unlocked' : 'locked';
  }

  // ── Toggle ────────────────────────────────────────────────────────────────

  async function toggleQuest(quest) {
    setToggling(true);
    const done = completions.has(quest.id);
    try {
      if (done) {
        const { error: delErr } = await supabase
          .from('student_quest_completions')
          .delete()
          .eq('student_id', student.id)
          .eq('quest_id', quest.id);
        if (delErr) throw delErr;

        setCompletions(prev => { const s = new Set(prev); s.delete(quest.id); return s; });
      } else {
        const { error: insErr } = await supabase
          .from('student_quest_completions')
          .insert({ student_id: student.id, quest_id: quest.id });
        if (insErr) throw insErr;

        setCompletions(prev => new Set([...prev, quest.id]));
      }
    } catch (e) {
      console.error('[CoachQuestTreeScreen] toggleQuest:', e);
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
        const color = done ? SL.green : state === 'unlocked' ? SL.accent : SL.muted;

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
    const state    = nodeState(quest);
    const isDone   = state === 'done';
    const isLocked = state === 'locked';

    return (
      <TouchableOpacity
        style={[
          styles.questCard,
          isDone   && styles.questCardDone,
          isLocked && styles.questCardLocked,
        ]}
        disabled={isLocked || toggling}
        activeOpacity={isLocked ? 1 : 0.75}
        onPress={() => { if (!isLocked) setPendingQuest(quest); }}
      >
        <Text
          style={[
            styles.questName,
            isDone   && styles.questNameDone,
            isLocked && styles.questNameLocked,
          ]}
          numberOfLines={2}
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

  const confirmBarVisible = pendingQuest !== null;

  // ── Render ────────────────────────────────────────────────────────────────

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
          {questType === 'main' ? 'MAIN QUEST' : 'SIDE QUEST'} · {student.full_name?.toUpperCase()}
        </Text>
        <Text style={styles.statsText}>
          {doneCount}/{quests.length} · +{earnedLvl} LVL earned
        </Text>
        <View style={styles.headerDivider} />
      </View>

      {/* Tree */}
      <ScrollView
        contentContainerStyle={[
          styles.scrollBody,
          confirmBarVisible && { paddingBottom: 160 },
        ]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingHorizontal: TREE_PAD_H,
          }}
        >
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

            {/* Branch labels — handstand anchors on column center, others on first node x */}
            {Object.entries(firstNodeOfBranch).map(([branch, q]) => {
              const p = positions[q.id];
              if (!p) return null;
              const w  = nodeWidth ?? NODE_W;
              const lx = labelXOf?.[branch] ?? p.x;
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
  backBtn:  { alignSelf: 'flex-start', marginBottom: 10 },
  backText: { fontFamily: F.bodyMed, fontSize: 20, color: SL.accent, letterSpacing: 2 },
  chainTitle: {
    fontFamily: F.heading,
    fontSize: 50,
    color: SL.text,
    letterSpacing: 4,
    textAlign: 'center',
  },
  chainSubtitle: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.muted,
    letterSpacing: 3,
    marginTop: 4,
    textAlign: 'center',
  },
  statsText: {
    fontFamily: F.bodyMed,
    fontSize: 24,
    color: SL.muted,
    letterSpacing: 1,
    marginTop: 6,
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

  // Column label
  branchLabel: {
    fontFamily: F.bodyMed,
    fontSize: 26,
    color: SL.accent,
    letterSpacing: 3,
    textAlign: 'center',
    opacity: 0.95,
  },

  // Quest cards — fill their absolutely-positioned wrapper so the layout
  // engine controls width (OAPU/HSPU = NODE_W, handstand = HS_NODE_W).
  questCard: {
    width: '100%',
    height: '100%',
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  questCardDone: {
    backgroundColor: 'rgba(76,175,80,0.08)',
    borderColor: SL.green,
  },
  questCardLocked: {
    opacity: 0.45,
  },

  // Node text
  questName: {
    fontFamily: F.heading,
    fontSize: 20,
    color: SL.text,
    letterSpacing: 0.6,
    lineHeight: 17,
    textAlign: 'center',
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 8,
  },
  questNameDone:   { color: SL.green },
  questNameLocked: { color: SL.muted },

  // Badges
  nodeBottom: { alignSelf: 'flex-start' },
  doneBadge: {
    backgroundColor: 'rgba(76,175,80,0.15)',
    borderWidth: 1,
    borderColor: SL.green,
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  doneBadgeText: {
    fontFamily: F.heading,
    fontSize: 16,
    color: SL.green,
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
    fontSize: 16,
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
