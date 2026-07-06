import { useCallback, useState, useRef, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Image, ActivityIndicator, Animated, Easing, AccessibilityInfo,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { supabase } from '../lib/supabase';
import { ShimmerRing, ShimmerText, BLUE } from '../components/Shimmer';
import ScreenFrame from '../components/ScreenFrame';

const BIO_MAX = 120;
const AVATAR = 220;

// Respect the system "reduce motion" setting. Guarded `?.()` call — on Expo web
// AccessibilityInfo.isReduceMotionEnabled can be undefined (see CLAUDE web RN
// gotchas), which would otherwise crash the screen to black.
function useReduceMotion() {
  const [rm, setRm] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then(v => { if (alive) setRm(!!v); });
    return () => { alive = false; };
  }, []);
  return rm;
}

// ── Breathing halo ──────────────────────────────────────────────────────────
// A soft ice-glow disc behind the avatar that slowly inhales/exhales (opacity +
// scale), so the portrait feels lit from within rather than static. Native
// driver only; torn down on unmount.
function BreathingHalo({ active, size }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    const p = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 2100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 2100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    p.start();
    return () => p.stop();
  }, [active, pulse]);

  const opacity = active ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.85] }) : 0.55;
  const scale   = active ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.09] }) : 1;
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.halo, { width: size, height: size, borderRadius: size / 2, opacity, transform: [{ scale }] }]}
    />
  );
}

// ── Glow input ──────────────────────────────────────────────────────────────
// A text field whose ice-glow border blooms in on focus (animated overlay
// opacity, native driver — no layout shift, no border-color tween which can't
// run on the native driver).
function GlowInput({ label, counter, counterColor, multiline, ...props }) {
  const [focused, setFocused] = useState(false);
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(glow, {
      toValue: focused ? 1 : 0, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true,
    }).start();
  }, [focused, glow]);

  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {counter != null && (
          <Text style={[styles.counter, counterColor && { color: counterColor }]}>{counter}</Text>
        )}
      </View>
      <View>
        <TextInput
          style={[styles.input, multiline && styles.multiline]}
          placeholderTextColor={C.textMuted}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          multiline={multiline}
          {...props}
        />
        <Animated.View
          pointerEvents="none"
          style={[styles.inputGlow, { opacity: glow }]}
        />
      </View>
    </View>
  );
}

// ── Save button ─────────────────────────────────────────────────────────────
// The solid ice CTA with a diagonal light streak that keeps sweeping across it,
// so the primary action reads as energized. Press feedback scales it down a
// touch. Streak is a native-driver translate loop.
function SaveButton({ onPress, saving, animate }) {
  const sweep = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);

  useEffect(() => {
    if (!animate) return;
    const s = Animated.loop(Animated.timing(sweep, {
      toValue: 1, duration: 2600, easing: Easing.linear, useNativeDriver: true,
    }));
    s.start();
    return () => s.stop();
  }, [animate, sweep]);

  const streakX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-140, (w || 320) + 140] });
  const scale   = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] });

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
        onPress={onPress}
        disabled={saving}
        activeOpacity={1}
        onPressIn={() => Animated.timing(press, { toValue: 1, duration: 90, useNativeDriver: true }).start()}
        onPressOut={() => Animated.timing(press, { toValue: 0, duration: 140, useNativeDriver: true }).start()}
        onLayout={e => setW(e.nativeEvent.layout.width)}
      >
        {animate && !saving && (
          <Animated.View
            pointerEvents="none"
            style={[styles.saveStreak, { transform: [{ translateX: streakX }, { rotate: '18deg' }] }]}
          />
        )}
        {saving
          ? <ActivityIndicator color={C.bg} />
          : <Text style={styles.saveBtnText}>SAVE PROFILE</Text>}
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function ProfileScreen() {
  const reduceMotion = useReduceMotion();
  const animate = !reduceMotion;

  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [uploading, setUploading] = useState(false);

  const [fullName,  setFullName]  = useState('');
  const [nickname,  setNickname]  = useState('');
  const [bio,       setBio]       = useState('');
  const [avatarUrl, setAvatarUrl] = useState(null);

  const [errorMsg,  setErrorMsg]  = useState('');
  const [savedMsg,  setSavedMsg]  = useState(false);

  // ── Entrance removed ──
  // The staggered intro was retired when tab swiping landed: this page is visible
  // mid-drag (before focus fires), so the blocks must sit settled at all times.
  // The Animated.Values stay (at rest, 1) because the layout binds to them via
  // riseStyle/popStyle below.
  const aAvatar = useRef(new Animated.Value(1)).current;
  const aIdent  = useRef(new Animated.Value(1)).current;
  const aPanel  = useRef(new Animated.Value(1)).current;
  const aSave   = useRef(new Animated.Value(1)).current;

  // Fade + rise as each block enters.
  const riseStyle = (a, dist = 26) => ({
    opacity: a,
    transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [dist, 0] }) }],
  });
  // Avatar gets a scale-pop instead of a slide.
  const popStyle = (a) => ({
    opacity: a,
    transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
  });

  // ── Load own profile ──
  // First load shows the spinner; later focus refetches run silently (the data is
  // already on screen — the tab is pre-mounted at app start, see App.js lazy:false).
  const loadedRef = useRef(false);
  const fetchProfile = useCallback(async () => {
    if (!loadedRef.current) setLoading(true);
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
    loadedRef.current = true;
    setLoading(false);
  }, []);

  // Mount fetch = preload at app start (tab is rendered before it's ever focused);
  // focus fetch = silent refresh on each visit.
  useEffect(() => { fetchProfile(); }, [fetchProfile]);
  useFocusEffect(useCallback(() => { if (loadedRef.current) fetchProfile(); }, [fetchProfile]));

  // ── Avatar upload ──
  // Pick a square image, upload it to the public `avatar` bucket, keep the
  // returned public URL. Persisted to the profile row on Save.
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

  // ── Save ──
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

  // Counter color warms up as the one-liner fills (muted → accent → gold).
  const bioPct = bio.length / BIO_MAX;
  const counterColor = bioPct >= 1 ? '#FFD700' : bioPct >= 0.85 ? C.iceGlow : C.textMuted;

  return (
    <ScreenFrame maxWidth={560} ready={!loading}>
      <View style={styles.body}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.kicker}>◆  PLAYER PROFILE  ◆</Text>
        </View>

        {/* ── Avatar (breathing halo + rotating shimmer ring) ── */}
        <Animated.View style={[styles.avatarWrap, popStyle(aAvatar)]}>
          <TouchableOpacity activeOpacity={0.85} onPress={handlePickAvatar} disabled={uploading}>
            <View style={styles.avatarOuter}>
              <BreathingHalo active={animate} size={AVATAR + 24} />
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
              <ShimmerRing size={AVATAR} thickness={6} colors={BLUE} active={animate} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity onPress={handlePickAvatar} disabled={uploading} style={styles.changeBtn} activeOpacity={0.85}>
            <Text style={styles.changeBtnText}>
              {uploading ? 'UPLOADING…' : avatarUrl ? '↺  CHANGE PHOTO' : '▲  UPLOAD PHOTO'}
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {/* ── Identity (shimmering name + flourished nickname) ── */}
        <Animated.View style={[styles.identity, riseStyle(aIdent)]}>
          <ShimmerText
            text={(fullName.trim() || '—').toUpperCase()}
            style={styles.identityName}
            colors={BLUE}
            sweep={animate}
            active={animate}
          />
          {!!nickname.trim() && (
            <View style={styles.nickRow}>
              <View style={styles.nickLine} />
              <View style={styles.nickDiamond} />
              <Text style={styles.identityNick} numberOfLines={1}>“{nickname.trim()}”</Text>
              <View style={styles.nickDiamond} />
              <View style={styles.nickLine} />
            </View>
          )}
        </Animated.View>

        {/* ── Form (ice-glow panel) ── */}
        <Animated.View style={[styles.panel, riseStyle(aPanel)]}>
          <View style={styles.panelHeader}>
            <View style={styles.panelHeaderBar} />
            <Text style={styles.panelHeaderText}>DETAILS</Text>
          </View>
          <View style={styles.panelDivider} />

          <GlowInput
            label="NAME"
            placeholder="Your full name"
            value={fullName}
            onChangeText={setFullName}
          />

          <GlowInput
            label="NICKNAME"
            placeholder="Your handle"
            value={nickname}
            onChangeText={setNickname}
          />

          <GlowInput
            label="ONE SENTENCE"
            counter={`${bio.length}/${BIO_MAX}`}
            counterColor={counterColor}
            placeholder="A line that sums you up…"
            value={bio}
            onChangeText={setBio}
            maxLength={BIO_MAX}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </Animated.View>

        {!!errorMsg && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠ {errorMsg}</Text>
          </View>
        )}
        {savedMsg && (
          <View style={styles.savedBox}>
            <ShimmerText text="✓  PROFILE SAVED" style={styles.savedText} colors={BLUE} sweep={false} active={animate} />
          </View>
        )}

        <Animated.View style={riseStyle(aSave)}>
          <SaveButton onPress={handleSave} saving={saving} animate={animate} />
        </Animated.View>

      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  // Content inside the ScreenFrame (the frame supplies the glowing animated border
  // + holo-build entrance). The card hugs its content and scrolls inside the frame.
  body: {
    width: '100%',
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 30,
  },

  header: { alignItems: 'center', marginBottom: 22 },
  kicker: {
    fontFamily: F.bodyMed, fontSize: 24, color: C.textMuted, letterSpacing: 8, textAlign: 'center',
  },

  // ── Avatar ──
  avatarWrap: { alignItems: 'center', gap: 18 },
  avatarOuter: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Soft ice disc behind the portrait (the breathing glow lives here).
  halo: {
    position: 'absolute',
    backgroundColor: 'rgba(74,158,191,0.10)',
    shadowColor: C.iceGlow,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 30,
    elevation: 10,
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
    borderRadius: 999, borderWidth: 1.5, borderColor: C.iceGlow,
    backgroundColor: 'rgba(74,158,191,0.10)',
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 10,
  },
  changeBtnText: {
    fontFamily: F.heading, fontSize: 16, color: C.iceGlow, letterSpacing: 3,
  },

  // ── Identity preview ──
  identity: { alignItems: 'center', marginTop: 26, marginBottom: 8, gap: 14 },
  identityName: {
    fontFamily: F.heading, fontSize: 54, color: C.iceGlow, letterSpacing: 4, textAlign: 'center',
    textShadowColor: 'rgba(74,158,191,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 18,
  },
  // line — diamond — "nickname" — diamond — line flourish.
  nickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: '100%' },
  nickLine: {
    width: 26, height: 2, borderRadius: 1, backgroundColor: C.iceGlow, opacity: 0.5,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 5,
  },
  nickDiamond: {
    width: 7, height: 7, backgroundColor: C.iceGlow, transform: [{ rotate: '45deg' }],
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 6,
  },
  identityNick: {
    fontFamily: F.bodyMed, fontSize: 22, color: C.text, letterSpacing: 1, opacity: 0.85, flexShrink: 1,
  },

  // ── Form panel ──
  panel: {
    marginTop: 26,
    backgroundColor: C.surface,
    borderWidth: 1.5,
    borderColor: C.lockedBorder,
    borderRadius: 16,
    paddingHorizontal: 22,
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

  field: { marginTop: 18 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  label: {
    fontFamily: F.bodyMed, fontSize: 15, color: C.text,
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: 9,
  },
  counter: { fontFamily: F.bodyMed, fontSize: 14, color: C.textMuted, letterSpacing: 1, marginBottom: 9 },
  input: {
    backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.cardBorder, borderRadius: 10,
    paddingHorizontal: 18, paddingVertical: 16, fontFamily: F.body, fontSize: 18, color: C.text,
  },
  multiline: { minHeight: 110, paddingTop: 16, lineHeight: 26 },
  // Glowing border overlay that fades in while the field is focused.
  inputGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: C.iceGlow,
    shadowColor: C.iceGlow,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 12,
  },

  errorBox: {
    marginTop: 20, backgroundColor: 'rgba(255,60,60,0.12)',
    borderWidth: 1.5, borderColor: '#FF4444', borderRadius: 8, padding: 14,
  },
  errorText: { fontFamily: F.bodyMed, fontSize: 14, color: '#FF6B6B', letterSpacing: 0.5, lineHeight: 20 },
  savedBox: {
    marginTop: 20, backgroundColor: 'rgba(74,158,191,0.12)',
    borderWidth: 1.5, borderColor: C.iceGlow, borderRadius: 8, padding: 14, alignItems: 'center',
  },
  savedText: { fontFamily: F.heading, fontSize: 15, color: C.iceGlow, letterSpacing: 2 },

  // ── Save CTA ──
  saveBtn: {
    marginTop: 32, height: 66, backgroundColor: C.iceGlow,
    borderRadius: 12, justifyContent: 'center', alignItems: 'center',
    overflow: 'hidden',
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 16,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: {
    fontFamily: F.heading, fontSize: 18, color: C.bg, letterSpacing: 4, textTransform: 'uppercase',
  },
  // Diagonal light streak that keeps sweeping across the CTA.
  saveStreak: {
    position: 'absolute',
    top: -24, bottom: -24,
    width: 52,
    backgroundColor: 'rgba(255,255,255,0.30)',
  },
});
