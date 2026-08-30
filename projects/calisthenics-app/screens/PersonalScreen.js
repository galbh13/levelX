import {
  View, Text, StyleSheet, ScrollView,
} from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import { useTourTarget } from '../lib/tourTargets';

// ─── THE SYSTEM (player tab) ────────────────────────────────────────────────
// Everything OUTSIDE the training itself — the coaching that runs alongside the
// programme. Five pillars, one node each. The tab was PERSONAL until 2026-08-26;
// the route is still named `Personal` internally (the tab bar, the guided tour
// and every `navigate('Personal')` call key off that name), only the label the
// player reads changed. Its old single "THE SYSTEM" card became the screen.
//
// The nodes are DELIBERATELY inert for now — there is nothing behind them yet.
// They are plain Views, not Pressables, so a tap doesn't promise a page that
// isn't there. Give one a screen and it becomes a Pressable with an onPress.

// One accent per pillar. Spread across the system palette so the five read as
// distinct at a glance, staying inside the neon-on-near-black language: indigo
// and cyan for the physical pillars, jade for fuel, amber for the human one,
// and the house purple for the mind.
const PILLARS = [
  { key: 'sleep',     name: 'SLEEP',     color: '#6C7BFF' },  // indigo
  { key: 'nutrition', name: 'NUTRITION', color: '#1FD79A' },  // jade
  { key: 'recovery',  name: 'RECOVERY',  color: '#35D6E8' },  // cyan
  { key: 'socialize', name: 'SOCIALIZE', color: '#FFA94D' },  // amber
  { key: 'mentality', name: 'MENTALITY', color: '#A66BFF' },  // purple
];

export default function PersonalScreen() {
  // Element the guided tour measures + points its arrow at. It sits on the first
  // pillar now that the old single card is gone.
  const tourSystemRef = useTourTarget('personal.system');

  return (
    <ScreenFrame fill>
      <View style={styles.card}>
        <ScreenHeader title="THE SYSTEM" />

        <View style={styles.body}>
          <ScrollView showsVerticalScrollIndicator={false}>
            {PILLARS.map((p, i) => (
              <View
                key={p.key}
                ref={i === 0 ? tourSystemRef : undefined}
                style={[styles.pillarCard, { borderColor: tint(p.color, 0.45), shadowColor: p.color }]}
              >
                <View style={[styles.pillarHandle, { backgroundColor: p.color, shadowColor: p.color }]} />
                <View style={styles.cardText}>
                  <Text style={[styles.pillarName, { color: p.color, textShadowColor: tint(p.color, 0.4) }]}>
                    {p.name}
                  </Text>
                </View>
                <Text style={[styles.pillarChevron, { color: p.color }]}>›</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </ScreenFrame>
  );
}

// #RRGGBB → rgba() at the given alpha, so each pillar's border and text glow are
// derived from its ONE accent instead of hand-written twice.
function tint(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const styles = StyleSheet.create({
  card: { flex: 1 },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 18, paddingBottom: 26 },

  // One pillar node. Colour comes from PILLARS at render time; everything that
  // is the same for all five lives here.
  pillarCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: C.surface,
    paddingVertical: 20,
    paddingLeft: 20,
    paddingRight: 18,
    gap: 18,
    marginBottom: 14,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  pillarHandle: {
    width: 4, height: 40, borderRadius: 2,
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.75, shadowRadius: 8,
  },
  pillarName: {
    fontFamily: F.heading, fontSize: 22,
    letterSpacing: 2, textTransform: 'uppercase',
    textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
  },
  pillarChevron: { fontFamily: F.heading, fontSize: 28, marginLeft: 2 },

  cardText: { flex: 1 },
});
