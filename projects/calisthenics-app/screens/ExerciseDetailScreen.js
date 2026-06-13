import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Dimensions, Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import ScreenFrame from '../components/ScreenFrame';

const WIN = Dimensions.get('window');
// How much of the viewport the player may occupy before we cap it.
const MAX_W = Math.min(WIN.width - 32, 860); // wider than before → uses more page
const MAX_H = WIN.height * 0.66;
const MIN_CARD_W = 320;                       // keep text below readable

// Given a width:height ratio, return the largest {w,h} that fits the viewport
// caps while preserving that ratio — so vertical videos get a tall narrow card
// and horizontal videos get a wide one, with no letterbox bars.
function fitToViewport(ratio) {
  let w = MAX_W;
  let h = w / ratio;
  if (h > MAX_H) { h = MAX_H; w = h * ratio; }
  return { w, h };
}

function getYouTubeEmbedUrl(url) {
  if (!url) return null;
  const shortsMatch = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/);
  const watchMatch  = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
  const id = shortsMatch?.[1] || watchMatch?.[1];
  return id ? `https://www.youtube.com/embed/${id}` : null;
}

function SectionTitle({ children }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

// ─── Video renderer ───────────────────────────────────────────────────────────
// Priority: storage video (video_url) > YouTube embed (youtube_url) > placeholder

function VideoSection({ exercise, ratio, height, onRatio }) {
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
            width: '100%',
            aspectRatio: String(ratio),
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
        style={{ width: '100%', height }}
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
          style={{ width: '100%', aspectRatio: String(ratio), border: 'none', display: 'block' }}
          allowFullScreen
          title="exercise video"
        />
      );
    }
    return (
      <WebView
        source={{ uri: embedUrl }}
        style={{ width: '100%', height }}
        allowsFullscreenVideo
        javaScriptEnabled
      />
    );
  }

  // No video
  return (
    <View style={[styles.noVideo, { height }]}>
      <Text style={styles.noVideoIcon}>▶</Text>
      <Text style={styles.noVideoText}>No video added yet</Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ExerciseDetailScreen({ route, navigation }) {
  const { exercise } = route.params;

  // Default to 16:9 until the real video metadata loads, then snap to its ratio.
  const [ratio, setRatio] = useState(16 / 9);

  const cues = exercise.coaching_cues
    ? exercise.coaching_cues.split('\n').filter(line => line.trim().length > 0)
    : [];

  const { w: videoW, h: videoH } = fitToViewport(ratio);
  const cardWidth = Math.max(videoW, MIN_CARD_W);

  return (
    <ScreenFrame maxWidth={920}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{exercise.name}</Text>
      </View>

      <View style={styles.body}>
        <View style={[styles.card, { width: cardWidth }]}>
          <View style={[styles.videoWrap, { width: videoW, alignSelf: 'center' }]}>
            <VideoSection
              exercise={exercise}
              ratio={ratio}
              height={videoH}
              onRatio={setRatio}
            />
          </View>

          <View style={styles.content}>
            {/* Movement Type Badge */}
            <View style={styles.typeBadge}>
              <Text style={styles.typeText}>{exercise.movement_type}</Text>
            </View>

            {/* Description */}
            {!!exercise.description && (
              <>
                <View style={styles.divider} />
                <View style={styles.section}>
                  <SectionTitle>DESCRIPTION</SectionTitle>
                  <Text style={styles.bodyText}>{exercise.description}</Text>
                </View>
              </>
            )}

            {/* Coaching Cues */}
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

            {/* Added By */}
            {!!exercise.added_by_name && (
              <Text style={styles.addedBy}>Added by {exercise.added_by_name}</Text>
            )}
          </View>
        </View>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  header: {
    paddingHorizontal: 22,
    paddingTop: 26,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: C.cardBorder,
  },
  // Glowing ice pill.
  back: {
    alignSelf: 'flex-start', marginBottom: 14,
    paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 24, borderWidth: 1.5, borderColor: C.iceGlow,
    backgroundColor: 'rgba(74,158,191,0.10)',
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 10,
  },
  backText: { fontFamily: F.heading, color: C.iceGlow, fontSize: 16, letterSpacing: 2 },
  title: {
    fontFamily: F.heading, fontSize: 30, color: C.iceGlow,
    letterSpacing: 4, textTransform: 'uppercase', textAlign: 'center',
    textShadowColor: 'rgba(74,158,191,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 18,
  },

  body: { paddingTop: 28, paddingBottom: 44, paddingHorizontal: 16, alignItems: 'center' },

  // ── Card shell ── (width is set dynamically from the video ratio)
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.22, shadowRadius: 18,
  },

  // ── Video ── (width/height set dynamically from the video ratio)
  videoWrap: {
    backgroundColor: C.lockedBg,
    borderBottomWidth: 1,
    borderBottomColor: C.cardBorder,
  },
  noVideo: {
    width: '100%',
    backgroundColor: C.lockedBg, justifyContent: 'center', alignItems: 'center', gap: 10,
  },
  noVideoIcon: {
    fontSize: 26, color: C.textMuted,
  },
  noVideoText: {
    fontFamily: F.bodyMed, fontSize: 12, color: C.textMuted, letterSpacing: 2,
    textTransform: 'uppercase',
  },

  // ── Content ──
  content: { paddingHorizontal: 22, paddingVertical: 22, gap: 20 },

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

  divider: {
    height: 1, backgroundColor: C.cardBorder, marginHorizontal: -22,
  },

  section: { gap: 12 },
  sectionTitle: {
    fontFamily: F.heading, fontSize: 15, color: C.iceGlow,
    letterSpacing: 3, textTransform: 'uppercase',
  },
  bodyText: {
    fontFamily: F.body, fontSize: 16, color: C.text, lineHeight: 25, letterSpacing: 0.5,
  },

  cueRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cueBullet: {
    fontFamily: F.body, fontSize: 16, color: C.iceGlow, lineHeight: 25,
  },
  cueText: {
    fontFamily: F.body, fontSize: 16, color: C.text,
    lineHeight: 25, flex: 1, letterSpacing: 0.5,
  },

  addedBy: {
    fontFamily: F.bodyMed, fontSize: 12, color: C.textMuted,
    letterSpacing: 1.5, textAlign: 'center', marginTop: 8,
  },
});
