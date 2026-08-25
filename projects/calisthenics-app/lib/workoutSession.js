// Live "Workout Mode" session state — stored LOCALLY only (AsyncStorage), never
// in Supabase. The point of a session is to survive the player closing the app
// mid-workout so they can resume where they left off. Once the workout is
// finished we clear it: the only lasting artifact is the summary screen, which
// the player screenshots. No server-side history is kept.
//
// Session shape:
//   {
//     workoutId, dateStr, title,
//     startedAt: ISO,
//     segments: [{ start: ISO, end: ISO|null }],  // open last segment = active
//     log: { [exerciseId]: [{ done: bool, reps: string }] },  // one entry per set
//     lastActivityAt: ISO,  // last set check / reps edit / skip — drives the
//                           // idle-trim when the player forgets to press FINISH
//   }
//
// A "break" is the gap between one segment's end and the next segment's start —
// the time the player spent out of Workout Mode (exited / phone away) OR paused
// in place via the ⏸ BREAK button (closed segment while still on the screen).

import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'workout_session:';

export function sessionKey(dateStr, workoutId) {
  return `${PREFIX}${dateStr}:${workoutId}`;
}

export async function loadSession(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error('[workoutSession] load:', e);
    return null;
  }
}

export async function saveSession(key, session) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(session));
  } catch (e) {
    console.error('[workoutSession] save:', e);
  }
}

export async function clearSession(key) {
  try {
    await AsyncStorage.removeItem(key);
  } catch (e) {
    console.error('[workoutSession] clear:', e);
  }
}

// Keys of every in-progress session, so the Workouts list can show RESUME on the
// workouts that already have an open session on this device.
export async function activeSessionKeys() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    return keys.filter(k => k.startsWith(PREFIX));
  } catch (e) {
    console.error('[workoutSession] keys:', e);
    return [];
  }
}
