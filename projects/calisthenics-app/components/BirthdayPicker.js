import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { F } from '../constants/fonts';

// ─── Birthday picker ───────────────────────────────────────────────────────────
// Three tap-to-pick columns — DAY · MONTH · YEAR — instead of typing
// `YYYY-MM-DD` by hand. A coach entering a new player has the date in their
// head, not in a keyboard layout, and a half-typed date used to block the whole
// invite.
//
// Controlled with a plain `{ y, m, d }` object (nulls = nothing picked yet) so
// the parent owns "no birthday at all", which stays a legal answer. Tapping the
// picked value again unpicks it.
//
// Tap-to-select rather than a snapping wheel on purpose: momentum-scroll
// snapping never lands reliably on Expo web, and this app ships to web first.

const SL = {
  panelAlt: '#0a1424',
  border:   '#1a3a5c',
  accent:   '#4A9EBF',
  text:     '#E8F4FF',
  muted:    '#4a6a8a',
};

const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

const ITEM_H = 34;
const ROWS   = 4;            // 136pt of list — compact enough to leave the card short
const OLDEST = 90;           // years back the year column reaches

// Days in a 1-based month. With no year picked yet we assume a leap year so
// Feb 29 is offered; picking a non-leap year afterwards clamps it back.
function daysIn(y, m) {
  if (!m) return 31;
  return new Date(Date.UTC(y || 2000, m, 0)).getUTCDate();
}

export function isCompleteBirthday(b) {
  return Boolean(b && b.y && b.m && b.d);
}

export function isPartialBirthday(b) {
  if (!b) return false;
  const parts = [b.y, b.m, b.d];
  return parts.some(Boolean) && !parts.every(Boolean);
}

/** `{ y, m, d }` → the `YYYY-MM-DD` string the database takes, or '' if unset. */
export function birthdayToISO(b) {
  if (!isCompleteBirthday(b)) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${b.y}-${pad(b.m)}-${pad(b.d)}`;
}

/** The reverse, for editing a birthday that already exists. */
export function birthdayFromISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return { y: null, m: null, d: null };
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function Column({ items, value, onSelect, disabled, flex }) {
  const ref  = useRef(null);
  const tap  = useRef(false);   // a tap already put the row under the finger — don't yank the list
  const idx  = items.findIndex((it) => it.v === value);

  // Bring the picked row into view when the value arrives from outside (opening
  // the form on an existing birthday), never on the user's own tap.
  useEffect(() => {
    if (tap.current) { tap.current = false; return; }
    if (idx < 0) return;
    const t = setTimeout(() => {
      ref.current?.scrollTo({ y: Math.max(0, (idx - 1) * ITEM_H), animated: false });
    }, 0);
    return () => clearTimeout(t);
  }, [idx]);

  return (
    <ScrollView
      ref={ref}
      style={[styles.col, { flex }]}
      contentContainerStyle={styles.colInner}
      showsVerticalScrollIndicator={false}
      scrollEnabled={!disabled}
    >
      {items.map((it) => {
        const on = it.v === value;
        return (
          <Pressable
            key={it.v}
            onPress={disabled ? undefined : () => { tap.current = true; onSelect(on ? null : it.v); }}
            style={[styles.item, on && styles.itemOn]}
          >
            <Text style={[styles.itemText, on && styles.itemTextOn]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export default function BirthdayPicker({ value, onChange, disabled = false }) {
  const { y = null, m = null, d = null } = value || {};

  const years = useMemo(() => {
    const now = new Date().getUTCFullYear();
    return Array.from({ length: OLDEST + 1 }, (_, i) => ({ v: now - i, label: String(now - i) }));
  }, []);
  const months = useMemo(
    () => MONTHS.map((label, i) => ({ v: i + 1, label })),
    [],
  );
  const days = useMemo(() => {
    const n = daysIn(y, m);
    return Array.from({ length: n }, (_, i) => ({ v: i + 1, label: String(i + 1) }));
  }, [y, m]);

  // Any change can shorten the month under a picked day (Feb after the 30th):
  // clamp rather than emit a date that does not exist.
  const set = (patch) => {
    const next = { y, m, d, ...patch };
    if (next.d && next.d > daysIn(next.y, next.m)) next.d = daysIn(next.y, next.m);
    onChange(next);
  };

  return (
    <View>
      <View style={[styles.frame, disabled && styles.frameOff]}>
        <Column items={days}   value={d} flex={0.8} disabled={disabled} onSelect={(v) => set({ d: v })} />
        <View style={styles.divider} />
        <Column items={months} value={m} flex={1}   disabled={disabled} onSelect={(v) => set({ m: v })} />
        <View style={styles.divider} />
        <Column items={years}  value={y} flex={1}   disabled={disabled} onSelect={(v) => set({ y: v })} />
      </View>

      <View style={styles.footer}>
        <Text style={styles.readout}>
          {isCompleteBirthday(value)
            ? `${d} ${MONTHS[m - 1]} ${y}`
            : isPartialBirthday(value) ? 'PICK ALL THREE' : 'NOT SET'}
        </Text>
        {(y || m || d) ? (
          <Pressable onPress={disabled ? undefined : () => onChange({ y: null, m: null, d: null })}>
            <Text style={styles.clear}>CLEAR</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flexDirection: 'row',
    height: ITEM_H * ROWS,
    backgroundColor: SL.panelAlt,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  frameOff: { opacity: 0.5 },
  col: { flexGrow: 0 },
  colInner: { paddingVertical: 2 },
  divider: { width: 1, backgroundColor: SL.border },
  item: {
    height: ITEM_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemOn: { backgroundColor: 'rgba(74,158,191,0.16)' },
  itemText: {
    fontFamily: F.body,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 1,
  },
  itemTextOn: { color: SL.accent, fontFamily: F.heading },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  readout: {
    fontFamily: F.heading,
    fontSize: 13,
    color: SL.text,
    letterSpacing: 2,
  },
  clear: {
    fontFamily: F.heading,
    fontSize: 12,
    color: SL.muted,
    letterSpacing: 2,
  },
});
