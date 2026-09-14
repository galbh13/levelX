// ── Release flags ────────────────────────────────────────────────────────────
// Small switches that decide whether a finished-enough feature is visible to
// players. They live here (and not next to one screen) because the same switch
// now gates the SAME feature from more than one place.

// The guided walkthrough (components/GuidedTour). It is silenced for the Play
// Store release — the tour itself isn't finished, so nothing should be able to
// start it. Flipping this to `true` brings back BOTH entry points at once:
//   • HomeScreen's TUTORIAL pill, and
//   • the TUTORIAL node on the PROFILE tab.
// While it is `false` the PROFILE node still SHOWS (as a locked [coming soon...]
// node, same treatment as THE SYSTEM) so the player sees the tutorial exists.
// The tour machinery (GuidedTour, TourContext, the tour targets) is untouched.
export const TUTORIAL_ENABLED = false;
