import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import ScreenFrame from '../components/ScreenFrame';

function getYouTubeEmbedUrl(url) {
  if (!url) return null;
  const shortsMatch = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/);
  const watchMatch  = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
  const id = shortsMatch?.[1] || watchMatch?.[1];
  return id ? `https://www.youtube.com/embed/${id}` : null;
}

// Largest {w,h} for a given ratio that fits inside a box — no letterbox bars.
function fitWithin(boxW, boxH, ratio) {
  let w = boxW;
  let h = w / ratio;
  if (h > boxH) { h = boxH; w = h * ratio; }
  return { w, h };
}

function SectionTitle({ children }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

// ─── Video renderer ───────────────────────────────────────────────────────────
// Priority: storage video (video_url) > YouTube embed (youtube_url) > placeholder

function VideoSection({ exercise, ratio, width, height, onRatio }) {
  const storageUrl = exercise.video_url;
  const embedUrl   = getYouTubeEmbedUrl(exercise.youtube_url);

  // Storage video — uploaded to Supabase
  if (storageUrl) {
    if (Platform.OS === 'web') {
      return (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          src={storageUrl}
          controls
          onLoadedMetadata={(e) => {
            const v = e.target;
            if (v.videoWidth && v.videoHeight) onRatio(v.videoWidth / v.videoHeight);
          }}
          style={{
            width,
            height,
            display: 'block',
            objectFit: 'contain',
            backgroundColor: C.lockedBg,
          }}
        />
      );
    }
    // Native: use WebView to stream (avoids needing expo-av)
    return (
      <WebView
        source={{ uri: storageUrl }}
        style={{ width, height }}
        allowsFullscreenVideo
        mediaPlaybackRequiresUserAction={false}
      />
    );
  }

  // YouTube embed
  if (embedUrl) {
    if (Platform.OS === 'web') {
      return (
        <iframe
          src={embedUrl}
          style={{ width, height, border: 'none', display: 'block' }}
          allowFullScreen
          title="exercise video"
        />
      );
    }
    return (
      <WebView
        source={{ uri: embedUrl }}
        style={{ width, height }}
        allowsFullscreenVideo
        javaScriptEnabled
      />
    );
  }

  // No video
  return (
    <View style={[styles.noVideo, { width, height }]}>
      <Text style={styles.noVideoIcon}>▶</Text>
      <Text style={styles.noVideoText}>No video added yet</Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ExerciseDetailScreen({ route, navigation }) {
  const { exercise } = route.params;
  // When opened from the workout-building exercise picker we're just previewing
  // the movement, not authoring the catalog — hide EDIT so it can't be changed there.
  const hideEdit = route.params?.hideEdit ?? false;

  // Default to 16:9 until the real video metadata loads, then snap to its ratio.
  const [ratio, setRatio] = useState(16 / 9);
  // Measured size of the pager area — each page fills exactly this.
  const [size, setSize] = useState(null);
  // 0 = info (left screen), 1 = video (right screen). Land on the video first.
  const [page, setPage] = useState(1);

  const pagerRef = useRef(null);
  const didInit = useRef(false);

  const cues = exercise.coaching_cues
    ? exercise.coaching_cues.split('\n').filter(line => line.trim().length > 0)
    : [];

  // Once we know the page width, jump to the video page (rightmost) without a
  // visible scroll animation.
  useEffect(() => {
    if (size && pagerRef.current && !didInit.current) {
      didInit.current = true;
      pagerRef.current.scrollTo({ x: size.width, animated: false });
    }
  }, [size]);

  const onLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  };

  const onScroll = (e) => {
    if (!size) return;
    const x = e.nativeEvent.contentOffset.x;
    const p = Math.round(x / size.width);
    if (p !== page) setPage(p);
  };

  const goToPage = (p) => {
    if (size && pagerRef.current) {
      pagerRef.current.scrollTo({ x: p * size.width, animated: true });
    }
    setPage(p);
  };

  // ── The two pages ──────────────────────────────────────────────────────────
  const infoPage = size && (
    <ScrollView
      style={{ width: size.width, height: size.height }}
      contentContainerStyle={styles.infoContent}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>{exercise.name}</Text>

      <View style={styles.typeBadge}>
        <Text style={styles.typeText}>{exercise.movement_type}</Text>
      </View>

      {!!exercise.description && (
        <>
          <View style={styles.divider} />
          <View style={styles.section}>
            <SectionTitle>DESCRIPTION</SectionTitle>
            <Text style={styles.bodyText}>{exercise.description}</Text>
          </View>
        </>
      )}

      {cues.length > 0 && (
        <>
          <View style={styles.divider} />
          <View style={styles.section}>
            <SectionTitle>COACHING CUES</SectionTitle>
            {cues.map((cue, i) => (
              <View key={i} style={styles.cueRow}>
                <Text style={styles.cueBullet}>▸</Text>
                <Text style={styles.cueText}>{cue.trim()}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {!!exercise.added_by_name && (
        <Text style={styles.addedBy}>Added by {exercise.added_by_name}</Text>
      )}
    </ScrollView>
  );

  const videoPage = size && (() => {
    const { w, h } = fitWithin(size.width - 24, size.height - 24, ratio);
    return (
      <View style={[styles.videoPage, { width: size.width, height: size.height }]}>
        <View style={[styles.videoWrap, { width: w, height: h }]}>
          <VideoSection
            exercise={exercise}
            ratio={ratio}
            width={w}
            height={h}
            onRatio={setRatio}
          />
        </View>
      </View>
    );
  })();

  return (
    <ScreenFrame fill maxWidth={720}>
      <View style={styles.card}>
        {/* Slim top bar: BACK · page dots · EDIT */}
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

          {hideEdit ? (
            /* Spacer keeps the page dots centered when EDIT is hidden. */
            <View style={styles.pillSpacer} />
          ) : (
            <TouchableOpacity
              onPress={() => navigation.navigate('AddExercise', { exercise })}
              style={styles.pill}
            >
              <Text style={styles.pillText}>✎ EDIT</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Swipeable pager — info (left) ⇄ video (right) */}
        <View style={styles.pagerArea} onLayout={onLayout}>
          {size && (
            <ScrollView
              ref={pagerRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={onScroll}
              scrollEventThrottle={16}
              style={styles.pager}
            >
              {infoPage}
              {videoPage}
            </ScrollView>
          )}
        </View>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, backgroundColor: C.bg },

  // ── Top bar ──
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.cardBorder,
  },
  // Glowing ice pill (BACK / EDIT).
  pill: {
    paddingHorizontal: 16, paddingVertical: 9,
    borderRadius: 22, borderWidth: 1.5, borderColor: C.iceGlow,
    backgroundColor: 'rgba(74,158,191,0.10)',
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 10,
  },
  pillText: { fontFamily: F.heading, color: C.iceGlow, fontSize: 14, letterSpacing: 2 },
  // Reserves the EDIT pill's footprint so the page dots stay centered when hidden.
  pillSpacer: { width: 84 },

  dots: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: {
    width: 9, height: 9, borderRadius: 999,
    backgroundColor: 'rgba(74,158,191,0.28)',
  },
  dotActive: {
    backgroundColor: C.iceGlow,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 8,
  },

  // ── Pager ──
  pagerArea: { flex: 1 },
  pager: { flex: 1 },

  // ── Video page ──
  videoPage: {
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: C.lockedBg,
  },
  videoWrap: {
    backgroundColor: C.lockedBg,
    borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: C.cardBorder,
  },
  noVideo: {
    backgroundColor: C.lockedBg, justifyContent: 'center', alignItems: 'center', gap: 10,
  },
  noVideoIcon: { fontSize: 30, color: C.textMuted },
  noVideoText: {
    fontFamily: F.bodyMed, fontSize: 12, color: C.textMuted, letterSpacing: 2,
    textTransform: 'uppercase',
  },

  // ── Info page ──
  infoContent: { paddingHorizontal: 26, paddingVertical: 30, gap: 20 },

  title: {
    fontFamily: F.heading, fontSize: 30, color: C.iceGlow,
    letterSpacing: 3, textTransform: 'uppercase',
    textShadowColor: 'rgba(74,158,191,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 18,
  },

  typeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(74,158,191,0.14)',
    borderWidth: 1.5, borderColor: C.iceGlow, borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: 7,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 8,
  },
  typeText: {
    fontFamily: F.heading, fontSize: 13, color: C.iceGlow,
    letterSpacing: 3, textTransform: 'uppercase',
  },

  divider: { height: 1, backgroundColor: C.cardBorder, marginHorizontal: -26 },

  section: { gap: 12 },
  sectionTitle: {
    fontFamily: F.heading, fontSize: 15, color: C.iceGlow,
    letterSpacing: 3, textTransform: 'uppercase',
  },
  bodyText: {
    fontFamily: F.body, fontSize: 16, color: C.text, lineHeight: 25, letterSpacing: 0.5,
  },

  cueRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cueBullet: { fontFamily: F.body, fontSize: 16, color: C.iceGlow, lineHeight: 25 },
  cueText: {
    fontFamily: F.body, fontSize: 16, color: C.text,
    lineHeight: 25, flex: 1, letterSpacing: 0.5,
  },

  addedBy: {
    fontFamily: F.bodyMed, fontSize: 12, color: C.textMuted,
    letterSpacing: 1.5, marginTop: 8,
  },
});
