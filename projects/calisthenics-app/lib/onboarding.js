import AsyncStorage from '@react-native-async-storage/async-storage';

// First-launch tutorial gate. Bump the version suffix if the walkthrough changes
// enough that returning players should be shown it again.
const KEY = 'levelx:onboarding:v1';

// Remember that the walkthrough was finished / skipped.
export async function markOnboardingSeen() {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    // best-effort; worst case it shows once more next launch
  }
}
