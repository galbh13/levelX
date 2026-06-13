import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Image, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { supabase } from '../lib/supabase';
import { ShimmerRing, BLUE } from '../components/Shimmer';

const BIO_MAX = 120;

export default function ProfileScreen() {
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [uploading, setUploading] = useState(false);

  const [fullName,  setFullName]  = useState('');
  const [nickname,  setNickname]  = useState('');
  const [bio,       setBio]       = useState('');
  const [avatarUrl, setAvatarUrl] = useState(null);

  const [errorMsg,  setErrorMsg]  = useState('');
  const [savedMsg,  setSavedMsg]  = useState(false);

  // ── Load own profile ────────────────────────────────────────────────────────
  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('full_name, nickname, bio, avatar_url')
        .eq('id', user.id)
        .single();
      if (data) {
        setFullName(data.full_name ?? '');
        setNickname(data.nickname ?? '');
        setBio(data.bio ?? '');
        setAvatarUrl(data.avatar_url ?? null);
      }
    } catch (e) {
      console.error('[ProfileScreen] fetchProfile:', e);
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { fetchProfile(); }, [fetchProfile]));

  // ── Avatar upload ─────────────────────────────────────────────────────────────
  // Pick a square image, upload it to the public `avatar` bucket, and keep the
  // returned public URL. Mirrors the exercise-video upload flow (blob → upload →
  // getPublicUrl). Persisted to the profile row on Save.
  async function handlePickAvatar() {
    setErrorMsg(''); setSavedMsg(false);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setErrorMsg('Media library permission is required to upload a photo.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in.');

      const response = await fetch(asset.uri);
      const blob = await response.blob();

      const ext = (asset.uri.split('.').pop() ?? 'jpg').toLowerCase().split('?')[0];
      const path = `${user.id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatar')
        .upload(path, blob, { contentType: blob.type || `image/${ext}`, upsert: true });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('avatar').getPublicUrl(path);
      setAvatarUrl(publicUrl);
    } catch (e) {
      setErrorMsg(e.message ?? 'Photo upload failed.');
    }
    setUploading(false);
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  async function handleSave() {
    setErrorMsg(''); setSavedMsg(false);
    if (!fullName.trim()) { setErrorMsg('Please enter your name.'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in.');
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name:  fullName.trim(),
          nickname:   nickname.trim() || null,
          bio:        bio.trim() || null,
          avatar_url: avatarUrl || null,
        })
        .eq('id', user.id);
      if (error) throw error;
      setSavedMsg(true);
    } catch (e) {
      setErrorMsg(e.message ?? 'Failed to save. Please try again.');
    }
    setSaving(false);
  }

  const initial = (nickname.trim() || fullName.trim() || '?').charAt(0).toUpperCase();

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={C.iceGlow} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.body}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.kicker}>◆  PLAYER PROFILE  ◆</Text>
      </View>

      {/* ── Avatar (circular, with the rotating shimmer ring) ── */}
      <View style={styles.avatarWrap}>
        <TouchableOpacity activeOpacity={0.85} onPress={handlePickAvatar} disabled={uploading}>
          <View style={styles.avatarOuter}>
            <View style={styles.avatarBox}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
              ) : (
                <View style={[styles.avatarImg, styles.avatarPlaceholder]}>
                  <Text style={styles.avatarInitial}>{initial}</Text>
                </View>
              )}

              {uploading && (
                <View style={styles.avatarOverlay}>
                  <ActivityIndicator color={C.iceGlow} />
                </View>
              )}
            </View>

            {/* Live animated ice-blue ring sweeping around the photo. */}
            <ShimmerRing size={AVATAR} thickness={6} colors={BLUE} active />
          </View>
        </TouchableOpacity>

        <TouchableOpacity onPress={handlePickAvatar} disabled={uploading} style={styles.changeBtn}>
          <Text style={styles.changeBtnText}>
            {uploading ? 'UPLOADING…' : avatarUrl ? '↺  CHANGE PHOTO' : '▲  UPLOAD PHOTO'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Live preview of identity ── */}
      <View style={styles.identity}>
        <Text style={styles.identityName}>{(fullName.trim() || '—').toUpperCase()}</Text>
        {!!nickname.trim() && <Text style={styles.identityNick}>“{nickname.trim()}”</Text>}
      </View>

      {/* ── Form (inside the cool ice-glow frame) ── */}
      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <View style={styles.panelHeaderBar} />
          <Text style={styles.panelHeaderText}>DETAILS</Text>
        </View>
        <View style={styles.panelDivider} />

        <Text style={[styles.label, styles.labelFirst]}>NAME</Text>
        <TextInput
          style={styles.input}
          placeholder="Your full name"
          placeholderTextColor={C.textMuted}
          value={fullName}
          onChangeText={setFullName}
        />

        <Text style={styles.label}>NICKNAME</Text>
        <TextInput
          style={styles.input}
          placeholder="Your handle"
          placeholderTextColor={C.textMuted}
          value={nickname}
          onChangeText={setNickname}
        />

        <View style={styles.labelRow}>
          <Text style={styles.label}>ONE SENTENCE</Text>
          <Text style={styles.counter}>{bio.length}/{BIO_MAX}</Text>
        </View>
        <TextInput
          style={[styles.input, styles.multiline]}
          placeholder="A line that sums you up…"
          placeholderTextColor={C.textMuted}
          value={bio}
          onChangeText={setBio}
          maxLength={BIO_MAX}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />
      </View>

      {!!errorMsg && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>⚠ {errorMsg}</Text>
        </View>
      )}
      {savedMsg && (
        <View style={styles.savedBox}>
          <Text style={styles.savedText}>✓ Profile saved</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
        onPress={handleSave}
        disabled={saving}
        activeOpacity={0.85}
      >
        {saving
          ? <ActivityIndicator color={C.bg} />
          : <Text style={styles.saveBtnText}>SAVE PROFILE</Text>}
      </TouchableOpacity>

      <View style={{ height: 80 }} />
    </ScrollView>
  );
}

const AVATAR = 220;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { justifyContent: 'center', alignItems: 'center' },
  body: {
    paddingHorizontal: 20,
    paddingTop: 110,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },

  header: { alignItems: 'center', marginBottom: 26 },
  kicker: {
    fontFamily: F.bodyMed, fontSize: 28, color: C.textMuted, letterSpacing: 9,
  },

  // ── Avatar ──
  avatarWrap: { alignItems: 'center', gap: 16 },
  // Outer wrapper carries the ice-glow halo and holds the ring overlay (no
  // overflow clip here so the glow + ring aren't cut off). It's circular
  // (borderRadius) so the glow halo is round, not a square box.
  avatarOuter: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.iceGlow,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 18,
  },
  avatarBox: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: C.surface,
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%', borderRadius: AVATAR / 2 },
  avatarPlaceholder: { justifyContent: 'center', alignItems: 'center', backgroundColor: C.lockedBg },
  avatarInitial: {
    fontFamily: F.heading, fontSize: 104, color: C.iceGlow, letterSpacing: 2,
    textShadowColor: 'rgba(74,158,191,0.55)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20,
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5,9,18,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: AVATAR / 2,
  },
  changeBtn: {
    paddingHorizontal: 26, paddingVertical: 13,
    borderRadius: 28, borderWidth: 1.5, borderColor: C.iceGlow,
    backgroundColor: 'rgba(74,158,191,0.10)',
  },
  changeBtnText: {
    fontFamily: F.heading, fontSize: 16, color: C.iceGlow, letterSpacing: 3,
  },

  // ── Identity preview ──
  identity: { alignItems: 'center', marginTop: 26, marginBottom: 8, gap: 8 },
  identityName: {
    fontFamily: F.heading, fontSize: 58, color: C.iceGlow, letterSpacing: 4, textAlign: 'center',
    textShadowColor: 'rgba(74,158,191,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 18,
  },
  identityNick: {
    fontFamily: F.bodyMed, fontSize: 24, color: C.text, letterSpacing: 1, opacity: 0.8,
  },

  // ── Form panel (the "cool frame": bordered, ice-glow card like HomeScreen) ──
  panel: {
    marginTop: 26,
    backgroundColor: C.surface,
    borderWidth: 1.5,
    borderColor: C.lockedBorder,
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 26,
    shadowColor: C.iceGlow,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
  },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
  panelHeaderBar: {
    width: 5, height: 28, borderRadius: 2, backgroundColor: C.iceGlow,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 6,
  },
  panelHeaderText: { fontFamily: F.heading, fontSize: 26, color: C.iceGlow, letterSpacing: 3 },
  panelDivider: { height: 1, backgroundColor: C.lockedBorder, opacity: 0.6, marginBottom: 4 },

  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  label: {
    fontFamily: F.bodyMed, fontSize: 15, color: C.text,
    letterSpacing: 2, textTransform: 'uppercase', marginTop: 24, marginBottom: 9,
  },
  labelFirst: { marginTop: 18 },
  counter: { fontFamily: F.bodyMed, fontSize: 14, color: C.textMuted, letterSpacing: 1, marginBottom: 9 },
  input: {
    backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.cardBorder, borderRadius: 8,
    paddingHorizontal: 18, paddingVertical: 16, fontFamily: F.body, fontSize: 18, color: C.text,
  },
  multiline: { minHeight: 110, paddingTop: 16, lineHeight: 26 },

  errorBox: {
    marginTop: 20, backgroundColor: 'rgba(255,60,60,0.12)',
    borderWidth: 1.5, borderColor: '#FF4444', borderRadius: 6, padding: 14,
  },
  errorText: { fontFamily: F.bodyMed, fontSize: 14, color: '#FF6B6B', letterSpacing: 0.5, lineHeight: 20 },
  savedBox: {
    marginTop: 20, backgroundColor: 'rgba(74,158,191,0.12)',
    borderWidth: 1.5, borderColor: C.iceGlow, borderRadius: 6, padding: 14,
  },
  savedText: { fontFamily: F.bodyMed, fontSize: 14, color: C.iceGlow, letterSpacing: 0.5 },

  saveBtn: {
    marginTop: 32, height: 66, backgroundColor: C.iceGlow,
    borderRadius: 8, justifyContent: 'center', alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: {
    fontFamily: F.heading, fontSize: 18, color: C.bg, letterSpacing: 4, textTransform: 'uppercase',
  },
});
