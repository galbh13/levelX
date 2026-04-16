import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, Dimensions, TouchableOpacity,
} from 'react-native';
import Svg, { Line, Circle, Text as SvgText, Defs, LinearGradient, Stop } from 'react-native-svg';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';

const SCREEN_WIDTH = Dimensions.get('window').width;

// ─── Generic tree (used by skills that don't have branches yet) ──────────────

const NODE_R = 34;
const ROW_H  = 120;
const PAD    = 48;
const COL_X  = {
  left:   SCREEN_WIDTH * 0.22,
  center: SCREEN_WIDTH * 0.5,
  right:  SCREEN_WIDTH * 0.78,
};
const getX = (col) => COL_X[col];
const getY = (row) => PAD + row * ROW_H;

const GENERIC_NODES = [
  { id: 'intro',  label: 'Intro',   row: 0, col: 'center', unlocked: true  },
  { id: 'step1',  label: 'Step 1',  row: 1, col: 'center', unlocked: true  },
  { id: 'step2a', label: 'Step 2A', row: 2, col: 'left',   unlocked: true  },
  { id: 'step2b', label: 'Step 2B', row: 2, col: 'right',  unlocked: false },
  { id: 'step3a', label: 'Step 3A', row: 3, col: 'left',   unlocked: false },
  { id: 'step3b', label: 'Step 3B', row: 3, col: 'right',  unlocked: false },
  { id: 'step4',  label: 'Step 4',  row: 4, col: 'center', unlocked: false },
  { id: 'step5a', label: 'Step 5A', row: 5, col: 'left',   unlocked: false },
  { id: 'step5b', label: 'Step 5B', row: 5, col: 'right',  unlocked: false },
  { id: 'master', label: 'Master',  row: 6, col: 'center', unlocked: false },
];

const GENERIC_CONNECTIONS = [
  { from: 'intro',  to: 'step1'  },
  { from: 'step1',  to: 'step2a' },
  { from: 'step1',  to: 'step2b' },
  { from: 'step2a', to: 'step3a' },
  { from: 'step2b', to: 'step3b' },
  { from: 'step3a', to: 'step4'  },
  { from: 'step3b', to: 'step4'  },
  { from: 'step4',  to: 'step5a' },
  { from: 'step4',  to: 'step5b' },
  { from: 'step5a', to: 'master' },
  { from: 'step5b', to: 'master' },
];

// ─── Front Lever branch data ─────────────────────────────────────────────────

const SKILL_BRANCHES = {
  'front-lever': [
    {
      id: 'hold',
      label: 'HOLD',
      nodes: [
        { id: 'h1', label: 'Tuck',          unlocked: true  },
        { id: 'h2', label: 'Advance',        unlocked: true  },
        { id: 'h3', label: 'Super Advance',  unlocked: false },
        { id: 'h4', label: 'Half Lie',       unlocked: false },
        { id: 'h5', label: 'Full',           unlocked: false },
      ],
    },
    {
      id: 'raises',
      label: 'RAISES',
      nodes: [
        { id: 'r1', label: 'Tuck',          unlocked: true  },
        { id: 'r2', label: 'Advance',        unlocked: false },
        { id: 'r3', label: 'Super Advance',  unlocked: false },
        { id: 'r4', label: 'Half Lie',       unlocked: false },
        { id: 'r5', label: 'Full',           unlocked: false },
      ],
    },
    {
      id: 'pullups',
      label: 'PULL-UPS',
      nodes: [
        { id: 'p1', label: 'Australian Pull-Upss', unlocked: true  },
        { id: 'p2', label: 'Tuck',                 unlocked: false },
        { id: 'p3', label: 'Advance',               unlocked: false },
        { id: 'p4', label: 'Super Advance',         unlocked: false },
        { id: 'p5', label: 'Half Lie',              unlocked: false },
        { id: 'p6', label: 'Full',                  unlocked: false },
      ],
    },
    {
      id: 'touch',
      label: 'TOUCH',
      nodes: [
        { id: 't1', label: 'Advance',        unlocked: false },
        { id: 't2', label: 'Super Advance',  unlocked: false },
        { id: 't3', label: 'Half Lie',       unlocked: false },
        { id: 't4', label: 'Full',           unlocked: false },
      ],
    },
  ],
};

// ─── Branch column component ─────────────────────────────────────────────────

function BranchColumn({ branch }) {
  return (
    <View style={branchStyles.column}>
      <Text style={branchStyles.branchLabel}>{branch.label}</Text>
      {branch.nodes.map((node, idx) => (
        <React.Fragment key={node.id}>
          {/* connector from previous node */}
          {idx > 0 && (
            <View
              style={[
                branchStyles.connector,
                { backgroundColor: branch.nodes[idx - 1].unlocked && node.unlocked ? C.nodeLine : '#2a2a2a' },
              ]}
            />
          )}
          <View style={[branchStyles.node, node.unlocked ? branchStyles.nodeUnlocked : branchStyles.nodeLocked]}>
            <Text style={[branchStyles.nodeLabel, node.unlocked ? branchStyles.nodeLabelUnlocked : branchStyles.nodeLabelLocked]}>
              {node.label} {node.unlocked && <Text style={branchStyles.checkmark}>✓</Text>}
            </Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function SkillTreeScreen({ route, navigation }) {
  const { skill } = route.params;
  const branches = SKILL_BRANCHES[skill.id] ?? null;

  // generic tree vars (only needed when no branches)
  const nodeMap   = Object.fromEntries(GENERIC_NODES.map((n) => [n.id, n]));
  const maxRow    = Math.max(...GENERIC_NODES.map((n) => n.row));
  const svgHeight = PAD + maxRow * ROW_H + NODE_R + PAD;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{skill.name}</Text>
        {!branches && <Text style={styles.subtitle}>Skill Tree</Text>}
      </View>

      {branches ? (
        // ── 4-branch layout ──────────────────────────────────────────
        <ScrollView contentContainerStyle={branchStyles.row}>
          <View style={branchStyles.centered}>
            {branches.map((branch) => (
              <BranchColumn key={branch.id} branch={branch} />
            ))}
          </View>
        </ScrollView>
      ) : (
        // ── Generic SVG tree ─────────────────────────────────────────
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          <Svg width={SCREEN_WIDTH} height={svgHeight}>
            <Defs>
              <LinearGradient id="xpGrad" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#3a6aee" />
                <Stop offset="1" stopColor="#5B8EFF" />
              </LinearGradient>
            </Defs>

            {GENERIC_CONNECTIONS.map((conn, i) => {
              const a = nodeMap[conn.from];
              const b = nodeMap[conn.to];
              const active = a.unlocked && b.unlocked;
              return (
                <Line
                  key={i}
                  x1={getX(a.col)} y1={getY(a.row) + NODE_R}
                  x2={getX(b.col)} y2={getY(b.row) - NODE_R}
                  stroke={active ? C.nodeLine : C.nodeLineLock}
                  strokeWidth={active ? 2 : 1.5}
                  strokeDasharray={active ? undefined : '6,5'}
                  opacity={active ? 1 : 0.5}
                />
              );
            })}

            {GENERIC_NODES.map((node) => {
              const x = getX(node.col);
              const y = getY(node.row);
              return (
                <React.Fragment key={node.id}>
                  {node.unlocked && (
                    <Circle cx={x} cy={y} r={NODE_R + 6} fill="transparent" stroke={C.iceGlow} strokeWidth={1} opacity={0.12} />
                  )}
                  <Circle
                    cx={x} cy={y} r={NODE_R}
                    fill={node.unlocked ? '#051830' : C.lockedBg}
                    stroke={node.unlocked ? '#5B8EFF' : C.lockedBorder}
                    strokeWidth={node.unlocked ? 2 : 1}
                  />
                  <SvgText
                    x={x} y={y + 4}
                    textAnchor="middle"
                    fill={node.unlocked ? C.text : C.textMuted}
                    fontSize={11}
                    fontFamily={F.body}
                  >
                    {node.label}
                  </SvgText>
                  {node.unlocked && (
                    <SvgText
                      x={x} y={y + 19}
                      textAnchor="middle"
                      fill={C.iceGlow}
                      fontSize={9}
                      fontFamily={F.bodyMed}
                    >
                      ✓ unlocked
                    </SvgText>
                  )}
                </React.Fragment>
              );
            })}
          </Svg>
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 56,
    paddingBottom: 16,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: C.cardBorder,
  },
  back: {
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  backText: {
    fontFamily: F.body,
    color: C.iceGlow,
    fontSize: 30,
  },
  title: {
    fontFamily: F.heading,
    fontSize: 60,
    color: C.iceGlow,
    letterSpacing: 3,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: F.bodyMed,
    fontSize: 24,
    color: C.iceGlow,
    letterSpacing: 4,
    marginTop: 4,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
});

const COL_PAD = 6;
const BRANCH_COL_W = SCREEN_WIDTH / 4;
const NODE_W = BRANCH_COL_W - COL_PAD * 2;

const branchStyles = StyleSheet.create({
  row: {
    paddingVertical: 28,
  },
  centered: {
    flexDirection: 'row',
    width: SCREEN_WIDTH,
    alignItems: 'flex-start',
  },
  column: {
    width: BRANCH_COL_W,
    alignItems: 'center',
    paddingHorizontal: COL_PAD,
  },
  branchLabel: {
    fontFamily: F.heading,
    fontSize: 30,
    color: C.iceGlow,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 20,
    textAlign: 'center',
  },
  connector: {
    width: 2,
    height: 32,
  },
  node: {
    width: NODE_W - 60,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 12,
    gap: 4,
  },
  nodeUnlocked: {
    backgroundColor: '#051830',
    borderColor: C.iceGlow,
  },
  nodeLocked: {
    backgroundColor: '#0a1a2e',
    borderColor: '#1a3050',
  },
  nodeLabel: {
    fontFamily: F.body,
    fontSize: 25,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  nodeLabelUnlocked: {
    color: C.text,
  },
  nodeLabelLocked: {
    color: C.textMuted,
  },
  checkmark: {
    fontFamily: F.bodyMed,
    fontSize: 25,
    color: C.iceGlow,
  },
});
