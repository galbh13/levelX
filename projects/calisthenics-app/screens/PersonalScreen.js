import { View, Text, StyleSheet } from 'react-native';
import { F } from '../constants/fonts';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import { useTourTarget } from '../lib/tourTargets';

// ─── THE SYSTEM (player tab) ────────────────────────────────────────────────
// Everything OUTSIDE the training itself — the coaching that runs alongside the
// programme. The tab was PERSONAL until 2026-08-26; the route is still named
// `Personal` internally (the tab bar, the guided tour and every
// `navigate('Personal')` call key off that name), only the label the player
// reads changed.
//
// The five pillars (sleep, nutrition, recovery, socialize, mentality) had a node
// each here, but there is nothing behind them yet — the coaching content still
// has to be recorded. Rather than ship five nodes that go nowhere, the screen
// says COMING SOON until that content exists; the pillar list comes back with it.
const PURPLE = '#A66BFF';

export default function PersonalScreen() {
  // Element the guided tour measures + points its arrow at.
  const tourSystemRef = useTourTarget('personal.system');

  return (
    <ScreenFrame fill>
      <View style={styles.card}>
        <ScreenHeader title="THE SYSTEM" />

        <View style={styles.body}>
          <View ref={tourSystemRef} style={styles.center}>
            <Text style={styles.title}>COMING SOON</Text>
            <Text style={styles.text}>
              Sleep, nutrition, recovery, socialize, mentality — the coaching
              around your training lands here in the next update.
            </Text>
          </View>
        </View>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1 },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 18, paddingBottom: 26 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 },
  title: {
    fontFamily: F.heading, fontSize: 26, color: PURPLE,
    letterSpacing: 4, textAlign: 'center',
    textShadowColor: 'rgba(166,107,255,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 14,
  },
  text: {
    fontFamily: F.bodyMed, fontSize: 15, color: '#8a7ab0',
    letterSpacing: 0.5, lineHeight: 22, textAlign: 'center', maxWidth: 300,
  },
});
