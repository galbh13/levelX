import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import { C } from '../constants/colors';

// Minimal video player for a direct/streamable clip URL (Supabase storage video).
// Web uses a native <video>; native uses a WebView (avoids needing expo-av) —
// mirrors ExerciseDetailScreen's VideoSection. Fills its parent's width at a
// fixed `height` by default, OR renders at an explicit `width`/`height` box.
// `onRatio(w/h)` fires on BOTH platforms once the clip's metadata loads, so
// callers can size the box to its real aspect ratio — the web <video> reports it
// directly, and the native page posts it back over the WebView bridge. Without
// that, a portrait phone clip stayed letterboxed inside a default 16:9 box.
//
// ── NOTHING HERE EVER AUTOPLAYS ────────────────────────────────────────────────
// Two rules, both learned the hard way on the APK:
//
//  1. The WebView is pointed at an HTML PAGE that embeds the clip, never at the
//     .mp4 URL directly. Handed a bare video URL, Android's WebView renders its
//     own built-in viewer, which STARTS PLAYING — with sound — the moment it
//     loads. `mediaPlaybackRequiresUserAction` is left at its blocking default
//     as a second line of defence, and the <video> tag carries no `autoplay`.
//
//  2. The player only exists while its screen is FOCUSED. The player tab
//     navigator is `lazy: false`, so every tab (Check-up included) mounts at app
//     start — offscreen clips used to load and play behind the login/home screen,
//     which is exactly the "I hear video before I'm even on the homepage" bug.
//     Blur also pauses whatever is playing, so audio can't follow you to another
//     tab.

// Is the screen this player sits on the one being looked at? Safe outside a
// navigator too (JoinScreen renders bare) — there we simply say "yes".
function useScreenFocused() {
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => navigation?.isFocused?.() ?? true);

  useEffect(() => {
    if (!navigation?.addListener) return undefined;
    setFocused(navigation.isFocused?.() ?? true);
    const offFocus = navigation.addListener('focus', () => setFocused(true));
    const offBlur  = navigation.addListener('blur',  () => setFocused(false));
    return () => { offFocus(); offBlur(); };
  }, [navigation]);

  return focused;
}

// Escape a URL for safe interpolation into an HTML attribute.
function attr(url) {
  return String(url).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// The page the native WebView loads: the clip in a plain <video>, controls on,
// autoplay off, `preload="metadata"` so a still first frame shows without
// pulling the whole file down.
// The page also posts the clip's real aspect ratio back to RN as soon as the
// metadata is in, so the caller can reshape the box around a portrait clip.
//
// Two things make it feel instant instead of "a black box with a play button":
//
//  • Android's WebView decodes metadata but paints NOTHING until the clip is
//    played — so a paused player is a black rectangle, and the movement you came
//    to look at is invisible until you commit to it. A hair-width seek forces a
//    decode of one frame, and that frame is what gets painted. It is the poster
//    image, taken from the clip itself (a storage .mp4 has no thumbnail to point
//    a `poster` attribute at).
//
//  • Tapping the frame plays it, first tap. The native controls otherwise cost
//    two taps — one to reveal them, one to hit play. Taps in the control bar's
//    strip are left alone so scrubbing still belongs to the controls, and
//    play() here is inside a real click handler, so the user-gesture gate
//    (mediaPlaybackRequiresUserAction) is satisfied.
function videoPage(url, preload, fit, radius) {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  html,body{margin:0;padding:0;height:100%;background:${C.lockedBg};overflow:hidden}
  /* The rounding lives on this wrapper, never on the <video> itself — a rounded
     video element paints BLACK on some GPUs (see the web branch below). A
     clipping parent gets the same corners with none of that risk, and it also
     covers Android, where the WebView draws its own content and ignores the
     borderRadius set on the RN view around it. translateZ pins it to its own
     layer so the clip is applied by the compositor. */
  .frame{position:absolute;inset:0;border-radius:${radius}px;overflow:hidden;
         transform:translateZ(0);background:${C.lockedBg}}
  video{width:100%;height:100%;display:block;object-fit:${fit};background:${C.lockedBg}}
</style></head><body>
<div class="frame">
<video src="${attr(url)}" controls preload="${preload}" playsinline webkit-playsinline></video>
</div>
<script>
(function(){
  var v = document.querySelector('video');
  function post(){
    if (!v.videoWidth || !v.videoHeight || !window.ReactNativeWebView) return;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type:'ratio', ratio: v.videoWidth / v.videoHeight }));
  }
  // Force one frame to decode so the paused player shows the movement, not black.
  var painted = false;
  function paintFirstFrame(){
    if (painted || !v.duration) return;
    painted = true;
    try { v.currentTime = Math.min(0.05, v.duration / 2); } catch (e) {}
  }
  v.addEventListener('loadedmetadata', function(){ post(); paintFirstFrame(); });
  v.addEventListener('loadeddata', post);
  if (v.readyState >= 1) { post(); paintFirstFrame(); }

  // One tap on the frame plays. The bottom strip is the native control bar —
  // leave those taps to it, or scrubbing a paused clip would start playback.
  document.addEventListener('click', function(e){
    var r = v.getBoundingClientRect();
    if (e.clientY > r.bottom - 56) return;
    if (v.paused) { var pr = v.play(); if (pr && pr.catch) pr.catch(function(){}); }
  });
})();
</script>
</body></html>`;
}

// Give the generated page a real https origin (rather than about:blank), so the
// WebView treats the clip as a same-origin media load.
function originOf(url) {
  const m = /^(https?:\/\/[^/]+)/i.exec(String(url));
  return m ? `${m[1]}/` : undefined;
}

const PAUSE_JS = `(function(){var v=document.querySelector('video');if(v)v.pause();})();true;`;

// `preload` — 'metadata' (default: first frame + dimensions only) or 'auto' for
// a player that's about to be looked at and should be ready to hit play.
// `fit` — 'contain' (default: the whole clip, letterboxed) or 'cover' (the clip
// FILLS the box, edges cropped). Callers that hand over a box shaped like the
// clip want 'cover'; a fixed-height row in a list wants 'contain'.
// `radius` — corner rounding, applied where it's actually safe (see videoPage).
export default function VideoPlayer({
  url, width, height = 220, style, onRatio, preload = 'metadata',
  fit = 'contain', radius = 12,
}) {
  const focused = useScreenFocused();
  const webRef = useRef(null);
  const videoRef = useRef(null);

  // The page is built ONCE per clip. It used to be rebuilt inline on every
  // render, and a fresh source object makes the WebView reload — which is what
  // the "it shows the frame, then goes black and takes a second" bug was: the
  // player reports its aspect ratio, the caller resizes the box around it, that
  // re-render handed the WebView a new source, and the clip started over from
  // nothing. Same html, same identity, no reload.
  // `fit` is deliberately NOT a dependency. Callers flip it once the clip's real
  // ratio comes back (letterboxed guess → filling the frame), and rebuilding the
  // page for that would reload the WebView — the flash this memo exists to stop.
  // The page is built with whatever fit it had at mount and restyled in place
  // below.
  const initialFit = useRef(fit).current;
  const source = useMemo(
    () => ({ html: videoPage(url, preload, initialFit, radius), baseUrl: originOf(url) }),
    [url, preload, initialFit, radius],
  );

  // Restyle in place — no reload, no lost buffer, no restart.
  useEffect(() => {
    if (Platform.OS === 'web' || fit === initialFit) return;
    webRef.current?.injectJavaScript?.(
      `(function(){var v=document.querySelector('video');if(v)v.style.objectFit=${JSON.stringify(fit)};})();true;`
    );
  }, [fit, initialFit]);

  function pause() {
    if (Platform.OS === 'web') videoRef.current?.pause?.();
    else webRef.current?.injectJavaScript?.(PAUSE_JS);
  }

  // Leaving the screen stops the sound, on both platforms.
  useEffect(() => {
    if (!focused) pause();
  }, [focused]);

  // …and so does leaving the app. Android's WebView will happily keep a clip
  // playing in the background otherwise.
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s !== 'active') pause(); });
    return () => sub.remove();
  }, []);

  if (!url) return null;

  if (Platform.OS === 'web') {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
        ref={videoRef}
        src={url}
        controls
        preload={preload}
        playsInline
        onLoadedMetadata={onRatio ? (e) => {
          const v = e.target;
          if (v.videoWidth && v.videoHeight) onRatio(v.videoWidth / v.videoHeight);
        } : undefined}
        style={{
          width: width ?? '100%',
          height,
          display: 'block',
          objectFit: fit,
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

  const box = [{ width: width ?? '100%', height, borderRadius: radius, backgroundColor: C.lockedBg }, style];

  // Offscreen: a same-sized placeholder, so nothing loads and the layout doesn't
  // jump when the screen comes into view.
  if (!focused) {
    return (
      <View style={[box, styles.placeholder]}>
        <Text style={styles.placeholderIcon}>▶</Text>
      </View>
    );
  }

  return (
    <WebView
      ref={webRef}
      source={source}
      originWhitelist={['*']}
      style={box}
      onMessage={(e) => {
        try {
          const msg = JSON.parse(e.nativeEvent.data);
          if (msg?.type === 'ratio' && msg.ratio > 0) onRatio?.(msg.ratio);
        } catch { /* not ours — ignore */ }
      }}
      allowsFullscreenVideo
      allowsInlineMediaPlayback
      // The decoded still frame is composited like a playing one; on the software
      // layer some devices paint the paused surface black regardless.
      androidLayerType="hardware"
      // Playback needs a tap. This is what keeps clips silent at app start.
      mediaPlaybackRequiresUserAction
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.lockedBorder ?? C.textMuted,
  },
  placeholderIcon: { color: C.textMuted, fontSize: 26 },
});
