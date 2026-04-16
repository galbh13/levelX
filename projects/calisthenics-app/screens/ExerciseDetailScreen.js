import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';

const SCREEN_WIDTH = Dimensions.get('window').width;
const VIDEO_HEIGHT = SCREEN_WIDTH * 0.5625; // 16:9

function getYouTubeId(url) {
  if (!url) return null;
  const patterns = [/[?&]v=([^&]+)/, /youtu\.be\/([^?&]+)/, /shorts\/([^?&]+)/];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

export default function ExerciseDetailScreen({ route, navigation }) {
  const { exercise } = route.params;
  const videoId = getYouTubeId(exercise.youtube_url);

  const embedHtml = `
    <html>
      <head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh;">
        <iframe
          width="100%" height="100%"
          src="https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen>
        </iframe>
      </body>
    </html>
  `;

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
        {videoId ? (
          <WebView
            source={{ html: embedHtml }}
            style={styles.video}
            allowsFullscreenVideo
            javaScriptEnabled
          />
        ) : (
          <View style={styles.noVideo}>
            <Text style={styles.noVideoText}>No video added yet</Text>
          </View>
        )}

        {/* Badge + info */}
        <View style={styles.info}>
          <View style={styles.typeBadge}>
            <Text style={styles.typeText}>{exercise.movement_type}</Text>
          </View>
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

  body: { paddingBottom: 48 },

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

  info: {
    padding: 20,
    gap: 12,
  },
  typeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: C.lockedBg,
    borderWidth: 1,
    borderColor: C.deepBlue,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  typeText: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: C.iceGlow,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});
