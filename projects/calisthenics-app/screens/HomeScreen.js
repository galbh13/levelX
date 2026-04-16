import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity } from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { supabase } from '../lib/supabase';

export default function HomeScreen() {
  const user = { name: 'Gal', level: 13 };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.signOut} onPress={() => supabase.auth.signOut()}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
        <Text style={styles.username}>{user.name}</Text>
        <View style={styles.levelBadge}>
          <Text style={styles.levelText}>LVL {user.level}</Text>
        </View>
      </View>

      <View style={styles.body}>
        <Text style={styles.placeholder}>Your journey starts here.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 24,
    alignItems: 'center',
  },
  signOut: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  signOutText: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: C.iceGlow,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  username: {
    fontFamily: F.heading,
    fontSize: 52,
    color: C.text,
    letterSpacing: 4,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  levelBadge: {
    alignSelf: 'center',
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: C.lvlBadgeBg,
    borderWidth: 1.5,
    borderColor: C.deepBlue,
    borderRadius: 4,
  },
  levelText: {
    fontFamily: F.body,
    color: C.iceGlow,
    fontSize: 22,
    letterSpacing: 4,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholder: {
    fontFamily: F.bodyMed,
    color: C.textMuted,
    fontSize: 14,
    letterSpacing: 1,
  },
});
