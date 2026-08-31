import { View, Text, StyleSheet } from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
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
// carries one word: COMING SOON, big, in the house accent (C.deepBlue) so the
// empty tab still reads as part of the system. The pillars come back with the
// content.

export default function PersonalScreen() {
  // Element the guided tour measures + points its arrow at.
  const tourSystemRef = useTourTarget('personal.system');

  return (
    <ScreenFrame fill>
      <View style={styles.card}>
        <ScreenHeader title="THE SYSTEM" />

        <View style={styles.body}>
          <View ref={tourSystemRef} style={styles.center}>
            <Text style={styles.title}>COMING{'\n'}SOON</Text>
          </View>
        </View>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1 },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 18, paddingBottom: 26 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: {
    fontFamily: F.heading, fontSize: 54, lineHeight: 64, color: C.deepBlue,
    letterSpacing: 6, textAlign: 'center',
    textShadowColor: 'rgba(74,158,191,0.55)',
    textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 22,
  },
});
