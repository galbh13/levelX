import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { F } from '../constants/fonts';

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
};

// A label counts only at the very start, after a line break, or after sentence
// punctuation — so the word "goal" inside a sentence is left alone.
// Accepts: goal / goals / note / notes, then any of - – — :
const LABEL_RE = /(^|\n|[.!?;])[ \t]*(goals?|notes?)[ \t]*[-–—:]+[ \t]*/gi;

export function parseCoachText(raw) {
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
  // Overrides the caller's muted/italic look — a marked line is meant to pop.
  calloutText: { flex: 1, fontStyle: 'normal', opacity: 1, fontFamily: F.body },
});
