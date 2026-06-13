import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';
import ScreenFrame from '../components/ScreenFrame';

const SL = {
  bg:      '#050912',
  panel:   '#0d1e35',
  border:  '#2a5070',
  accent:  '#4A9EBF',
  text:    '#E8F4FF',
  muted:   '#8ab0cc',
  green:   '#4CAF50',
  danger:  '#FF4444',
};

const MOVEMENT_TYPES = ['Pull', 'Push', 'Balance', 'Legs', 'Mobility', 'Flexibility'];

export default function AddExerciseScreen({ navigation }) {
  const [name,         setName]         = useState('');
  const [movementType, setMovementType] = useState('Pull');
  const [videoUrl,     setVideoUrl]     = useState('');   // Supabase storage URL
  const [description,  setDescription]  = useState('');
  const [coachingCues, setCoachingCues] = useState('');
  const [classOrder,   setClassOrder]   = useState(null);
  const [classes,      setClasses]      = useState([]);
  const [uploading,    setUploading]    = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [errorMsg,     setErrorMsg]     = useState('');

  useEffect(() => {
    supabase
      .from('classes')
      .select('id, name, order_index')
      .order('order_index')
      .then(({ data }) => setClasses(data ?? []));
  }, []);

  // ── Video upload ──────────────────────────────────────────────────────────────

  async function handleUploadVideo() {
    setErrorMsg('');
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setErrorMsg('Media library permission is required to upload videos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
      quality: 1,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    setUploading(true);

    try {
      // Fetch the file as a blob (works on web and native)
      const response = await fetch(asset.uri);
      const blob = await response.blob();

      const ext = (asset.uri.split('.').pop() ?? 'mp4').toLowerCase().split('?')[0];
      const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const path = `exercises/${filename}`;

      const { error: uploadError } = await supabase.storage
        .from('exercise-videos')
        .upload(path, blob, {
          contentType: blob.type || `video/${ext}`,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('exercise-videos')
        .getPublicUrl(path);

      setVideoUrl(publicUrl);
    } catch (e) {
      setErrorMsg(e.message ?? 'Video upload failed.');
    }

    setUploading(false);
  }

  // ── Save ──────────────────────────────────────────────────────────────────────

  async function handleSave() {
    setErrorMsg('');
    if (!name.trim()) { setErrorMsg('Please enter an exercise name.'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const payload = {
        name:          name.trim(),
        movement_type: movementType,
        video_url:     videoUrl || null,
        description:   description.trim() || null,
        coaching_cues: coachingCues.trim() || null,
        created_by:    user.id,
      };
      if (classOrder !== null) payload.min_class_order = classOrder;

      const { error } = await supabase.from('exercises_gallery').insert(payload);
      if (error) throw error;
      navigation.goBack();
    } catch (e) {
      setErrorMsg(e.message ?? 'Failed to save. Please try again.');
    }
    setSaving(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <ScreenFrame maxWidth={920}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.title}>NEW EXERCISE</Text>
        <View style={{ width: 122 }} />
      </View>

      <View style={styles.form}>

        {/* ── Name ── */}
        <Text style={styles.label}>EXERCISE NAME</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Pull-Ups"
          placeholderTextColor={SL.muted}
          value={name}
          onChangeText={setName}
        />

        {/* ── Movement Type ── */}
        <Text style={styles.label}>MOVEMENT TYPE</Text>
        <View style={styles.chipRow}>
          {MOVEMENT_TYPES.map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.chip, movementType === t && styles.chipActive]}
              onPress={() => setMovementType(t)}
            >
              <Text style={[styles.chipText, movementType === t && styles.chipTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Target Class ── */}
        <Text style={styles.label}>
          TARGET CLASS <Text style={styles.optional}>(optional)</Text>
        </Text>
        <View style={styles.chipRow}>
          <TouchableOpacity
            style={[styles.chip, classOrder === null && styles.chipActive]}
            onPress={() => setClassOrder(null)}
          >
            <Text style={[styles.chipText, classOrder === null && styles.chipTextActive]}>ALL</Text>
          </TouchableOpacity>
          {classes.map(c => (
            <TouchableOpacity
              key={c.id}
              style={[styles.chip, classOrder === c.order_index && styles.chipActive]}
              onPress={() => setClassOrder(c.order_index)}
            >
              <Text style={[styles.chipText, classOrder === c.order_index && styles.chipTextActive]}>
                {c.name.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Video Upload ── */}
        <Text style={styles.label}>
          DEMO VIDEO <Text style={styles.optional}>(optional)</Text>
        </Text>
        {videoUrl ? (
          <View style={styles.videoUploadedBox}>
            <Text style={styles.videoUploadedIcon}>✓</Text>
            <Text style={styles.videoUploadedText}>Video uploaded successfully</Text>
            <TouchableOpacity onPress={() => setVideoUrl('')} style={styles.videoRemoveBtn}>
              <Text style={styles.videoRemoveText}>REMOVE</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.uploadBtn, uploading && styles.uploadBtnDisabled]}
            onPress={handleUploadVideo}
            disabled={uploading}
            activeOpacity={0.8}
          >
            {uploading ? (
              <View style={styles.uploadBtnInner}>
                <ActivityIndicator color={SL.accent} size="small" />
                <Text style={styles.uploadBtnText}>UPLOADING...</Text>
              </View>
            ) : (
              <Text style={styles.uploadBtnText}>▲  UPLOAD VIDEO</Text>
            )}
          </TouchableOpacity>
        )}

        {/* ── Description ── */}
        <Text style={styles.label}>
          DESCRIPTION <Text style={styles.optional}>(optional)</Text>
        </Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          placeholder="What is this exercise and why it matters..."
          placeholderTextColor={SL.muted}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />

        {/* ── Coaching Cues ── */}
        <Text style={styles.label}>
          COACHING CUES <Text style={styles.optional}>(optional — one per line)</Text>
        </Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          placeholder={'Keep elbows close\nDead hang start\nFull range of motion'}
          placeholderTextColor={SL.muted}
          value={coachingCues}
          onChangeText={setCoachingCues}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        {/* ── Error ── */}
        {!!errorMsg && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠ {errorMsg}</Text>
          </View>
        )}

        {/* ── Save ── */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color={SL.bg} />
            : <Text style={styles.saveBtnText}>SAVE EXERCISE</Text>
          }
        </TouchableOpacity>

      </View>
    </ScreenFrame>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 26, paddingBottom: 16,
    borderBottomWidth: 1.5, borderBottomColor: SL.border,
  },
  // Glowing ice pill (matches the gallery / admin nav buttons).
  back: {
    paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: 22, borderWidth: 1.5, borderColor: SL.accent,
    backgroundColor: 'rgba(74,158,191,0.10)',
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 10,
  },
  backText: { fontFamily: F.heading, color: SL.accent, fontSize: 17, letterSpacing: 2 },
  title: {
    flex: 1, fontFamily: F.heading, fontSize: 34, color: SL.accent,
    letterSpacing: 6, textTransform: 'uppercase', textAlign: 'center',
    textShadowColor: 'rgba(74,158,191,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20,
  },

  form: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28 },

  label: {
    fontFamily: F.bodyMed, fontSize: 18, color: SL.text,
    letterSpacing: 2, textTransform: 'uppercase', marginTop: 30, marginBottom: 12,
  },
  optional: {
    fontFamily: F.body, fontSize: 15, color: SL.muted,
    textTransform: 'none', letterSpacing: 0.5,
  },

  input: {
    backgroundColor: SL.panel, borderWidth: 1.5, borderColor: SL.border, borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 18, fontFamily: F.body, fontSize: 21, color: SL.text,
  },
  multiline: { minHeight: 150, paddingTop: 18, lineHeight: 30 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  chip: {
    paddingHorizontal: 26, paddingVertical: 15,
    borderRadius: 999, borderWidth: 1.5, borderColor: SL.border, backgroundColor: SL.panel,
  },
  chipActive: {
    backgroundColor: 'rgba(74,158,191,0.16)', borderColor: SL.accent,
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 10,
  },
  chipText: { fontFamily: F.bodyMed, fontSize: 17, color: SL.muted, letterSpacing: 1 },
  chipTextActive: { color: SL.accent, fontFamily: F.heading },

  // ── Video upload ──────────────────────────────────────────────────────────────

  uploadBtn: {
    height: 60,
    borderWidth: 1.5, borderColor: SL.accent, borderRadius: 12,
    borderStyle: 'dashed',
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(74,158,191,0.08)',
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.25, shadowRadius: 8,
  },
  uploadBtnDisabled: { opacity: 0.6 },
  uploadBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  uploadBtnText: {
    fontFamily: F.heading, fontSize: 17, color: SL.accent,
    letterSpacing: 3, textTransform: 'uppercase',
  },

  videoUploadedBox: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(76,175,80,0.08)',
    borderWidth: 1.5, borderColor: 'rgba(76,175,80,0.4)',
    borderRadius: 6, padding: 14,
  },
  videoUploadedIcon: { fontSize: 18, color: SL.green },
  videoUploadedText: {
    flex: 1, fontFamily: F.bodyMed, fontSize: 13, color: SL.green, letterSpacing: 0.5,
  },
  videoRemoveBtn: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(255,68,68,0.4)', borderRadius: 4,
  },
  videoRemoveText: {
    fontFamily: F.bodyMed, fontSize: 11, color: SL.danger, letterSpacing: 1,
  },

  // ── Error & save ──────────────────────────────────────────────────────────────

  errorBox: {
    marginTop: 20, backgroundColor: 'rgba(255,60,60,0.12)',
    borderWidth: 1.5, borderColor: '#FF4444', borderRadius: 6, padding: 14,
  },
  errorText: {
    fontFamily: F.bodyMed, fontSize: 14, color: '#FF6B6B', letterSpacing: 0.5, lineHeight: 20,
  },

  saveBtn: {
    marginTop: 32, height: 70, backgroundColor: SL.accent,
    borderRadius: 12, justifyContent: 'center', alignItems: 'center',
    shadowColor: SL.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.55, shadowRadius: 16,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: {
    fontFamily: F.heading, fontSize: 21, color: SL.bg,
    letterSpacing: 4, textTransform: 'uppercase',
  },
});
