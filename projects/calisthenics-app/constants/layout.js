import { Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Shared layout tokens.
// CARD_W — THE width of the framed card, for every screen. `ScreenFrame`
// re-exports it as FRAME_MAX_W and applies it itself; no screen passes its own
// width any more (mismatched card widths read as unfinished).
// There is deliberately NO CARD_H: the card is always exactly as tall as the
// viewport allows (`ScreenFrame` handles that), and content that outgrows it
// scrolls INSIDE the card. A fixed card height is what used to make the frame
// overflow a short phone and fall short of a tall one.
export const CARD_W = 1200;

// ─── The real layout canvas ──────────────────────────────────────────────────
// On native, App.js renders the WHOLE tree into an oversized canvas and scales
// it back down (ScaledRoot / NATIVE_SCALE) so the density matches the zoomed
// web build. That means `useWindowDimensions()` LIES to a screen on native: it
// reports the device window (e.g. 393x851) while the screen is actually laid
// out on a 546x1182 canvas. Any screen that picks a layout from the viewport
// size must read THIS hook instead, or it gets phone styles on a tablet-sized
// canvas on native and desktop styles on web — the exact web/APK mismatch.
export const NATIVE_SCALE = 0.72;

export function useAppDimensions() {
  const { width, height } = useWindowDimensions();
  if (Platform.OS === 'web') return { width, height };
  return { width: width / NATIVE_SCALE, height: height / NATIVE_SCALE };
}

// Safe-area insets EXPRESSED IN CANVAS UNITS. The app is edge-to-edge on
// Android, so the status bar and the (three-button or gesture) nav bar sit on
// top of the app unless we pad for them. Insets come back in real device dp,
// but everything inside ScaledRoot is measured in canvas dp — hence the
// divide, without which the padding comes out ~28% short on device.
export function useAppInsets() {
  const insets = useSafeAreaInsets();
  if (Platform.OS === 'web') return { top: 0, bottom: 0, left: 0, right: 0 };
  const k = 1 / NATIVE_SCALE;
  return {
    top: insets.top * k,
    bottom: insets.bottom * k,
    left: insets.left * k,
    right: insets.right * k,
  };
}

// ─── The ADMIN DESKTOP layout ────────────────────────────────────────────────
// The coach reviews a player's check-up on a COMPUTER and screen-records it for
// them, so the admin check-up screen has a SECOND layout: on a desktop-sized
// canvas the card widens past CARD_W and the content goes two-up with bigger
// type, instead of leaving two thirds of a monitor empty either side of a
// phone-width column. On a phone it is untouched.
//
// This is the ONE documented exception to "ONE CARD, EVERY SCREEN" (see
// CLAUDE.md): it applies to admin screens only — never a player tab, where a
// mismatched card would show mid-swipe against its neighbour.
//
// Both numbers are CANVAS units, so the same threshold reads correctly on web
// (the document is zoomed to WEB_ZOOM, so a 1920px monitor is a ~2740 canvas)
// and on native (useAppDimensions already undoes NATIVE_SCALE). A phone is
// ~550 canvas units wide either way — nowhere near the threshold.
export const DESKTOP_MIN_W  = 1400;
export const DESKTOP_CARD_W = 2400;

export function useDesktopLayout() {
  const { width } = useAppDimensions();
  const wide = width >= DESKTOP_MIN_W;
  // -24 = ScreenFrame's FRAME_PAD on both sides (inlined — ScreenFrame imports
  // this file, so it cannot be imported back).
  return { wide, cardW: wide ? Math.min(width - 24, DESKTOP_CARD_W) : CARD_W };
}
