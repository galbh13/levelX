import { Component } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import { C } from '../constants/colors';
import { supabase } from '../lib/supabase';

/**
 * The app's last line of defence.
 *
 * IntroBoundary and TourBoundary guard HELPERS — when the intro clip or the
 * guided tour throws, they render `null` and the real app is still underneath.
 * This one guards the app itself, where there is nothing underneath: an
 * uncaught throw anywhere in the tree unmounts every screen and leaves the
 * player staring at a black rectangle with no way back except force-quitting.
 * The big data-driven screens (QuestTree, Skills) are the realistic sources —
 * one unexpected null from Supabase, one node shape the layout doesn't know.
 *
 * So it must mount ABOVE ScaledRoot and NavigationContainer. A boundary
 * rendered inside the navigator cannot catch a throw from that same navigator,
 * and its fallback would be trying to draw inside a tree React has already
 * torn down. Only SafeAreaProvider stays outside it, so the fallback can read
 * real insets.
 *
 * Two ways out, because they fail differently:
 *   RELOAD    — restarts the JS bundle. Fixes the transient case (a bad fetch,
 *               a race on first paint). Note that merely clearing `failed`
 *               would NOT: React would re-render the identical tree over the
 *               identical bad data and throw again on the same frame.
 *   SIGN OUT  — clears the session first, then restarts. This is the escape
 *               hatch for the case that actually traps people: when the crash
 *               comes from the signed-in player's own rows, RELOAD loops
 *               forever and only a different session breaks the cycle.
 */

function Fallback({ onReload, onSignOut, busy }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.panel}>
        <Text style={styles.glyph}>⚠</Text>
        <Text style={styles.title}>SYSTEM ERROR</Text>
        <Text style={styles.body}>
          The System hit something it couldn't read. Your training data is safe —
          nothing was lost.
        </Text>

        <TouchableOpacity
          style={[styles.pill, busy && styles.pillOff]}
          onPress={busy ? undefined : onReload}
          activeOpacity={0.85}
          disabled={busy}
        >
          <Text style={styles.pillText}>RELOAD</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.ghost}
          onPress={busy ? undefined : onSignOut}
          activeOpacity={0.7}
          disabled={busy}
        >
          <Text style={styles.ghostText}>Still broken? Sign out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default class CrashBoundary extends Component {
  state = { failed: false, busy: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    // No crash reporter in this build (the store listing promises no analytics),
    // so the console is the only record — it still reaches a USB-attached device
    // and `npx expo start` during testing.
    console.warn('[CrashBoundary]', error?.message ?? error, info?.componentStack ?? '');
  }

  reload = async () => {
    this.setState({ busy: true });
    if (Platform.OS === 'web') {
      window.location.reload();
      return;
    }
    try {
      await Updates.reloadAsync();
    } catch {
      // reloadAsync is unavailable in a dev client / Expo Go. Clearing the flag
      // is the weaker fallback — it only helps if the throw was transient — but
      // a stuck button is worse than a re-throw.
      this.setState({ failed: false, busy: false });
    }
  };

  signOut = async () => {
    this.setState({ busy: true });
    try { await supabase.auth.signOut(); } catch {}
    this.reload();
  };

  render() {
    if (this.state.failed) {
      return <Fallback onReload={this.reload} onSignOut={this.signOut} busy={this.state.busy} />;
    }
    return this.props.children;
  }
}

// Deliberately font-free: every label here uses the platform default rather than
// Exo2/Cinzel. The fallback has to survive the case where the throw happened
// before or because of font loading, and a screen that can't render its own
// error text is worthless.
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  panel: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.cardBorder,
    backgroundColor: C.surface,
    borderRadius: 16,
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  glyph: {
    fontSize: 34,
    color: C.deepBlue,
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 3,
    color: C.text,
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    color: '#8FB4CE',
    marginBottom: 26,
  },
  pill: {
    borderWidth: 1,
    borderColor: C.deepBlue,
    backgroundColor: 'rgba(74,158,191,0.10)',
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 40,
  },
  pillOff: { opacity: 0.45 },
  pillText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 2,
    color: C.deepBlue,
  },
  ghost: {
    marginTop: 18,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  ghostText: {
    fontSize: 13,
    color: '#5A7E9C',
    textDecorationLine: 'underline',
  },
});
