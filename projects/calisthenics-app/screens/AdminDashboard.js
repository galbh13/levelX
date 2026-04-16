import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';

export default function AdminDashboard({ navigation }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Admin</Text>
      <Text style={styles.sub}>Dashboard coming soon</Text>
      <TouchableOpacity
        style={styles.galleryBtn}
        onPress={() => navigation.navigate('ExerciseGallery')}
      >
        <Text style={styles.galleryBtnText}>Exercise Gallery</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.logout} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center', gap: 12 },
  title:          { fontFamily: F.heading, fontSize: 28, color: C.iceGlow, letterSpacing: 4, textTransform: 'uppercase' },
  sub:            { fontFamily: F.bodyMed, fontSize: 12, color: C.textMuted, letterSpacing: 2, textTransform: 'uppercase' },
  galleryBtn:     { paddingHorizontal: 24, paddingVertical: 10, borderWidth: 1, borderColor: C.iceGlow, borderRadius: 6 },
  galleryBtnText: { fontFamily: F.bodyMed, fontSize: 12, color: C.iceGlow, letterSpacing: 2, textTransform: 'uppercase' },
  logout:         { paddingHorizontal: 24, paddingVertical: 10, borderWidth: 1, borderColor: C.cardBorder, borderRadius: 6 },
  logoutText:     { fontFamily: F.body, fontSize: 12, color: C.textMuted, letterSpacing: 2, textTransform: 'uppercase' },
});
