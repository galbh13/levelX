import AsyncStorage from '@react-native-async-storage/async-storage';

// First-launch tutorial gate. Bump the version suffix if the walkthrough changes
// enough that returning players should be shown it again.
const KEY = 'levelx:onboarding:v1';

// Has this device already dismissed the walkthrough? Never throws — a storage
// hiccup resolves to `true` so we don't nag an existing user on every open.
export async function hasSeenOnboarding() {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return true;
  }
}

// Remember that the walkthrough was finished / skipped.
export async function markOnboardingSeen() {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    // best-effort; worst case it shows once more next launch
  }
}
