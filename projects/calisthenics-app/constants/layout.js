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
