import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator,
} from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { CARD_H, CARD_W } from '../constants/layout';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import PillButton from '../components/PillButton';
import { fetchAllGroups, createGroup } from '../lib/community';

// ─── Admin — Community groups ───────────────────────────────────────────────
// Create groups and open one to manage its members + challenges. Reached from the
// COMMUNITY button on the AdminDashboard top bar.
export default function AdminCommunityScreen({ navigation }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  const [creating, setCreating] = useState(false);   // create form open
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setGroups(await fetchAllGroups());
    } catch (e) {
      console.error('[AdminCommunityScreen] load:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleCreate() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await createGroup(name, desc);
      setName(''); setDesc(''); setCreating(false);
      await load();
    } catch (e) {
      console.error('[AdminCommunityScreen] create:', e);
    }
    setSaving(false);
  }

  return (
    <ScreenFrame maxWidth={CARD_W} ready={!loading}>
      <View style={styles.card}>
        <ScreenHeader
          title="COMMUNITY"
          onBack={() => navigation.goBack()}
          right={
            <PillButton
              label={creating ? '✕' : '＋ GROUP'}
              size="sm"
              onPress={() => setCreating(v => !v)}
            />
          }
        />

        <View style={styles.body}>
          {creating && (
            <View style={styles.form}>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Group name"
                placeholderTextColor="#3a5a7a"
              />
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={desc}
                onChangeText={setDesc}
                placeholder="Description (optional)"
                placeholderTextColor="#3a5a7a"
                multiline
              />
              <PillButton
                label="CREATE GROUP"
                variant="solid"
                onPress={handleCreate}
                loading={saving}
                disabled={!name.trim()}
              />
            </View>
          )}

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={C.deepBlue} />
            </View>
          ) : groups.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.muted}>No groups yet. Create one above.</Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {groups.map(g => (
                <Pressable
                  key={g.id}
                  style={styles.groupCard}
                  onPress={() => navigation.navigate('AdminGroup', { group: g })}
                >
                  <View style={styles.handle} />
                  <View style={styles.groupText}>
                    <Text style={styles.groupName} numberOfLines={1}>{g.name}</Text>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaChip}>{g.memberCount} MEMBERS</Text>
                      <Text style={[styles.metaChip, styles.metaGold]}>{g.challengeCount} CHALLENGES</Text>
                    </View>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  card: { height: CARD_H },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 18, paddingBottom: 26 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  muted: { fontFamily: F.bodyMed, fontSize: 15, color: '#5a7a9a', letterSpacing: 0.6 },

  form: {
    gap: 12,
    marginBottom: 22,
    paddingBottom: 22,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(74,158,191,0.2)',
  },
  input: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: C.text,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: 'rgba(74,158,191,0.3)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inputMultiline: { minHeight: 64, textAlignVertical: 'top' },

  groupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(74,158,191,0.30)',
    backgroundColor: C.surface,
    paddingVertical: 20,
    paddingLeft: 20,
    paddingRight: 18,
    gap: 18,
    marginBottom: 14,
    shadowColor: C.deepBlue, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.14, shadowRadius: 12,
  },
  handle: {
    width: 4, height: 40, borderRadius: 2,
    backgroundColor: C.deepBlue,
    shadowColor: C.deepBlue, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 8,
  },
  groupText: { flex: 1, gap: 8 },
  groupName: {
    fontFamily: F.heading, fontSize: 22, color: C.text,
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  metaRow: { flexDirection: 'row', gap: 10 },
  metaChip: { fontFamily: F.heading, fontSize: 12, color: C.deepBlue, letterSpacing: 1.5 },
  metaGold: { color: '#FFD700' },
  chevron: { fontFamily: F.heading, fontSize: 28, color: C.deepBlue, marginLeft: 2 },
});
