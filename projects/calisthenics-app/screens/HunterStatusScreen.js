import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Image, StyleSheet, ScrollView, Pressable, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { supabase } from '../lib/supabase';
import ScreenFrame from '../components/ScreenFrame';
import PillButton from '../components/PillButton';
import VideoPlayer from '../components/VideoPlayer';
import {
  fetchHunterProfile, uploadAvatar, uploadSignatureVideo, removeSignatureVideo,
} from '../lib/profile';

// Player Card accent — a bright, near-white icy blue. Really icy, so the card
// reads as the identity anchor.
const ACCENT = '#CDF3FF';
const GOLD   = '#FFD700';

// Signature-clip frame — the padded, glowing matte the video sits inside.
const SIG_FRAME_PAD = 10;
const SIG_FRAME_BORDER = 1.5;

// Initials fallback when a player has no portrait — first letter of up to two
// name words (e.g. "Gal Ben Hamo" → "GB").
function initialsOf(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

// Prestige count → roman numeral (counts are small; a lookup covers it).
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const roman = (n) => ROMAN[n] ?? String(n);

// Largest {w,h} of a given aspect ratio that fits inside a box — so the signature
// clip is sized to ITS real shape (no letterbox bars, no giant dark box).
function fitWithin(boxW, boxH, ratio) {
  let w = boxW;
  let h = w / ratio;
  if (h > boxH) { h = boxH; w = h * ratio; }
  return { w, h };
}

// ─── Player Card — a player's profile ───────────────────────────────────────
// A two-page swipeable card (SAME interaction as ExerciseDetailScreen's info⇄video
// pager, NOT a modal): a horizontal paging ScrollView with page dots up top.
//   • PAGE 0 — IDENTITY: portrait, name, LVL · class · prestige gems (all DERIVED).
//   • PAGE 1 — SIGNATURE MOVE: the player's best clip (swipe left to reach it).
// Viewing your OWN card (userId === signed-in user) unlocks edit affordances —
// tap the portrait to change it, and the SIGNATURE page holds the ＋ ADD /
// REPLACE / REMOVE actions (so "to share your signature you swipe left, then add
// the video"). The NAME is never editable.
//
// ENTRY POINT: the PLAYER CARD panel on the PROFILE tab, which passes the signed-in
// player's own id (2026-09-04). Before that it hung off the community group roster,
// and when that layer was deleted this screen was left with no way in at all —
// hence the re-home. The read-only branch (`userId !== meId`) is kept: nothing
// reaches it today, but it is what makes the card safe to point at ANOTHER player,
// which is the whole reason a card like this exists.
export default function HunterStatusScreen({ navigation, route }) {
  const userId = route.params?.userId ?? null;
  const [meId, setMeId] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // 'avatar' | 'signature' | null
  const [errorMsg, setErrorMsg] = useState('');

  // Pager: 0 = identity (left), 1 = signature move (right). Land on identity.
  const [size, setSize] = useState(null);
  const [page, setPage] = useState(0);
  const pagerRef = useRef(null);
  // Signature clip aspect ratio (w/h). Default portrait — phone recordings are
  // vertical — then corrected from the video's real metadata on web (native's
  // WebView can't report it, so the default stands there).
  const [vidRatio, setVidRatio] = useState(9 / 16);

  const isSelf = !!userId && userId === meId;

  const load = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setMeId(user?.id ?? null);
      setData(await fetchHunterProfile(userId ?? user?.id));
    } catch (e) {
      console.error('[HunterStatusScreen] load:', e);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const onLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    setSize(prev => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  };
  const onScroll = (e) => {
    if (!size) return;
    const p = Math.round(e.nativeEvent.contentOffset.x / size.width);
    if (p !== page) setPage(p);
  };
  const goToPage = (p) => {
    if (size && pagerRef.current) pagerRef.current.scrollTo({ x: p * size.width, animated: true });
    setPage(p);
  };

  async function pickAndUpload(kind) {
    setErrorMsg('');
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setErrorMsg('Media library permission is required.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync(
      kind === 'avatar'
        ? { mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.8 }
        : { mediaTypes: ImagePicker.MediaTypeOptions.Videos, quality: 0.7 }
    );
    if (result.canceled) return;

    setBusy(kind);
    try {
      if (kind === 'avatar') {
        const url = await uploadAvatar(meId, result.assets[0]);
        setData(d => ({ ...d, avatarUrl: url }));
      } else {
        const url = await uploadSignatureVideo(meId, result.assets[0]);
        setData(d => ({ ...d, signatureVideoUrl: url }));
      }
    } catch (e) {
      setErrorMsg(e.message ?? 'Upload failed.');
    }
    setBusy(null);
  }

  async function handleRemoveSignature() {
    setBusy('signature');
    try {
      await removeSignatureVideo(meId);
      setData(d => ({ ...d, signatureVideoUrl: null }));
    } catch (e) {
      setErrorMsg(e.message ?? 'Could not remove the clip.');
    }
    setBusy(null);
  }

  const stars = data?.stars ?? 0;

  // ── Page 0 — identity ──
  const identityPage = size && data && (
    <ScrollView
      style={{ width: size.width, height: size.height }}
      contentContainerStyle={styles.identityContent}
      showsVerticalScrollIndicator={false}
    >
      <Pressable
        style={styles.portraitWrap}
        disabled={!isSelf || busy === 'avatar'}
        onPress={() => pickAndUpload('avatar')}
      >
        <View style={styles.portraitRing}>
          {data.avatarUrl ? (
            <Image source={{ uri: data.avatarUrl }} style={styles.portrait} />
          ) : (
            <View style={[styles.portrait, styles.portraitEmpty]}>
              <Text style={styles.portraitInitials}>{initialsOf(data.fullName)}</Text>
            </View>
          )}
          {busy === 'avatar' && (
            <View style={styles.portraitBusy}><ActivityIndicator color={ACCENT} /></View>
          )}
        </View>
        {isSelf && busy !== 'avatar' && (
          <Text style={styles.portraitHint}>{data.avatarUrl ? 'TAP TO CHANGE' : 'TAP TO ADD PHOTO'}</Text>
        )}
      </Pressable>

      <Text style={styles.name} numberOfLines={2}>{data.fullName?.toUpperCase() ?? '—'}</Text>

      {/* Prestige = classes overcome, shown as a gold gem medallion with the count
          as a roman numeral (echoes the Home class crest). */}
      {stars > 0 && (
        <View style={styles.prestigeCrest}>
          <View style={styles.prestigeGemWrap}>
            <View style={styles.prestigeGem} />
            <View style={styles.prestigeGemInner} />
            <Text style={styles.prestigeGemNum}>{roman(stars)}</Text>
          </View>
          <Text style={styles.prestigeKicker}>PRESTIGE</Text>
        </View>
      )}

      <View style={styles.chipRow}>
        {data.className ? (
          <View style={styles.chip}><Text style={styles.chipText}>{data.className.toUpperCase()}</Text></View>
        ) : null}
        <View style={styles.chip}><Text style={styles.chipText}>LVL {data.lvl}</Text></View>
      </View>

      {/* Swipe teaser — tells the player the signature move lives one swipe left,
          and doubles as a tap target to get there. */}
      <Pressable style={styles.swipeTeaser} onPress={() => goToPage(1)}>
        <View style={styles.swipeTeaserText}>
          <Text style={styles.swipeTeaserTitle}>SIGNATURE MOVE</Text>
          <Text style={styles.swipeTeaserSub}>
            {isSelf && !data.signatureVideoUrl
              ? 'Swipe left to add your best clip'
              : 'Swipe left to watch'}
          </Text>
        </View>
        <Text style={styles.swipeTeaserArrow}>‹</Text>
      </Pressable>
    </ScrollView>
  );

  // ── Page 1 — signature move ──
  const signaturePage = size && data && (
    <ScrollView
      style={{ width: size.width, height: size.height }}
      contentContainerStyle={styles.signatureContent}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.sigTitle}>SIGNATURE MOVE</Text>

      {data.signatureVideoUrl ? (() => {
        // Fit the clip to its real shape inside the page (leaving room for the
        // title + the self-edit buttons), so it's never a giant dark box (desktop)
        // or a letterboxed one (phone). Sized to sit INSIDE the icy frame — subtract
        // the frame's padding + border so the framed box lands at the right width.
        const reserve = (isSelf ? 200 : 110) + 2 * SIG_FRAME_PAD + 30;
        const inset = 2 * (SIG_FRAME_PAD + SIG_FRAME_BORDER);
        const { w, h } = fitWithin(size.width - 48 - inset, Math.max(220, size.height - reserve), vidRatio);
        return (
          // Framed container — the rounded/glowing border lives on this View, NOT on
          // the <video> (a rounded <video> paints black in Chromium — see VideoPlayer),
          // so the clip reads as "contained in a frame" without that bug.
          <View style={styles.videoFrame}>
            <VideoPlayer
              url={data.signatureVideoUrl}
              width={w}
              height={h}
              onRatio={setVidRatio}
            />
          </View>
        );
      })() : (
        <View style={styles.videoEmpty}>
          <Text style={styles.muted}>
            {isSelf ? 'Show off your proudest rep — add your best clip.' : 'No signature clip yet.'}
          </Text>
        </View>
      )}

      {isSelf && (
        <View style={styles.actions}>
          <PillButton
            label={
              busy === 'signature' ? 'WORKING…'
                : data.signatureVideoUrl ? 'REPLACE CLIP' : '＋  ADD SIGNATURE VIDEO'
            }
            tone="gold"
            onPress={() => pickAndUpload('signature')}
            loading={busy === 'signature'}
          />
          {data.signatureVideoUrl && busy !== 'signature' && (
            <PillButton
              label="REMOVE"
              tone="danger"
              variant="outline"
              size="sm"
              onPress={handleRemoveSignature}
            />
          )}
        </View>
      )}

      {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
    </ScrollView>
  );

  return (
    <ScreenFrame fill ready={!loading}>
      <View style={styles.card}>
        {/* Top bar: BACK · page dots · spacer (keeps the dots centered). */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.pill}>
            <Text style={styles.pillText}>← BACK</Text>
          </TouchableOpacity>

          <View style={styles.dots}>
            <TouchableOpacity onPress={() => goToPage(0)} hitSlop={8}>
              <View style={[styles.dot, page === 0 && styles.dotActive]} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => goToPage(1)} hitSlop={8}>
              <View style={[styles.dot, page === 1 && styles.dotActive]} />
            </TouchableOpacity>
          </View>

          <View style={styles.pillSpacer} />
        </View>

        <Text style={styles.title} numberOfLines={1}>PLAYER CARD</Text>

        {/* Swipeable pager — identity (left) ⇄ signature move (right). */}
        <View style={styles.pagerArea} onLayout={onLayout}>
          {loading ? (
            <View style={styles.center}><ActivityIndicator size="large" color={ACCENT} /></View>
          ) : !data ? (
            <View style={styles.center}><Text style={styles.muted}>Profile unavailable.</Text></View>
          ) : size ? (
            <ScrollView
              ref={pagerRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={onScroll}
              scrollEventThrottle={16}
              style={styles.pager}
            >
              {identityPage}
              {signaturePage}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, backgroundColor: C.bg },

  // ── Top bar (BACK · dots · spacer) ──
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
  },
  pill: {
    paddingHorizontal: 16, paddingVertical: 9,
    borderRadius: 22, borderWidth: 1.5, borderColor: ACCENT,
    backgroundColor: 'rgba(205,243,255,0.10)',
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 10,
  },
  pillText: { fontFamily: F.heading, color: ACCENT, fontSize: 14, letterSpacing: 2 },
  pillSpacer: { width: 84 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 9, height: 9, borderRadius: 999, backgroundColor: 'rgba(205,243,255,0.28)' },
  dotActive: {
    backgroundColor: ACCENT,
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 8,
  },

  title: {
    fontFamily: F.heading, fontSize: 26, color: ACCENT, letterSpacing: 6,
    textTransform: 'uppercase', textAlign: 'center', paddingBottom: 12,
    textShadowColor: 'rgba(205,243,255,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 18,
  },

  pagerArea: { flex: 1 },
  pager: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  muted: { fontFamily: F.bodyMed, fontSize: 15, color: '#5a7a9a', letterSpacing: 0.6, textAlign: 'center', lineHeight: 22 },

  // ── Page 0 — identity ──
  identityContent: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 10, paddingBottom: 30 },
  portraitWrap: { alignItems: 'center', marginTop: 4 },
  portraitRing: {
    width: 140, height: 140, borderRadius: 70,
    borderWidth: 2, borderColor: ACCENT,
    alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface,
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 20,
  },
  portrait: { width: 124, height: 124, borderRadius: 62 },
  portraitEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(205,243,255,0.10)' },
  portraitInitials: {
    fontFamily: F.heading, fontSize: 52, color: ACCENT, letterSpacing: 2,
    textShadowColor: 'rgba(205,243,255,0.6)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 14,
  },
  portraitBusy: {
    ...StyleSheet.absoluteFillObject, borderRadius: 70,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,9,18,0.55)',
  },
  portraitHint: { fontFamily: F.heading, fontSize: 12, color: '#5a7a9a', letterSpacing: 2, marginTop: 12 },
  name: {
    fontFamily: F.heading, fontSize: 40, color: '#FFFFFF', letterSpacing: 3,
    textAlign: 'center', marginTop: 20,
    textShadowColor: 'rgba(255,255,255,0.65)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 18,
  },
  // Prestige medallion — a gold gem (rotated square) holding the count as a roman
  // numeral, with a "PRESTIGE" kicker beneath. Same gem language as the Home crest.
  prestigeCrest: { alignItems: 'center', marginTop: 16 },
  prestigeGemWrap: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center' },
  prestigeGem: {
    position: 'absolute', width: 46, height: 46, borderRadius: 10,
    borderWidth: 2.5, borderColor: GOLD, backgroundColor: 'rgba(255,215,0,0.06)',
    transform: [{ rotate: '45deg' }],
    shadowColor: GOLD, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.85, shadowRadius: 18, elevation: 6,
  },
  prestigeGemInner: {
    position: 'absolute', width: 32, height: 32, borderRadius: 8,
    borderWidth: 1.5, borderColor: GOLD, opacity: 0.4, transform: [{ rotate: '45deg' }],
  },
  prestigeGemNum: {
    fontFamily: F.displayHeavy, fontSize: 22, color: GOLD, letterSpacing: 1,
    textShadowColor: 'rgba(255,215,0,0.9)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 14,
  },
  prestigeKicker: {
    fontFamily: F.displayHeavy, fontSize: 13, color: GOLD, letterSpacing: 5, marginTop: 8,
    paddingLeft: 5, opacity: 0.95,
    textShadowColor: 'rgba(255,215,0,0.6)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8,
  },
  chipRow: { flexDirection: 'row', gap: 10, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' },
  chip: {
    borderRadius: 999, borderWidth: 1, borderColor: 'rgba(205,243,255,0.45)',
    backgroundColor: 'rgba(205,243,255,0.08)', paddingHorizontal: 16, paddingVertical: 8,
  },
  chipText: { fontFamily: F.heading, fontSize: 14, color: ACCENT, letterSpacing: 1.5 },

  // Swipe teaser at the bottom of the identity page.
  swipeTeaser: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    alignSelf: 'stretch', marginTop: 34,
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(205,243,255,0.35)',
    backgroundColor: 'rgba(205,243,255,0.06)', paddingVertical: 16, paddingHorizontal: 18,
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.15, shadowRadius: 10,
  },
  swipeTeaserText: { flex: 1, gap: 4 },
  swipeTeaserTitle: { fontFamily: F.heading, fontSize: 18, color: ACCENT, letterSpacing: 2 },
  swipeTeaserSub: { fontFamily: F.bodyMed, fontSize: 13, color: '#5a7a9a', letterSpacing: 0.4 },
  swipeTeaserArrow: { fontFamily: F.heading, fontSize: 34, color: ACCENT, marginTop: -4 },

  // ── Page 1 — signature move ──
  signatureContent: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 6, paddingBottom: 30 },
  sigTitle: {
    fontFamily: F.heading, fontSize: 18, color: ACCENT, letterSpacing: 3,
    alignSelf: 'flex-start', marginBottom: 16,
  },
  // Icy frame around the signature clip — a matte inset + glowing accent border
  // so the video reads as "mounted in a frame" rather than a raw tacked-on box.
  videoFrame: {
    padding: SIG_FRAME_PAD,
    borderRadius: 18,
    borderWidth: SIG_FRAME_BORDER,
    borderColor: 'rgba(205,243,255,0.55)',
    backgroundColor: C.lockedBg,
    alignSelf: 'center',
    overflow: 'hidden',
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.35, shadowRadius: 16,
  },
  videoEmpty: {
    alignSelf: 'stretch', minHeight: 160, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(205,243,255,0.25)', borderStyle: 'dashed',
    backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24,
  },
  actions: { flexDirection: 'row', gap: 12, marginTop: 20, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' },
  error: { fontFamily: F.bodyMed, fontSize: 14, color: '#FF6B6B', letterSpacing: 0.4, textAlign: 'center', marginTop: 16, lineHeight: 20 },
});
