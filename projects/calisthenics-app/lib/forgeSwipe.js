import { Animated } from 'react-native';

// ── Shared Workouts ⇄ Manage ("Training Forge") page-swipe progress ──────────────
// ONE animated value that BOTH screens bind their whole card to, so the two panels
// slide past each other in perfect lockstep — no cross-screen drift, no mount seam,
// no two-phase "exit then enter" delay. Manage is pushed as a transparentModal over
// Workouts (which stays mounted & visible), and this single value drives both:
//
//   1 → Workouts fully in view, Manage parked off the right edge (rest on Workouts)
//   0 → Manage fully in view,   Workouts parked off the left edge (rest on Manage)
//
// The incoming screen (Manage) owns the animation (it kicks on mount / on back);
// Workouts just passively follows the same value, guaranteeing zero drift.
export const forgeP = new Animated.Value(1);

// Shared pace so both directions feel identical.
export const SWIPE_MS = 300;
