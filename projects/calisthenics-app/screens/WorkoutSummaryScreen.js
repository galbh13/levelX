import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { F } from '../constants/fonts';
import ScreenFrame from '../components/ScreenFrame';
import PillButton from '../components/PillButton';

const SL = {
  bg:     '#050912',
  panel:  '#070d1a',
  border: '#1a3a5c',
  accent: '#4A9EBF',
  text:   '#E8F4FF',
  muted:  '#4a6a8a',
  green:  '#4CAF50',
  gold:   '#FFD700',
};

function fmtDur(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function fmtClock(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  });
}

export default function WorkoutSummaryScreen({ route, navigation }) {
  const { summary } = route.params;
  const {
    title, dateStr, totalActiveMs, spanStart, spanEnd,
    segments = [], breaks = [], exercises = [], pathLabel = null,
    totalSetsDone, totalSets,
  } = summary;

  const hadBreaks = breaks.length > 0;

  // Fill-the-page recap: the frame runs in `fill` mode (it becomes the whole
  // page) and the body is a flex column that stretches to that full height. The
  // EXERCISES section is `flex: 1`, so it absorbs all the slack and the recap
  // reaches edge-to-edge with no dead margins — ideal for a single screenshot.
  return (
    <ScreenFrame fill maxWidth={560}>
      <View style={styles.body}>
        {/* Banner */}
        <View style={styles.banner}>
          <Text style={styles.bannerTitle}>{title?.toUpperCase()}</Text>
          <Text style={styles.bannerDate}>{fmtDate(dateStr)}</Text>
          {pathLabel ? (
            <View style={styles.pathChip}>
              <Text style={styles.pathChipText}>⌥ PATH · {pathLabel.toUpperCase()}</Text>
            </View>
          ) : null}
        </View>

        {/* Hero time */}
        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>TRAINING TIME</Text>
          <Text style={styles.heroValue}>{fmtDur(totalActiveMs)}</Text>
          <Text style={styles.heroSpan}>{fmtClock(spanStart)} → {fmtClock(spanEnd)}</Text>
        </View>

        {/* Stat chips */}
        <View style={styles.statRow}>
          <View style={styles.statChip}>
            <Text style={styles.statValue}>{totalSetsDone}/{totalSets}</Text>
            <Text style={styles.statLabel}>SETS</Text>
          </View>
          <View style={styles.statChip}>
            <Text style={styles.statValue}>{segments.length}</Text>
            <Text style={styles.statLabel}>NUMBER OF SESSIONS</Text>
          </View>
        </View>

        {/* Time log — only meaningful when the session was split by breaks */}
        {hadBreaks && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>TIME LOG</Text>
            {segments.map((seg, i) => (
              <React.Fragment key={i}>
                <View style={styles.logRow}>
                  <Text style={styles.logName}>SESSION {i + 1}</Text>
                  <Text style={styles.logTime}>{fmtClock(seg.start)} → {fmtClock(seg.end)}</Text>
                </View>
                {breaks[i] && (
                  <View style={styles.breakRow}>
                    <Text style={styles.breakText}>⏸ BREAK · {fmtDur(breaks[i].ms)}</Text>
                  </View>
                )}
              </React.Fragment>
            ))}
          </View>
        )}

        {/* Exercise breakdown — flex:1 so it stretches to fill the page */}
        <View style={[styles.section, styles.sectionFill]}>
          <Text style={styles.sectionLabel}>EXERCISES</Text>
          <View style={styles.exList}>
            {exercises.map((ex, i) => {
              // Only treat as "skipped" in the recap when nothing was logged. A
              // partial effort (e.g. 1 of 3 sets) is recorded as what was actually
              // done, not erased.
              const blankSkip = ex.skipped && ex.doneCount === 0;
              return (
              <View key={i} style={styles.exRow}>
                <View style={styles.exLetter}>
                  <Text style={styles.exLetterText}>{ex.letter}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.exName}>{ex.name?.toUpperCase()}</Text>
                  <Text style={styles.exReps}>
                    {blankSkip ? 'SKIPPED' : ex.reps.join('  ·  ')}
                  </Text>
                </View>
                {blankSkip ? (
                  <Text style={[styles.exCount, { color: SL.muted }]}>—</Text>
                ) : (
                  <Text style={[
                    styles.exCount,
                    ex.doneCount === ex.totalSets && ex.totalSets > 0 && { color: SL.green },
                  ]}>
                    {ex.doneCount}/{ex.totalSets}
                  </Text>
                )}
              </View>
              );
            })}
            {exercises.length === 0 && <Text style={styles.exReps}>No exercises logged.</Text>}
          </View>
        </View>

        <PillButton
          label="DONE"
          size="lg"
          onPress={() => navigation.navigate('Home')}
          style={{ marginTop: 4 }}
        />
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg },
  // Fills the whole frame; the EXERCISES section (flex:1) absorbs the slack.
  body: { flex: 1, paddingHorizontal: 16, paddingVertical: 10, gap: 6, width: '100%' },

  banner: { alignItems: 'center', gap: 2 },
  bannerTitle: { fontFamily: F.heading, fontSize: 24, color: SL.accent, letterSpacing: 3, textAlign: 'center', textTransform: 'uppercase' },
  bannerDate: { fontFamily: F.bodyMed, fontSize: 13, color: SL.muted, letterSpacing: 1 },
  pathChip: {
    marginTop: 2, borderWidth: 1.5, borderColor: SL.accent, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 2, backgroundColor: 'rgba(74,158,191,0.10)',
  },
  pathChipText: { fontFamily: F.heading, fontSize: 12, color: SL.accent, letterSpacing: 1.5 },

  heroCard: {
    alignItems: 'center', gap: 1, paddingVertical: 8, borderRadius: 14,
    backgroundColor: SL.panel, borderWidth: 1.5, borderColor: SL.accent,
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.25, shadowRadius: 18,
  },
  heroLabel: { fontFamily: F.body, fontSize: 12, color: SL.muted, letterSpacing: 3 },
  heroValue: { fontFamily: F.heading, fontSize: 32, color: SL.text, letterSpacing: 2 },
  heroSpan: { fontFamily: F.bodyMed, fontSize: 13, color: SL.accent, letterSpacing: 1 },

  statRow: { flexDirection: 'row', gap: 10 },
  statChip: {
    flex: 1, alignItems: 'center', gap: 1, paddingVertical: 6, borderRadius: 10,
    backgroundColor: SL.panel, borderWidth: 1.5, borderColor: SL.border,
  },
  statValue: { fontFamily: F.heading, fontSize: 20, color: SL.accent, letterSpacing: 1 },
  statLabel: { fontFamily: F.body, fontSize: 11, color: SL.muted, letterSpacing: 2 },

  section: {
    backgroundColor: SL.panel, borderWidth: 1.5, borderColor: SL.border, borderRadius: 12, padding: 12, gap: 6,
  },
  // The exercise card grows to consume all remaining vertical space.
  sectionFill: { flex: 1 },
  // Rows keep their natural height; the free space is distributed BETWEEN them
  // so they spread to fill the card — fewer exercises → bigger gaps, more
  // exercises → tighter gaps, always one page with breathing room. overflow
  // hidden is a safety net so an extreme count can never spill onto the button.
  exList: { flex: 1, justifyContent: 'space-between', overflow: 'hidden' },
  sectionLabel: { fontFamily: F.body, fontSize: 15, color: SL.muted, letterSpacing: 3, marginBottom: 2 },

  logRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logName: { fontFamily: F.body, fontSize: 18, color: SL.text, letterSpacing: 1.5 },
  logTime: { fontFamily: F.heading, fontSize: 18, color: SL.accent, letterSpacing: 1 },
  breakRow: { paddingLeft: 4 },
  breakText: { fontFamily: F.bodyMed, fontSize: 15, color: SL.gold, letterSpacing: 1 },

  exRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 3, borderTopWidth: 1, borderTopColor: 'rgba(26,58,92,0.5)',
  },
  exLetter: {
    width: 30, height: 30, borderWidth: 1.5, borderColor: SL.border, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(74,158,191,0.06)',
  },
  exLetterText: { fontFamily: F.heading, fontSize: 16, color: SL.accent },
  exName: { fontFamily: F.heading, fontSize: 17, color: SL.text, letterSpacing: 1, textTransform: 'uppercase' },
  exReps: { fontFamily: F.bodyMed, fontSize: 14, color: SL.muted, letterSpacing: 1, marginTop: 1 },
  exCount: { fontFamily: F.heading, fontSize: 20, color: SL.accent, letterSpacing: 1 },
});
