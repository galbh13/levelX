import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';

const SCREEN_WIDTH = Dimensions.get('window').width;
const VIDEO_HEIGHT = SCREEN_WIDTH * 0.5625; // 16:9

function getEmbedUrl(url) {
  if (!url) return null;
  const shortsMatch = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/);
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
  const id = shortsMatch?.[1] || watchMatch?.[1];
  return id ? `https://www.youtube.com/embed/${id}` : null;
}

function SectionTitle({ children }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export default function ExerciseDetailScreen({ route, navigation }) {
  const { exercise } = route.params;
  const embedUrl = getEmbedUrl(exercise.youtube_url);

  const cues = exercise.coaching_cues
    ? exercise.coaching_cues.split('\n').filter(line => line.trim().length > 0)
    : [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{exercise.name}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* Video */}
        {embedUrl ? (
          Platform.OS === 'web' ? (
            <iframe
              src={embedUrl}
              style={{ width: '100%', aspectRatio: '16/9', border: 'none', display: 'block' }}
              allowFullScreen
            />
          ) : (
            <WebView
              source={{ uri: embedUrl }}
              style={styles.video}
              allowsFullscreenVideo
              javaScriptEnabled
            />
          )
        ) : (
          <View style={styles.noVideo}>
            <Text style={styles.noVideoText}>No video added yet</Text>
          </View>
        )}

        <View style={styles.content}>
          {/* Movement Type Badge */}
          <View style={styles.typeBadge}>
            <Text style={styles.typeText}>{exercise.movement_type}</Text>
          </View>

          {/* Description */}
          {exercise.description ? (
            <View style={styles.section}>
              <SectionTitle>DESCRIPTION</SectionTitle>
              <Text style={styles.bodyText}>{exercise.description}</Text>
            </View>
          ) : null}

          {/* Coaching Cues */}
          {cues.length > 0 ? (
            <View style={styles.section}>
              <SectionTitle>COACHING CUES</SectionTitle>
              {cues.map((cue, i) => (
                <View key={i} style={styles.cueRow}>
                  <Text style={styles.cueBullet}>▸</Text>
                  <Text style={styles.cueText}>{cue.trim()}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Added By */}
          {exercise.added_by_name ? (
            <Text style={styles.addedBy}>Added by {exercise.added_by_name}</Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  header: {
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.cardBorder,
  },
  back: { marginBottom: 10 },
  backText: { fontFamily: F.bodyMed, color: C.iceGlow, fontSize: 13, letterSpacing: 2 },
  title: {
    fontFamily: F.heading,
    fontSize: 22,
    color: C.text,
    letterSpacing: 3,
    textTransform: 'uppercase',
    textAlign: 'center',
  },

  body: { paddingBottom: 56 },

  video: {
    width: SCREEN_WIDTH,
    height: VIDEO_HEIGHT,
  },
  noVideo: {
    width: SCREEN_WIDTH,
    height: VIDEO_HEIGHT,
    backgroundColor: C.lockedBg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noVideoText: {
    fontFamily: F.bodyMed,
    fontSize: 13,
    color: C.textMuted,
    letterSpacing: 2,
  },

  content: {
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 24,
  },

  typeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: C.lockedBg,
    borderWidth: 1.5,
    borderColor: C.deepBlue,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  typeText: {
    fontFamily: F.body,
    fontSize: 14,
    color: C.iceGlow,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },

  section: { gap: 10 },

  sectionTitle: {
    fontFamily: F.heading,
    fontSize: 13,
    color: C.deepBlue,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },

  bodyText: {
    fontFamily: F.body,
    fontSize: 14,
    color: C.text,
    lineHeight: 22,
    letterSpacing: 0.5,
  },

  cueRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  cueBullet: {
    fontFamily: F.body,
    fontSize: 14,
    color: C.deepBlue,
    lineHeight: 22,
  },
  cueText: {
    fontFamily: F.body,
    fontSize: 14,
    color: C.text,
    lineHeight: 22,
    flex: 1,
    letterSpacing: 0.5,
  },

  addedBy: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: C.textMuted,
    letterSpacing: 1.5,
    textAlign: 'center',
    marginTop: 8,
  },
});
