import { View, Text, StyleSheet } from 'react-native';
import { F } from '../constants/fonts';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';

// ─── The System (player) ────────────────────────────────────────────────────
// Purple-accented Community entry. Placeholder for now — the real feature lands
// later; for the first cut it's an empty page reachable from the Community tab.
const PURPLE = '#A66BFF';

export default function SystemScreen({ navigation }) {
  return (
    <ScreenFrame ready>
      <View style={styles.card}>
        <ScreenHeader title="THE SYSTEM" onBack={() => navigation.goBack()} />
        <View style={styles.body}>
          <View style={styles.center}>
            <Text style={styles.title}>THE SYSTEM</Text>
            <Text style={styles.text}>Coming soon.</Text>
          </View>
        </View>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  card: { flexGrow: 1 },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 18, paddingBottom: 26 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 },
  title: {
    fontFamily: F.heading, fontSize: 26, color: PURPLE,
    letterSpacing: 4, textAlign: 'center',
    textShadowColor: 'rgba(166,107,255,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 14,
  },
  text: {
    fontFamily: F.bodyMed, fontSize: 16, color: '#8a7ab0',
    letterSpacing: 1, textAlign: 'center',
  },
});
