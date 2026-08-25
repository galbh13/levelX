import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Image, Platform, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { C } from '../constants/colors';

const SOURCE = require('../assets/intro.mp4');
const POSTER = require('../assets/intro-poster.jpg');

const FADE_MS = 320;   // cross-fade from the last frame into the app
const CLIP_MS = 3000;  // the mp4's real duration (1920x1080 @30fps)

// The clip is fetched over the network on web, so it is NOT playable the moment
// we mount. Waiting is gated two ways so a slow (or dead) fetch can never leave
// the user staring at a black overlay:
//   • READY_MS — the longest we'll wait for the clip to become playable at all.
//     Miss it and we skip the intro entirely and reveal the app immediately.
//     Better no animation than a black screen.
//   • TAIL_MS — slack past the clip's own length once it IS actually playing,
//     in case `playToEnd` never lands.
const READY_MS = 2200;
const TAIL_MS = 1200;
const ERROR_HOLD_MS = 700; // if the clip errors, hold the still mark this long instead

/**
 * Full-screen "THE SYSTEM" title sequence, played once per cold start and then
 * faded away. Renders ABOVE the app, so whatever is mounted underneath (login
 * card or the tabs) has already laid out by the time we uncover it.
 *
 * Wrapped in IntroBoundary by App.js — this is decoration, and it must never be
 * able to take the app down with it.
 */
export default function SystemIntro({ onDone }) {
  const [failed, setFailed] = useState(false);
  // Landscape (desktop, or a phone turned sideways) is wide enough that the 16:9
  // clip can fill the frame edge-to-edge without losing the wordmark, so we
  // switch to `cover` there and let the intro take the entire screen. Portrait
  // keeps `contain` — covering a tall screen would crop the ~5:1 wordmark down
  // to a couple of letters.
  const { width, height } = useWindowDimensions();
  const fit = width >= height ? 'cover' : 'contain';
  const fade = useRef(new Animated.Value(1)).current;
  const finished = useRef(false);
  const started = useRef(false);

  const player = useVideoPlayer(SOURCE, (p) => {
    p.loop = false;
    p.muted = true; // the clip has no audio track; muted also guarantees web autoplay
  });

  // Single exit path — every route out (ended, tapped, never loaded, errored)
  // funnels through here, so the fade and onDone can only ever run once.
  function finish() {
    if (finished.current) return;
    finished.current = true;
    Animated.timing(fade, { toValue: 0, duration: FADE_MS, useNativeDriver: true })
      .start(() => onDone?.());
  }

  useEffect(() => {
    let readyTimer;
    let playTimer;

    // Respect the OS "reduce motion" setting — skip the sequence entirely.
    // NOTE: on Expo web this API can be undefined, so it must be optional-called
    // or the whole tree throws and the app renders black.
    AccessibilityInfo.isReduceMotionEnabled?.()
      ?.then((reduce) => { if (reduce) finish(); })
      ?.catch(() => {});

    // Only start the clock once the clip can actually play, so the animation is
    // seen from its first frame rather than half-buffered under a fixed timer.
    function start() {
      if (started.current || finished.current) return;
      started.current = true;
      clearTimeout(readyTimer);
      try {
        player.play();
      } catch {
        finish();
        return;
      }
      playTimer = setTimeout(finish, CLIP_MS + TAIL_MS);
    }

    const ended = player.addListener('playToEnd', finish);
    const status = player.addListener('statusChange', ({ status: s }) => {
      if (s === 'readyToPlay') start();
      else if (s === 'error') {
        setFailed(true);
        playTimer = setTimeout(finish, ERROR_HOLD_MS);
      }
    });

    // It may already be playable before we subscribed (warm cache on a reload).
    try {
      if (player.status === 'readyToPlay') start();
    } catch {
      /* status unreadable on this platform — the timers below still cover us */
    }

    readyTimer = setTimeout(() => { if (!started.current) finish(); }, READY_MS);

    return () => {
      ended.remove();
      status.remove();
      clearTimeout(readyTimer);
      clearTimeout(playTimer);
    };
  }, [player]);

  return (
    <Animated.View style={[styles.root, { opacity: fade }]} pointerEvents="box-none">
      <Pressable style={StyleSheet.absoluteFill} onPress={finish} accessibilityLabel="Skip intro">
        {failed ? (
          <Image source={POSTER} style={styles.media} resizeMode={fit} />
        ) : (
          <VideoView
            player={player}
            style={styles.media}
            contentFit={fit}
            nativeControls={false}
            allowsFullscreen={false}
            allowsPictureInPicture={false}
            {...(Platform.OS === 'web' ? { playsInline: true } : null)}
          />
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Sits above everything. The letterbox is painted in the CLIP's own edge colour
  // (C.introBg), not the app's C.bg — they're different blacks, and using C.bg put
  // a visible seam around the video. `contain` (not `cover`) is deliberate: the
  // wordmark is ~5:1, so covering a portrait phone screen would crop it to a
  // couple of letters. Matching the bars is what makes it read as full-bleed.
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: C.introBg, zIndex: 999, elevation: 999 },
  media: { flex: 1, width: '100%', height: '100%', backgroundColor: C.introBg },
});
