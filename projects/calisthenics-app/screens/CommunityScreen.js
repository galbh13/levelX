import { View, Text, StyleSheet } from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';

export default function CommunityScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Community</Text>
      <Text style={styles.sub}>Coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center', gap: 12 },
  title: { fontFamily: F.heading, fontSize: 24, color: C.text, letterSpacing: 3, textTransform: 'uppercase' },
  sub: { fontFamily: F.bodyMed, fontSize: 12, color: C.textMuted, letterSpacing: 2, textTransform: 'uppercase' },
});
