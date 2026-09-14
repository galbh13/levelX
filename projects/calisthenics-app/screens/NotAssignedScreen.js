import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import ScreenFrame from '../components/ScreenFrame';
import PillButton from '../components/PillButton';
import { C } from '../constants/colors';
import { F } from '../constants/fonts';

/**
 * The waiting room, for a player who has an account but no class yet.
 *
 * Every screen in the tab app is driven by `profiles.class_id`: the level, the
 * quest tree, the weekly schedule, the check-up template. A player the coach has
 * invited but not yet placed reads null for all of it, so the tabs mount and
 * render five empty rooms — a level that says 0/0, a quest tree with no nodes, a
 * week with no workouts — and nothing anywhere explains why. It looks broken
 * rather than pending, and it is the first thing a brand-new client sees.
 *
 * So they don't get the tabs at all until they are placed. One page, one
 * message, two ways out. See App.js's routing: this stands in for <PlayerApp/>
 * exactly the way SetPasswordScreen does for the first-login gate.
 */
export default function NotAssignedScreen({ onRecheck }) {
  const [busy, setBusy] = useState(false);

  async function recheck() {
    setBusy(true);
    try { await onRecheck?.(); } finally { setBusy(false); }
  }

  return (
    <View style={styles.root}>
      <ScreenFrame duration={5200}>
        <View style={styles.card}>
          <Text style={styles.kicker}>ACCESS GRANTED</Text>
          <Text style={styles.title}>AWAITING{'\n'}ASSIGNMENT</Text>
          <View style={styles.rule} />

          <Text style={styles.body}>
            You are registered. The System has not been built around you yet.
          </Text>
          <Text style={styles.body}>
            Your coach is setting your class, your starting level and your first
            quests by hand. The moment that lands, this page becomes your path.
          </Text>

          <Text style={styles.note}>Nothing is required from you until then.</Text>

          <PillButton
            label="CHECK AGAIN"
            onPress={recheck}
            loading={busy}
            size="lg"
            style={styles.action}
          />

          <PillButton
            label="SIGN OUT"
            onPress={() => supabase.auth.signOut()}
            tone="muted"
            size="sm"
            disabled={busy}
            style={styles.signOut}
          />
        </View>
      </ScreenFrame>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  card: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 40 },

  kicker: {
    fontFamily: F.heading,
    fontSize: 12,
    letterSpacing: 4,
    color: C.iceGlow,
    textAlign: 'center',
    opacity: 0.8,
  },
  title: {
    fontFamily: F.heading,
    fontSize: 34,
    letterSpacing: 3,
    color: C.text,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 40,
    textShadowColor: 'rgba(74,158,191,0.45)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
  },
  rule: {
    height: 1,
    backgroundColor: C.cardBorder,
    alignSelf: 'stretch',
    marginTop: 22,
    marginBottom: 26,
  },
  body: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    lineHeight: 24,
    color: '#8FB4CE',
    textAlign: 'center',
    marginBottom: 16,
  },
  note: {
    fontFamily: F.heading,
    fontSize: 12,
    letterSpacing: 2,
    color: C.textMuted,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 30,
  },
  action:  { alignSelf: 'center' },
  signOut: { alignSelf: 'center', marginTop: 18 },
});
