import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';

export default function AddWorkoutScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← BACK</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Exercise Gallery</Text>
      <Text style={styles.sub}>Coming Soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  back: {
    position: 'absolute',
    top: 56,
    left: 24,
  },
  backText: {
    fontFamily: F.bodyMed,
    color: C.iceGlow,
    fontSize: 13,
    letterSpacing: 2,
  },
  title: {
    fontFamily: F.heading,
    fontSize: 24,
    color: C.text,
    letterSpacing: 3,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  sub: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: C.textMuted,
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginTop: 10,
  },
});
