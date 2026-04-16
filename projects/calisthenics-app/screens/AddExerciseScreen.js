import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';

const MOVEMENT_TYPES = ['Strength', 'Skill', 'Mobility', 'Conditioning'];

export default function AddExerciseScreen({ navigation }) {
  const [name,         setName]         = useState('');
  const [movementType, setMovementType] = useState('Strength');
  const [youtubeUrl,   setYoutubeUrl]   = useState('');
  const [saving,       setSaving]       = useState(false);

  async function handleSave() {
    if (!name.trim()) { Alert.alert('Required', 'Please enter an exercise name.'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('exercises_gallery').insert({
        name:          name.trim(),
        movement_type: movementType,
        youtube_url:   youtubeUrl.trim() || null,
        created_by:    user.id,
      });
      if (error) throw error;
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.message ?? 'Failed to save exercise.');
    }
    setSaving(false);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Add Exercise</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.form}>
        {/* Name */}
        <Text style={styles.label}>Exercise Name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Pull-Ups"
          placeholderTextColor={C.textMuted}
          value={name}
          onChangeText={setName}
        />

        {/* Movement type */}
        <Text style={styles.label}>Movement Type</Text>
        <View style={styles.typeRow}>
          {MOVEMENT_TYPES.map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.typeChip, movementType === t && styles.typeChipActive]}
              onPress={() => setMovementType(t)}
            >
              <Text style={[styles.typeChipText, movementType === t && styles.typeChipTextActive]}>
                {t}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* YouTube URL */}
        <Text style={styles.label}>YouTube URL <Text style={styles.optional}>(optional)</Text></Text>
        <TextInput
          style={styles.input}
          placeholder="https://youtube.com/watch?v=..."
          placeholderTextColor={C.textMuted}
          value={youtubeUrl}
          onChangeText={setYoutubeUrl}
          autoCapitalize="none"
          keyboardType="url"
        />

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveBtnText}>Save Exercise</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.cardBorder,
  },
  back: { width: 60 },
  backText: { fontFamily: F.bodyMed, color: C.iceGlow, fontSize: 13, letterSpacing: 2 },
  title: {
    flex: 1,
    fontFamily: F.heading,
    fontSize: 18,
    color: C.text,
    letterSpacing: 3,
    textTransform: 'uppercase',
    textAlign: 'center',
  },

  form: { padding: 20, gap: 8 },

  label: {
    fontFamily: F.bodyMed,
    fontSize: 11,
    color: C.textMuted,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 4,
  },
  optional: { color: C.textMuted, fontSize: 10 },

  input: {
    height: 50,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 8,
    paddingHorizontal: 14,
    fontFamily: F.body,
    fontSize: 14,
    color: C.text,
  },

  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.cardBorder,
    backgroundColor: C.surface,
  },
  typeChipActive: {
    backgroundColor: C.iceGlow,
    borderColor: C.iceGlow,
  },
  typeChipText: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: C.textMuted,
    letterSpacing: 1,
  },
  typeChipTextActive: { color: '#fff' },

  saveBtn: {
    marginTop: 32,
    height: 52,
    backgroundColor: C.iceGlow,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: {
    fontFamily: F.heading,
    fontSize: 13,
    color: '#fff',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
});
