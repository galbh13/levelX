import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { goalProgress } from '../lib/checkupGoals';

// ─── THE WEEK'S MILESTONES ─────────────────────────────────────────────────────────
// The face of the check-up. The coach sets a handful of milestones when they reply;
// this is what the player lands on when they swipe to the CHECK-UP tab, all week,
// above the questions and the exercises. They tick them off as the week goes and
// SUBMIT CHECK-UP at the end — the submission itself is unchanged, the milestones
// just stands in front of it.
//
// Three modes, one card:
//   • live      — tappable ticks (the player's own open milestones)
//   • readOnly  — the same card with the taps off (the submitted view; the coach's
//                 review of what a submission closed)
//   • empty     — no goals set: a quiet placeholder, never a blank hole
//
// Every number and line on it comes from lib/checkupGoals so the player screen and
// the coach's review can never disagree about the score.
const JADE = '#1FD79A';

export default function GoalsCard({
  goals = [],
  onToggle,
  readOnly = false,
  // Stretch to fill the space given (the player's GOALS pane, where the milestones
  // is the whole screen). Off everywhere it shares a page — the coach's review,
  // where it is one card among several.
  fill = false,
  title = "THIS WEEK'S MILESTONES",
  emptyText = 'Your coach sets your milestones for the week when they reply to your check-up. They show up right here.',
  style,
}) {
  const p = goalProgress(goals);
  const tone = p.complete ? JADE : C.iceGlow;

  // The bar slides to the new fill instead of jumping — the tick is the one moment
  // of reward this screen has, so it gets the one animation.
  const fillAnim = useRef(new Animated.Value(p.pct)).current;
  useEffect(() => {
    Animated.timing(fillAnim, {
      toValue: p.pct, duration: 420, easing: Easing.out(Easing.cubic),
      useNativeDriver: false,     // width % can't run on the native driver
    }).start();
  }, [p.pct, fillAnim]);
  const width = fillAnim.interpolate({
    inputRange: [0, 1], outputRange: ['0%', '100%'],
  });

  return (
    <View style={[
      styles.card,
      p.complete && styles.cardDone,
      fill && styles.cardFill,
      fill && goals.length === 0 && styles.cardFillEmpty,
      style,
    ]}>
      {/* The rail down the left edge — cyan while there's work left, jade once
          the whole week is cleared. */}
      <View style={[styles.rail, { backgroundColor: tone, shadowColor: tone }]} />

      <View style={styles.head}>
        <Text style={[styles.title, { color: tone }]}>{title}</Text>
        {goals.length > 0 && (
          <Text style={[styles.score, { color: tone }]}>
            {p.done}<Text style={styles.scoreTotal}>{` / ${p.total}`}</Text>
          </Text>
        )}
      </View>

      {goals.length === 0 ? (
        // Filling the pane, the placeholder sits in the middle of the space it
        // is holding rather than clinging under the heading.
        <View style={fill ? styles.emptyFill : null}>
          <Text style={[styles.empty, fill && styles.emptyBig]}>{emptyText}</Text>
        </View>
      ) : (
        <>
          <View style={styles.track}>
            <Animated.View style={[styles.trackFill, { width, backgroundColor: tone, shadowColor: tone }]} />
          </View>
          <View style={[styles.list, fill && styles.listFill]}>
            {goals.map((g, i) => (
              <GoalRow
                key={g.id ?? i}
                index={i}
                goal={g}
                readOnly={readOnly}
                onToggle={onToggle}
              />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

// One goal. The whole row is the hit target — a 24px box is a miss waiting to
// happen on a phone held one-handed after a session.
function GoalRow({ goal, index, readOnly, onToggle }) {
  const done = !!goal.done;
  const body = (
    <View style={[styles.row, done && styles.rowDone]}>
      <View style={[styles.box, done && styles.boxDone]}>
        {done
          ? <Text style={styles.boxTick}>✓</Text>
          : <Text style={styles.boxNum}>{String(index + 1).padStart(2, '0')}</Text>}
      </View>
      <Text style={[styles.goalText, done && styles.goalTextDone]}>{goal.text}</Text>
    </View>
  );

  if (readOnly) return body;
  return (
    <TouchableOpacity activeOpacity={0.75} onPress={() => onToggle?.(goal)}>
      {body}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.5, borderRadius: 16,
    borderColor: 'rgba(74,158,191,0.45)',
    backgroundColor: 'rgba(74,158,191,0.07)',
    paddingVertical: 18, paddingLeft: 22, paddingRight: 18,
    marginBottom: 22, overflow: 'hidden',
  },
  cardDone: {
    borderColor: 'rgba(31,215,154,0.5)',
    backgroundColor: 'rgba(31,215,154,0.07)',
  },
  // The card IS the screen (player's GOALS pane): take the height and give the
  // rows room to breathe instead of huddling at the top of an empty page.
  cardFill: { flex: 1, marginBottom: 0, paddingVertical: 22 },
  cardFillEmpty: { justifyContent: 'flex-start' },
  rail: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 8,
  },

  head: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  title: { flex: 1, fontFamily: F.heading, fontSize: 17, letterSpacing: 2.6 },
  score: { fontFamily: F.heading, fontSize: 24, letterSpacing: 1 },
  scoreTotal: { fontSize: 16, color: C.textMuted, letterSpacing: 1 },

  track: {
    height: 4, borderRadius: 2, marginTop: 14,
    backgroundColor: 'rgba(42,74,106,0.55)', overflow: 'hidden',
  },
  trackFill: {
    height: 4, borderRadius: 2,
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 6,
  },

  list: { marginTop: 14, gap: 10 },
  listFill: { flex: 1, gap: 14, marginTop: 18 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderWidth: 1, borderRadius: 12,
    borderColor: C.cardBorder, backgroundColor: 'rgba(5,9,18,0.55)',
    paddingVertical: 13, paddingHorizontal: 14,
  },
  rowDone: { borderColor: 'rgba(31,215,154,0.35)', backgroundColor: 'rgba(31,215,154,0.06)' },

  box: {
    width: 30, height: 30, borderRadius: 9,
    borderWidth: 1.5, borderColor: 'rgba(74,158,191,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  boxDone: { borderColor: JADE, backgroundColor: JADE },
  boxNum:  { fontFamily: F.heading, fontSize: 13, color: C.iceGlow, opacity: 0.8, letterSpacing: 0.5 },
  boxTick: { fontFamily: F.heading, fontSize: 17, color: '#04140E', lineHeight: 20 },

  goalText: {
    flex: 1, fontFamily: F.body, fontSize: 16, color: C.text,
    lineHeight: 22, letterSpacing: 0.2,
  },
  goalTextDone: { color: JADE, opacity: 0.85, textDecorationLine: 'line-through' },

  empty: {
    fontFamily: F.bodyMed, fontSize: 15, color: C.text, opacity: 0.6,
    lineHeight: 22, marginTop: 10,
  },
  emptyFill: { flex: 1, justifyContent: 'center', paddingBottom: 24 },
  emptyBig: { fontSize: 17, lineHeight: 26, textAlign: 'center', marginTop: 0 },
});
