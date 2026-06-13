import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { supabase } from '../lib/supabase';
import { ShimmerFrame, ShimmerText, BORDEAUX, GOLD } from '../components/Shimmer';

// Wine accent set for this screen — sourced from the shared BORDEAUX palette so
// the static colors match the animated frames (deep wine → crimson → bright rose).
const WINE = {
  deep:  BORDEAUX[0],  // #2E0512
  dark:  BORDEAUX[1],  // #6A0F2A
  blood: BORDEAUX[2],  // #A31034
  vivid: BORDEAUX[3],  // #E11D48
  rose:  BORDEAUX[4],  // #FF5C8A
  wine:  BORDEAUX[5],  // #8B1538
};

// Slow, calm color drift. All shimmer shares ONE clock whose speed is set by the
// first instance to mount, so every shimmer on this screen uses the same value.
const SHIMMER_MS = 4200;

// Brighter bordeaux ramp for the live shimmer — drops the near-black end of the
// shared BORDEAUX palette so the sweep stays vivid (crimson → rose) instead of
// dimming to almost black at points.
const WINE_SHIMMER = ['#8B1538', '#A31034', '#C81E45', '#E11D48', '#FF5C8A'];

export default function ChallengesScreen({ navigation }) {
  const [challenges, setChallenges] = useState([]);
  const [isAdmin,    setIsAdmin]    = useState(false);
  const [loading,    setLoading]    = useState(true);

  // Admin create form
  const [composing, setComposing] = useState(false);
  const [title,     setTitle]     = useState('');
  const [desc,      setDesc]      = useState('');
  const [reward,    setReward]    = useState('');
  const [saving,    setSaving]    = useState(false);
  const [errorMsg,  setErrorMsg]  = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const [roleRes, chRes] = await Promise.all([
        user
          ? supabase.from('profiles').select('role').eq('id', user.id).single()
          : Promise.resolve({ data: null }),
        supabase
          .from('challenges')
          .select('id, title, description, reward, created_at')
          .eq('active', true)
          .order('created_at', { ascending: false }),
      ]);
      setIsAdmin(roleRes.data?.role === 'admin');
      setChallenges(chRes.data ?? []);
    } catch (e) {
      console.error('[ChallengesScreen] fetchData:', e);
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  function resetForm() {
    setTitle(''); setDesc(''); setReward(''); setErrorMsg(''); setComposing(false);
  }

  async function handleCreate() {
    setErrorMsg('');
    if (!title.trim()) { setErrorMsg('Give the challenge a title.'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('challenges').insert({
        title:       title.trim(),
        description: desc.trim() || null,
        reward:      reward.trim() || null,
        created_by:  user?.id ?? null,
      });
      if (error) throw error;
      resetForm();
      await fetchData();
    } catch (e) {
      setErrorMsg(e.message ?? 'Failed to post challenge.');
    }
    setSaving(false);
  }

  async function handleDelete(id) {
    // Optimistic removal; admins only (RLS enforces it server-side too).
    const prev = challenges;
    setChallenges(prev.filter(c => c.id !== id));
    const { error } = await supabase.from('challenges').delete().eq('id', id);
    if (error) { console.error('[ChallengesScreen] delete:', error); setChallenges(prev); }
  }

  const canBack = navigation?.canGoBack?.() ?? false;

  return (
    <View style={styles.screen}>
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.framedBody}>
        {/* The cool animated wine frame wraps the whole content block. */}
        <ShimmerFrame style={styles.bodyFrame} colors={WINE_SHIMMER} radius={18} thickness={4} duration={SHIMMER_MS} active />

      {/* ── Header ── */}
      <View style={styles.header}>
        {isAdmin && canBack && (
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>← BACK</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.kicker}>◆  THE ARENA  ◆</Text>
        <ShimmerText text="CHALLENGES" style={styles.title} colors={WINE_SHIMMER} direction="ltr" duration={SHIMMER_MS} active />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={WINE.vivid} style={{ marginTop: 80 }} />
      ) : (
        <>
          {/* ── Admin: compose ── */}
          {isAdmin && (
            !composing ? (
              <TouchableOpacity style={styles.newBtn} activeOpacity={0.85} onPress={() => setComposing(true)}>
                <Text style={styles.newBtnText}>＋  NEW CHALLENGE</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.composer}>
                <View style={styles.composerHeader}>
                  <View style={styles.composerBar} />
                  <Text style={styles.composerTitle}>NEW CHALLENGE</Text>
                </View>

                <Text style={styles.label}>TITLE</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 100 Push-Ups Gauntlet"
                  placeholderTextColor={C.textMuted}
                  value={title}
                  onChangeText={setTitle}
                />

                <Text style={styles.label}>DESCRIPTION</Text>
                <TextInput
                  style={[styles.input, styles.multiline]}
                  placeholder="What must the player do to conquer it?"
                  placeholderTextColor={C.textMuted}
                  value={desc}
                  onChangeText={setDesc}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />

                <Text style={styles.label}>REWARD <Text style={styles.optional}>(optional)</Text></Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Champion's Badge"
                  placeholderTextColor={C.textMuted}
                  value={reward}
                  onChangeText={setReward}
                />

                {!!errorMsg && <Text style={styles.errorText}>⚠ {errorMsg}</Text>}

                <View style={styles.composerActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={resetForm} disabled={saving}>
                    <Text style={styles.cancelText}>CANCEL</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.postBtn, saving && { opacity: 0.5 }]}
                    onPress={handleCreate}
                    disabled={saving}
                    activeOpacity={0.85}
                  >
                    {saving ? <ActivityIndicator color={C.bg} /> : <Text style={styles.postText}>POST</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )
          )}

          {/* ── List / empty state ── */}
          {challenges.length === 0 ? (
            <View style={styles.emptyBox}>
              <ShimmerFrame style={styles.emptyFrame} colors={WINE_SHIMMER} radius={14} thickness={3} duration={SHIMMER_MS} active />
              <Text style={styles.emptyIcon}>⚔</Text>
              <Text style={styles.emptyText}>NO CHALLENGES{'\n'}AVAILABLE RIGHT NOW</Text>
              <Text style={styles.emptySub}>Check back soon — the arena awaits.</Text>
            </View>
          ) : (
            challenges.map(ch => (
              <View key={ch.id} style={styles.card}>
                {/* The cool animated ice frame around each challenge. */}
                <ShimmerFrame style={styles.cardFrame} colors={WINE_SHIMMER} radius={14} thickness={3.5} duration={SHIMMER_MS} active />

                <View style={styles.cardTop}>
                  <Text style={styles.cardKicker}>⚔  CHALLENGE</Text>
                  {isAdmin && (
                    <TouchableOpacity onPress={() => handleDelete(ch.id)} style={styles.deleteBtn} hitSlop={10}>
                      <Text style={styles.deleteText}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <Text style={styles.cardTitle}>{ch.title}</Text>
                {!!ch.description && <Text style={styles.cardDesc}>{ch.description}</Text>}

                {!!ch.reward && (
                  <View style={styles.rewardBadge}>
                    <Text style={styles.rewardText}>🏆  {ch.reward}</Text>
                  </View>
                )}
              </View>
            ))
          )}
        </>
      )}

      </View>
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  container: { flex: 1, backgroundColor: C.bg },
  // Outer scroll padding; centers the framed content block.
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: 28, paddingHorizontal: 16, alignItems: 'center' },
  // The cool wine frame wraps THIS — header + all content sit inside one frame
  // that hugs the content (like the Skills outer frame / Home panels).
  framedBody: {
    width: '100%',
    maxWidth: 720,
    borderRadius: 18,
    paddingHorizontal: 24,
    paddingTop: 44,
    paddingBottom: 44,
    backgroundColor: C.bg,
    shadowColor: WINE.vivid,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
  },
  bodyFrame: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
    shadowColor: WINE.vivid, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 14,
  },

  // ── Header ──
  header: { alignItems: 'center', marginBottom: 26 },
  // Glowing wine pill (the bordeaux counterpart of the ice nav pills).
  backBtn: {
    alignSelf: 'flex-start', marginBottom: 16,
    paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 24, borderWidth: 1.5, borderColor: WINE.vivid,
    backgroundColor: 'rgba(225,29,72,0.10)',
    shadowColor: WINE.vivid, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 10,
  },
  backText: { fontFamily: F.heading, color: WINE.rose, fontSize: 16, letterSpacing: 2 },
  kicker: { fontFamily: F.bodyMed, fontSize: 22, color: WINE.wine, letterSpacing: 9, marginBottom: 10 },
  title: {
    fontFamily: F.heading, fontSize: 64, color: WINE.vivid, letterSpacing: 6, textAlign: 'center',
    textShadowColor: 'rgba(225,29,72,0.55)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 22,
  },

  // ── Admin: new button + composer ──
  newBtn: {
    height: 64, borderRadius: 12, borderWidth: 1.5, borderColor: WINE.vivid, borderStyle: 'dashed',
    justifyContent: 'center', alignItems: 'center', marginBottom: 24,
    backgroundColor: 'rgba(225,29,72,0.10)',
    shadowColor: WINE.vivid, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.35, shadowRadius: 12,
  },
  newBtnText: { fontFamily: F.heading, fontSize: 18, color: WINE.rose, letterSpacing: 3 },

  composer: {
    backgroundColor: C.surface, borderWidth: 1.5, borderColor: WINE.dark, borderRadius: 14,
    padding: 22, marginBottom: 26,
    shadowColor: WINE.vivid, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.22, shadowRadius: 16,
  },
  composerHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 8 },
  composerBar: {
    width: 5, height: 28, borderRadius: 2, backgroundColor: WINE.vivid,
    shadowColor: WINE.vivid, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 6,
  },
  composerTitle: { fontFamily: F.heading, fontSize: 24, color: WINE.rose, letterSpacing: 3 },
  label: {
    fontFamily: F.bodyMed, fontSize: 14, color: C.text,
    letterSpacing: 2, textTransform: 'uppercase', marginTop: 20, marginBottom: 8,
  },
  optional: { fontFamily: F.body, fontSize: 12, color: C.textMuted, textTransform: 'none', letterSpacing: 0.5 },
  input: {
    backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.cardBorder, borderRadius: 8,
    paddingHorizontal: 18, paddingVertical: 15, fontFamily: F.body, fontSize: 17, color: C.text,
  },
  multiline: { minHeight: 96, paddingTop: 15, lineHeight: 24 },
  errorText: { fontFamily: F.bodyMed, fontSize: 14, color: '#FF6B6B', letterSpacing: 0.5, marginTop: 14 },
  composerActions: { flexDirection: 'row', gap: 14, marginTop: 24 },
  cancelBtn: {
    flex: 1, height: 56, borderRadius: 8, borderWidth: 1.5, borderColor: C.lockedBorder,
    justifyContent: 'center', alignItems: 'center',
  },
  cancelText: { fontFamily: F.heading, fontSize: 16, color: C.textMuted, letterSpacing: 2 },
  postBtn: {
    flex: 2, height: 56, borderRadius: 8, backgroundColor: WINE.vivid,
    justifyContent: 'center', alignItems: 'center',
  },
  postText: { fontFamily: F.heading, fontSize: 16, color: C.text, letterSpacing: 4 },

  // ── Empty state ──
  emptyBox: {
    backgroundColor: C.surface, borderRadius: 14, paddingVertical: 56, paddingHorizontal: 24,
    alignItems: 'center', gap: 12, overflow: 'hidden',
  },
  emptyFrame: {
    ...StyleSheet.absoluteFillObject, borderRadius: 14,
    shadowColor: WINE.vivid, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.65, shadowRadius: 12,
  },
  emptyIcon: { fontSize: 52, color: WINE.rose, opacity: 0.9, marginBottom: 4 },
  emptyText: {
    fontFamily: F.heading, fontSize: 26, color: C.text, letterSpacing: 3, textAlign: 'center', lineHeight: 34,
  },
  emptySub: { fontFamily: F.bodyMed, fontSize: 15, color: C.textMuted, letterSpacing: 1, textAlign: 'center' },

  // ── Challenge card (cool animated frame) ──
  card: {
    backgroundColor: C.surface, borderRadius: 14, padding: 24, marginBottom: 18,
    borderColor: 'transparent', overflow: 'hidden',
    shadowColor: WINE.vivid, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.2, shadowRadius: 14,
  },
  cardFrame: {
    ...StyleSheet.absoluteFillObject, borderRadius: 14,
    shadowColor: WINE.vivid, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  cardKicker: { fontFamily: F.heading, fontSize: 14, color: WINE.rose, letterSpacing: 4 },
  deleteBtn: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: '#FF4444',
    justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,68,68,0.10)',
  },
  deleteText: { fontFamily: F.heading, fontSize: 17, color: '#FF6B6B', lineHeight: 19 },
  cardTitle: {
    fontFamily: F.heading, fontSize: 34, color: C.text, letterSpacing: 1.5, marginBottom: 10,
    textShadowColor: 'rgba(225,29,72,0.35)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
  },
  cardDesc: { fontFamily: F.bodyMed, fontSize: 18, color: C.text, opacity: 0.85, lineHeight: 27 },
  rewardBadge: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: 18,
    paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999,
    borderWidth: 1.5, borderColor: GOLD[2], backgroundColor: 'rgba(255,215,0,0.10)',
    shadowColor: GOLD[2], shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 10,
  },
  rewardText: { fontFamily: F.heading, fontSize: 17, color: GOLD[2], letterSpacing: 1.5 },
});
