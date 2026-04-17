import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { F } from '../constants/fonts';

// ─── Theme ────────────────────────────────────────────────────────────────────

const SL = {
  bg:     '#050912',
  panel:  '#070d1a',
  border: '#1a3a5c',
  accent: '#4A9EBF',
  text:   '#E8F4FF',
  muted:  '#4a6a8a',
  green:  '#4CAF50',
};

function Corner({ pos }) {
  const s = pos === 'TL'
    ? { top: -1, left: -1, borderTopWidth: 1.5, borderLeftWidth: 1.5 }
    : { bottom: -1, right: -1, borderBottomWidth: 1.5, borderRightWidth: 1.5 };
  return <View style={[styles.corner, s]} pointerEvents="none" />;
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CoachResponseScreen({ route, navigation }) {
  const { checkup } = route.params;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.title}>COACH FEEDBACK</Text>
        <Text style={styles.subtitle}>{fmtDate(checkup.scheduled_date)}</Text>
        <View style={styles.divider} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.sectionLabel}>RESPONSE</Text>
        <View style={styles.card}>
          <Corner pos="TL" /><Corner pos="BR" />
          <Text style={styles.responseText}>{checkup.coach_response}</Text>
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg },

  corner: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderColor: SL.green,
    zIndex: 2,
  },

  header: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: SL.border,
  },
  backText: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.accent,
    letterSpacing: 2,
    marginBottom: 16,
  },
  title: {
    fontFamily: F.heading,
    fontSize: 32,
    color: SL.green,
    letterSpacing: 4,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.muted,
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: 6,
  },
  divider: {
    height: 1,
    backgroundColor: SL.green,
    opacity: 0.3,
    marginTop: 20,
  },

  body: { padding: 20 },

  sectionLabel: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: SL.muted,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },

  card: {
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.green,
    borderRadius: 4,
    overflow: 'visible',
    position: 'relative',
    padding: 20,
  },
  responseText: {
    fontFamily: F.body,
    fontSize: 16,
    color: SL.text,
    lineHeight: 24,
  },
});
