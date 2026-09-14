import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { F } from '../constants/fonts';
import { gearFromLine } from '../lib/gear';

// Coach descriptions are plain text, but the coach marks the important bits by
// hand: "goal - hold the tuck for 10s", "note - this burns at first".
// Those prefixes get pulled out of the paragraph and rendered as a labelled
// call-out so the player can spot the WHY at a glance mid-set. Text without a
// label renders exactly as before — this is additive, never destructive.

// Both call-outs currently ride the accent blue — the CHIP word is what tells GOAL
// from NOTE, not the colour. Earlier passes: gold #FFD700 (blends into the XP/
// prestige language) and violet #B57BFF (unused elsewhere). Change GOAL.fg/bg/border
// here to give it its own colour again.
const TONES = {
  GOAL: { fg: '#4A9EBF', bg: 'rgba(74,158,191,0.10)', border: 'rgba(74,158,191,0.45)' },
  NOTE: { fg: '#4A9EBF', bg: 'rgba(74,158,191,0.10)', border: 'rgba(74,158,191,0.45)' },
  // Kit you must bring is not a thing to read, it is a thing to CHECK before you
  // start — so it steps off the accent blue that every other line here rides.
  // Periwinkle, borrowed from CUE_TINTS: same cold temperature as the rest of
  // the card, obviously not the same ink. Not gold — gold is XP and prestige.
  REQUIRED: { fg: '#AEB4FF', bg: 'rgba(174,180,255,0.10)', border: 'rgba(174,180,255,0.45)' },
};

// A label counts only at the very start, after a line break, or after sentence
// punctuation — so the word "goal" inside a sentence is left alone.
// Accepts: goal / goals / note / notes, then any of - – — :
const LABEL_RE = /(^|\n|[.!?;])[ \t]*(goals?|notes?)[ \t]*[-–—:]+[ \t]*/gi;

// A "*bands" line is pulled out whole before the label pass ever sees it — the
// asterisk claims the LINE, so nothing inside it is re-read as prose. Everything
// that isn't a requirement is handed to the label pass exactly as it was typed,
// newlines and all, so the older rules behave as they always did.
export function parseCoachText(raw) {
  const text = String(raw ?? '');
  if (!text.includes('*')) return parseLabels(text);

  const parts = [];
  let buffer = [];
  const flush = () => {
    if (buffer.length) parts.push(...parseLabels(buffer.join('\n')));
    buffer = [];
  };
  for (const line of text.split('\n')) {
    const items = gearFromLine(line);
    if (items) { flush(); parts.push({ kind: 'gear', label: 'REQUIRED', text: '', items }); }
    else buffer.push(line);
  }
  flush();
  return parts;
}

function parseLabels(raw) {
  const text = String(raw ?? '');
  const parts = [];
  const re = new RegExp(LABEL_RE.source, 'gi');
  let cur = { label: null, text: '' };
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    // The boundary char that triggered the match belongs to the PREVIOUS chunk
    // (a period ends that sentence); a newline is just a separator.
    const boundary = m[1] === '\n' ? '' : m[1];
    cur.text += text.slice(last, m.index) + boundary;
    if (cur.text.trim()) parts.push({ label: cur.label, text: cur.text.trim() });
    cur = { label: m[2].toUpperCase().replace(/S$/, ''), text: '' };
    last = m.index + m[0].length;
  }
  cur.text += text.slice(last);
  if (cur.text.trim()) parts.push({ label: cur.label, text: cur.text.trim() });
  return parts;
}

// Shared with the exercise card's own description parser so one asterisk looks
// the same everywhere it is typed.
export function GearCallout({ items }) {
  const tone = TONES.REQUIRED;
  return (
    <View style={[styles.callout, { backgroundColor: tone.bg, borderLeftColor: tone.fg }]}>
      <View style={[styles.chip, { borderColor: tone.border, backgroundColor: tone.bg }]}>
        <Text style={[styles.chipText, { color: tone.fg }]}>REQUIRED</Text>
      </View>
      <View style={styles.gearList}>
        {items.map((item, i) => (
          <View key={i} style={styles.gearItem}>
            <Text style={[styles.gearLabel, { color: tone.fg }]}>{item.label}</Text>
            {item.alt ? <Text style={styles.gearAlt}>{item.alt}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

// The one-line form, for cards and the mission launcher where a full call-out
// would not fit: "REQUIRED · WEIGHTS · PULL-UP BAR".
export function GearLine({ items, style }) {
  if (!items?.length) return null;
  return (
    <Text style={[styles.gearLine, style]} numberOfLines={2}>
      REQUIRED · {items.map(i => i.label).join(' · ')}
    </Text>
  );
}

export default function CoachText({ text, style, prefix = null, containerStyle }) {
  const parts = useMemo(() => parseCoachText(text), [text]);
  if (!parts.length) return null;

  // Nothing marked up — keep the original single <Text> so layout is untouched.
  if (!parts.some(p => p.label)) {
    return <Text style={style}>{prefix}{parts.map(p => p.text).join(' ')}</Text>;
  }

  return (
    <View style={[styles.stack, containerStyle]}>
      {parts.map((p, i) => {
        if (p.kind === 'gear') return <GearCallout key={i} items={p.items} />;
        if (!p.label) {
          return <Text key={i} style={style}>{i === 0 ? prefix : null}{p.text}</Text>;
        }
        const tone = TONES[p.label] ?? TONES.NOTE;
        return (
          <View
            key={i}
            style={[styles.callout, { backgroundColor: tone.bg, borderLeftColor: tone.fg }]}
          >
            <View style={[styles.chip, { borderColor: tone.border, backgroundColor: tone.bg }]}>
              <Text style={[styles.chipText, { color: tone.fg }]}>{p.label}</Text>
            </View>
            <Text style={[style, styles.calloutText, { color: tone.fg }]}>{p.text}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 6, marginTop: 4, marginBottom: 4, alignSelf: 'stretch' },
  callout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 1,
  },
  chipText: { fontFamily: F.heading, fontSize: 13, letterSpacing: 1.5 },
  // Kit reads as a checklist, not a sentence: one line per item, the coach's
  // short-hand expanded underneath it.
  gearList: { flex: 1, gap: 4, marginTop: 2 },
  gearItem: { gap: 1 },
  gearLabel: { fontFamily: F.heading, fontSize: 14, letterSpacing: 1.2 },
  gearAlt: { fontFamily: F.bodyMed, fontSize: 12, letterSpacing: 0.3, color: '#8FA0C8' },
  gearLine: {
    fontFamily: F.heading, fontSize: 11, letterSpacing: 1.1,
    color: TONES.REQUIRED.fg, marginTop: 4,
  },
  // Overrides the caller's muted/italic look — a marked line is meant to pop.
  calloutText: { flex: 1, fontStyle: 'normal', opacity: 1, fontFamily: F.body },
});
