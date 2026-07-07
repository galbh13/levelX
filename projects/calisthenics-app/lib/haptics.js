import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// Web-safe haptics: real vibration on the APK, silent no-op on the web build.
// Every call is fire-and-forget and swallowed on failure — haptics must never
// break a flow.

// Light tick — checking a set, toggling a daily quest.
export function hapticTap() {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

// Success thump — completing a quest, finishing a workout.
export function hapticSuccess() {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
