import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { uploadAssetToBucket, videoMeta } from '../lib/storageUpload';
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

const MOVEMENT_TYPES = ['Pull', 'Push', 'Balance', 'Legs', 'Core', 'Mobility', 'Flexibility', 'Isolated'];

export default function AddExerciseScreen({ navigation, route }) {
  // When opened with an `exercise`, the screen edits it in place; otherwise it
  // creates a new gallery entry.
  const editing = route.params?.exercise ?? null;

  const [name,         setName]         = useState(editing?.name ?? '');
  const [movementType, setMovementType] = useState(editing?.movement_type ?? 'Pull');
  const [videoUrl,     setVideoUrl]     = useState(editing?.video_url ?? '');   // Supabase storage URL
  const [description,  setDescription]  = useState(editing?.description ?? '');
  const [coachingCues, setCoachingCues] = useState(editing?.coaching_cues ?? '');
  // Target classes — an exercise can target several. Empty set = all classes.
  // Prefer the new `class_orders` array; fall back to the legacy single column.
  const [classOrders,  setClassOrders]  = useState(
    editing?.class_orders ?? (editing?.min_class_order != null ? [editing.min_class_order] : [])
  );
  const [classes,      setClasses]      = useState([]);
  const [uploading,    setUploading]    = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [errorMsg,     setErrorMsg]     = useState('');

  useEffect(() => {
    supabase
      .from('classes')
      .select('id, name, order_index')
      // Exercise-library targets follow the 'static' class ladder only.
      .eq('job', 'static')
      .order('order_index')
      .then(({ data }) => setClasses(data ?? []));
  }, []);

  // Tapping a class toggles it in/out of the set; tapping ALL clears the set.
  function toggleClass(orderIndex) {
    setClassOrders(prev =>
      prev.includes(orderIndex)
        ? prev.filter(o => o !== orderIndex)
        : [...prev, orderIndex]
    );
  }

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
      // Streams the file off the device — a fetched Blob carries no bytes in JS
      // on native, so the old blob upload failed on the APK.
      const { ext, contentType } = videoMeta(asset.uri);
      const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const path = `exercises/${filename}`;

      const publicUrl = await uploadAssetToBucket('exercise-videos', path, asset, {
        contentType, upsert: false, sizeLabel: 'clip',
      });

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

      const sortedOrders = [...classOrders].sort((a, b) => a - b);
      const fields = {
        name:            name.trim(),
        movement_type:   movementType,
        video_url:       videoUrl || null,
        description:     description.trim() || null,
        coaching_cues:   coachingCues.trim() || null,
        // Empty set = all classes. `class_orders` is the full set; `min_class_order`
        // stays as the min so ordering & legacy readers keep working.
        class_orders:    sortedOrders.length ? sortedOrders : null,
        min_class_order: sortedOrders.length ? sortedOrders[0] : null,
      };

      if (editing) {
        const { error } = await supabase
          .from('exercises_gallery')
          .update(fields)
          .eq('id', editing.id);
        if (error) throw error;
        // Return straight to the gallery (it's below in the stack and re-fetches
        // on focus, so the edited values show). This pops the in-between detail
        // screen too, matching the workout editor which also returns to the gallery.
        navigation.navigate('ExerciseGallery');
      } else {
        const { error } = await supabase
          .from('exercises_gallery')
          .insert({ ...fields, created_by: user.id });
        if (error) throw error;
        navigation.goBack();
      }
    } catch (e) {
      setErrorMsg(e.message ?? 'Failed to save. Please try again.');
    }
    setSaving(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <ScreenFrame>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{editing ? 'EDIT EXERCISE' : 'NEW EXERCISE'}</Text>
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

        {/* ── Target Classes ── */}
        <Text style={styles.label}>
          TARGET CLASSES <Text style={styles.optional}>(optional — pick one or more)</Text>
        </Text>
        <View style={styles.chipRow}>
          {/* ALL = every class (mutually exclusive with the specific picks). */}
          <TouchableOpacity
            style={[styles.chip, classOrders.length === 0 && styles.chipActive]}
            onPress={() => setClassOrders([])}
          >
            <Text style={[styles.chipText, classOrders.length === 0 && styles.chipTextActive]}>ALL</Text>
          </TouchableOpacity>
          <View style={styles.chipDivider} />
          {/* Specific classes — additive, pick as many as you like. */}
          {classes.map(c => {
            const on = classOrders.includes(c.order_index);
            return (
              <TouchableOpacity
                key={c.id}
                style={[styles.chip, on && styles.chipActive]}
                onPress={() => toggleClass(c.order_index)}
              >
                <Text style={[styles.chipText, on && styles.chipTextActive]}>
                  {c.name.toUpperCase()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Video Upload ── */}
        <Text style={styles.label}>
          DEMO VIDEO <Text style={styles.optional}>(optional)</Text>
        </Text>
        {videoUrl ? (
          <View style={styles.videoUploadedBox}>
            <View style={styles.videoUploadedBadge}>
              <Text style={styles.videoUploadedIcon}>✓</Text>
            </View>
            <View style={styles.videoUploadedTextWrap}>
              <Text style={styles.videoUploadedText}>VIDEO LINKED</Text>
            </View>
            <TouchableOpacity onPress={() => setVideoUrl('')} style={styles.videoRemoveBtn} activeOpacity={0.7}>
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
        {/* The card reads this text back as blocks — see parseDescription in
            ExerciseDetailScreen. Teaching the shape HERE is what makes that
            worth having: the coach can't use a format he can't see. */}
        <Text style={styles.hint}>
          One idea per line. {'\n'}
          <Text style={styles.hintCode}>term - explanation</Text> becomes a definition ·{' '}
          <Text style={styles.hintCode}>note:</Text> /{' '}
          <Text style={styles.hintCode}>common mistake:</Text> become callouts ·{' '}
          <Text style={styles.hintCode}>1.</Text> starts a numbered list ·{' '}
          <Text style={styles.hintCode}>back cues - 1</Text> shows the cue colour it names.
        </Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          placeholder={'there are 2 ways to perform this\nback to wall - easier, you can stack reps\nbelly to wall - harder, trains the lean\nimportant note: hands width sets the difficulty'}
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
        <Text style={styles.hint}>
          Plain lines are numbered 1, 2, 3. To split the cues between two
          variations, REPEAT the number —{' '}
          <Text style={styles.hintCode}>1.</Text> on every back-to-wall cue,{' '}
          <Text style={styles.hintCode}>2.</Text> on every belly-to-wall cue — and each
          group gets its own colour.
        </Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          placeholder={'1. control the arch\n1. lean forward as much as possible\n2. feet go backwards as you lean\n2. more distance from the wall'}
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
            : <Text style={styles.saveBtnText}>{editing ? 'SAVE CHANGES' : 'SAVE EXERCISE'}</Text>
          }
        </TouchableOpacity>

      </View>
    </ScreenFrame>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
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
  hint: {
    fontFamily: F.body, fontSize: 15, color: SL.muted, lineHeight: 24,
    letterSpacing: 0.3, marginTop: -4, marginBottom: 12,
  },
  hintCode: { color: SL.accent },

  input: {
    backgroundColor: SL.panel, borderWidth: 1.5, borderColor: SL.border, borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 18, fontFamily: F.body, fontSize: 21, color: SL.text,
  },
  multiline: { minHeight: 150, paddingTop: 18, lineHeight: 30 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
  // Separates the mutually-exclusive ALL chip from the additive class chips.
  chipDivider: { width: 1.5, height: 30, backgroundColor: SL.border, marginHorizontal: 2 },
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
    backgroundColor: 'rgba(74,158,191,0.08)',
    borderWidth: 1.5, borderColor: 'rgba(74,158,191,0.45)',
    borderRadius: 12, padding: 14,
  },
  videoUploadedBadge: {
    width: 30, height: 30, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(74,158,191,0.15)',
    borderWidth: 1, borderColor: 'rgba(74,158,191,0.55)',
  },
  videoUploadedIcon: { fontSize: 15, color: SL.accent, fontFamily: F.bodyMed },
  videoUploadedTextWrap: { flex: 1 },
  videoUploadedText: {
    fontFamily: F.heading, fontSize: 16, color: SL.accent, letterSpacing: 1.5,
  },
  videoRemoveBtn: {
    paddingHorizontal: 16, paddingVertical: 9,
    borderWidth: 1, borderColor: 'rgba(138,176,204,0.35)', borderRadius: 999,
  },
  videoRemoveText: {
    fontFamily: F.bodyMed, fontSize: 13, color: SL.muted, letterSpacing: 1.5,
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
