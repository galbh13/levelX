import { View, Text, StyleSheet } from 'react-native';
import { F } from '../constants/fonts';
import PillButton from './PillButton';

// Shared header for the framed player screens: a glowing BACK pill on the left, a
// big glow-shadowed centered title, and an optional right-side action. Matches the
// Gallery header. `subtitle` renders a small muted line under the title (e.g. the
// player's name above "WEEKLY PLAN").
export default function ScreenHeader({ title, subtitle, onBack, right, titleStyle, subtitleStyle }) {
  // The side slots RESERVE pill-width only when the header actually has a pill —
  // but then BOTH of them do, even the empty one. Reserving unconditionally cost
  // the title 208dp of centre width on screens with neither a BACK nor an action
  // (CHECK-UP), which chopped "WEEKLY CHECK-UP" to "WEEKLY CH…"; reserving on
  // only the side that HAS the pill makes the two slots different widths, which
  // shoves the title off-centre by half the pill (visible on CHECK-UP INBOX,
  // where BACK pushed the title to the right). One flag for both slots is the
  // only arrangement that gets both cases right.
  const reserve = !!onBack || !!right;
  return (
    <View style={styles.header}>
      <View style={styles.row}>
        <View style={[styles.sideLeft, reserve && styles.sideReserve]}>
          {onBack ? <PillButton label="← BACK" onPress={onBack} size="sm" /> : null}
        </View>
        <Text
          style={[styles.title, titleStyle]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        >{title}</Text>
        <View style={[styles.sideRight, reserve && styles.sideReserve]}>{right ?? null}</View>
      </View>
      {subtitle ? <Text style={[styles.subtitle, subtitleStyle]}>{subtitle}</Text> : null}
      <View style={styles.divider} />
    </View>
  );
}

const ACCENT = '#4A9EBF';

const styles = StyleSheet.create({
  header: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // Equal-flex side slots keep the title (and subtitle) dead-centered on the card
  // regardless of how wide the BACK pill or the right action is. `sideReserve`
  // holds room for a pill so a long title can never squeeze a slot to 0 and
  // overlap it — applied to BOTH slots together, or not at all (see above).
  sideLeft: { flex: 1, alignItems: 'flex-start' },
  sideRight: { flex: 1, alignItems: 'flex-end' },
  sideReserve: { minWidth: 104 },
  title: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily: F.heading,
    fontSize: 28,
    color: ACCENT,
    letterSpacing: 5,
    textTransform: 'uppercase',
    textAlign: 'center',
    textShadowColor: 'rgba(74,158,191,0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  subtitle: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: '#4a6a8a',
    letterSpacing: 3,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginTop: 8,
  },
  divider: {
    height: 1,
    backgroundColor: ACCENT,
    opacity: 0.3,
    marginTop: 16,
  },
});
