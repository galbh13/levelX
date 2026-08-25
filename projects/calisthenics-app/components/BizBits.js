// Small shared pieces for the BUSINESS screens (admin-only money surfaces).
// Kept in one file so the business dashboard, the plans editor and the per-player
// money card all read as the same UI language.
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';

export const BIZ = {
  panel:  '#070d1a',
  border: 'rgba(74,158,191,0.28)',
  accent: '#4A9EBF',
  muted:  '#4a6a8a',
  gold:   '#FFD700',
  jade:   '#1FD79A',
  alert:  '#E11D48',
  text:   '#E8F4FF',
};

/** One headline number with its label — the KPI grid unit. */
export function StatTile({ label, value, sub, tone = 'accent', flex = 1 }) {
  const color = BIZ[tone] ?? BIZ.accent;
  return (
    <View style={[styles.tile, { flex, borderColor: `${color}44` }]}>
      <Text style={styles.tileLabel} numberOfLines={1}>{label}</Text>
      <Text style={[styles.tileValue, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {value}
      </Text>
      {sub ? <Text style={styles.tileSub} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

/** A status / risk pill. */
export function Chip({ label, color = BIZ.muted, solid = false, style }) {
  return (
    <View style={[
      styles.chip,
      { borderColor: color, backgroundColor: solid ? color : `${color}1f` },
      style,
    ]}>
      <Text style={[styles.chipText, { color: solid ? '#050912' : color }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

/** Labelled text input row used by every editor form here. */
export function Field({ label, value, onChangeText, placeholder, keyboardType, multiline, width }) {
  return (
    <View style={[styles.field, width ? { width } : { flex: 1, minWidth: 150 }]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMulti]}
        value={value ?? ''}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#2a4a6a"
        keyboardType={keyboardType}
        multiline={multiline}
      />
    </View>
  );
}

/** A labelled row of mutually-exclusive option pills. `null` clears. */
export function Choice({ label, options, value, onSelect, allowClear = false }) {
  return (
    <View style={styles.choice}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.choiceRow}>
        {options.map((o) => {
          const on = String(o.key) === String(value);
          return (
            <Pressable
              key={String(o.key)}
              onPress={() => onSelect(on && allowClear ? null : o.key)}
              style={[styles.optPill, on && styles.optPillOn]}
            >
              <Text style={[styles.optText, on && styles.optTextOn]} numberOfLines={1}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Section heading with a hairline rule. */
export function SectionTitle({ children, right }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionText}>{children}</Text>
      <View style={styles.sectionRule} />
      {right ?? null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    minWidth: 128,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: BIZ.panel,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  tileLabel: {
    fontFamily: F.heading, fontSize: 11, letterSpacing: 2,
    color: BIZ.muted, textTransform: 'uppercase',
  },
  tileValue: { fontFamily: F.heading, fontSize: 24, marginTop: 8, letterSpacing: 0.5 },
  tileSub: { fontFamily: F.bodyMed, fontSize: 11, color: BIZ.muted, marginTop: 4, letterSpacing: 0.4 },

  chip: {
    borderRadius: 999, borderWidth: 1,
    paddingVertical: 4, paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },
  chipText: { fontFamily: F.heading, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase' },

  field: { marginBottom: 12 },
  fieldLabel: {
    fontFamily: F.heading, fontSize: 11, letterSpacing: 2,
    color: BIZ.muted, textTransform: 'uppercase', marginBottom: 6,
  },
  input: {
    borderWidth: 1, borderColor: BIZ.border, borderRadius: 10,
    backgroundColor: C.surface, color: BIZ.text,
    paddingVertical: 10, paddingHorizontal: 12,
    fontFamily: F.bodyMed, fontSize: 15,
  },
  inputMulti: { minHeight: 74, textAlignVertical: 'top' },

  choice: { marginBottom: 12 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optPill: {
    borderRadius: 999, borderWidth: 1, borderColor: 'rgba(74,158,191,0.25)',
    backgroundColor: C.surface, paddingVertical: 8, paddingHorizontal: 14,
  },
  optPillOn: {
    borderColor: BIZ.accent, backgroundColor: 'rgba(74,158,191,0.18)',
    shadowColor: BIZ.accent, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5, shadowRadius: 8,
  },
  optText: {
    fontFamily: F.heading, fontSize: 12, letterSpacing: 1.4,
    color: BIZ.muted, textTransform: 'uppercase',
  },
  optTextOn: { color: BIZ.text },

  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 22, marginBottom: 12 },
  sectionText: {
    fontFamily: F.heading, fontSize: 14, letterSpacing: 3,
    color: BIZ.accent, textTransform: 'uppercase',
  },
  sectionRule: { flex: 1, height: 1, backgroundColor: 'rgba(74,158,191,0.22)' },
});
