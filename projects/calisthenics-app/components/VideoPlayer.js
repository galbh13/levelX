import { Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { C } from '../constants/colors';

// Minimal video player for a direct/streamable clip URL (Supabase storage video).
// Web uses a native <video>; native uses a WebView (avoids needing expo-av) —
// mirrors ExerciseDetailScreen's VideoSection. Fills its parent's width at a
// fixed `height` by default, OR renders at an explicit `width`/`height` box.
// `onRatio(w/h)` fires on web once metadata loads, so callers can size the box to
// the clip's real aspect ratio (native/WebView can't report it — use a default).
export default function VideoPlayer({ url, width, height = 220, style, onRatio }) {
  if (!url) return null;

  if (Platform.OS === 'web') {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
        src={url}
        controls
        preload="metadata"
        playsInline
        onLoadedMetadata={onRatio ? (e) => {
          const v = e.target;
          if (v.videoWidth && v.videoHeight) onRatio(v.videoWidth / v.videoHeight);
        } : undefined}
        style={{
          width: width ?? '100%',
          height,
          display: 'block',
          objectFit: 'contain',
          backgroundColor: C.lockedBg,
          // NOTE: no borderRadius on the <video> itself — a rounded <video> makes
          // Chromium/Edge paint the frame BLACK on some GPUs (audio/timeline still
          // run). The exercise-detail player has no radius and works; matching it.
          // Force its own compositing layer too, which sidesteps the same class of
          // black-frame bugs.
          transform: 'translateZ(0)',
          ...(style || {}),
        }}
      />
    );
  }

  return (
    <WebView
      source={{ uri: url }}
      style={[{ width: width ?? '100%', height, borderRadius: 12, backgroundColor: C.lockedBg }, style]}
      allowsFullscreenVideo
      mediaPlaybackRequiresUserAction={false}
    />
  );
}
