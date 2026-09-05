import { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import ScreenFrame from '../components/ScreenFrame';
import PillButton from '../components/PillButton';
import HoloDissolve from '../components/HoloDissolve';

// The app's wordmark, matching the intro clip's title card.
const WORDMARK = 'The System';

// ─── Sign in ─────────────────────────────────────────────────────────────────
// Styled like the rest of the app (check-up / gallery / player screens): the
// shared ScreenFrame card, a glowing accent wordmark over a hairline rule, a
// section bar + uppercase field labels, and the standard PillButton action.
// The old build's deviation glitches (datamosh overlay, RGB-split ghosts, brick
// shatter, void drone) are gone. The one piece of theatre left is the hand-off:
// pressing LOGIN dissolves this card from the TOP DOWN with <HoloDissolve>, and
// the landing card's <HoloBuild> then clears from the BOTTOM UP — the same
// build-front travelling the whole way, so the two screens read as one motion.
export default function LoginScreen() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [busy, setBusy]         = useState(false);
  // true while the card is dissolving away; drives <HoloDissolve>.
  const [leaving, setLeaving]   = useState(false);

  // The press only starts the dissolve — a bad email/password never gets an
  // animation, it gets an answer.
  function handleLogin() {
    if (busy) return;
    setError('');
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    setLeaving(true);
  }

  // Fired by <HoloDissolve> once the card is fully covered. Signing in only
  // AFTER the wipe is deliberate: the session flip unmounts this screen, so
  // racing it would cut the line off half way down. The card sits as empty
  // space for the round-trip, which is exactly what the landing card then
  // builds out of.
  async function onDissolved() {
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    // On success App swaps the screen out from under us; on failure we run the
    // dissolve backwards to hand the form back, and say why.
    if (authError) {
      setError(authError.message);
      setLeaving(false);
      setBusy(false);
    }
  }

  return (
    <ScreenFrame holoEntry={false} overlay={<HoloDissolve run={leaving} onDone={onDissolved} />}>
      <View style={styles.inner}>
        <View style={styles.hero}>
          <Text style={styles.logo}>{WORDMARK}</Text>
          <View style={styles.rule} />
        </View>

        <View style={styles.sectionHead}>
          <View style={styles.sectionBar} />
          <Text style={styles.sectionTitle}>SIGN IN</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.fieldLabel}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="you@email.com"
            placeholderTextColor={C.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            value={email}
            onChangeText={setEmail}
          />

          <Text style={styles.fieldLabel}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor={C.textMuted}
            autoCapitalize="none"
            secureTextEntry
            textContentType="password"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={handleLogin}
            returnKeyType="go"
          />

          {error ? (
            <View style={styles.errorBox}><Text style={styles.errorText}>⚠  {error}</Text></View>
          ) : null}

          <PillButton
            label={busy ? 'SIGNING IN…' : 'LOGIN'}
            onPress={handleLogin}
            loading={busy}
            variant="solid"
            tone="accent"
            size="lg"
            style={styles.loginBtn}
            textStyle={styles.loginBtnText}
          />
        </View>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  // The card is full-screen; centre the form in it (it is far shorter).
  inner: {
    width: '100%', maxWidth: 700, alignSelf: 'center',
    flexGrow: 1, justifyContent: 'center',
    paddingHorizontal: 34, paddingVertical: 48,
  },

  // ── Hero ──
  hero: { marginBottom: 46 },
  logo: {
    fontFamily: F.heading, fontSize: 56, color: C.iceGlow, letterSpacing: 9,
    textTransform: 'uppercase', textAlign: 'center',
    textShadowColor: 'rgba(74,158,191,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20,
  },
  rule: { height: 1, backgroundColor: C.iceGlow, opacity: 0.3, marginTop: 26 },

  // ── Section head (the app-wide bar + title) ──
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  sectionBar: {
    width: 6, height: 26, borderRadius: 2, backgroundColor: C.iceGlow,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 6,
  },
  sectionTitle: { fontFamily: F.heading, fontSize: 23, color: C.iceGlow, letterSpacing: 3 },

  // ── Form ──
  form: { width: '100%' },
  // Bolder and bigger than the app's usual field label — these two ARE the
  // screen, so they carry presence. Still a step under the section title (19).
  fieldLabel: {
    fontFamily: F.heading, fontSize: 21, color: C.text,
    letterSpacing: 3.5, textTransform: 'uppercase', marginBottom: 12, marginTop: 20,
  },
  input: {
    backgroundColor: C.bg, borderWidth: 2, borderColor: C.cardBorder, borderRadius: 14,
    paddingHorizontal: 20, paddingVertical: 20, fontFamily: F.body, fontSize: 21, color: C.text,
  },
  loginBtn: { marginTop: 34, paddingVertical: 22 },
  loginBtnText: { fontSize: 24, letterSpacing: 4 },

  errorBox: {
    marginTop: 18, backgroundColor: 'rgba(255,60,60,0.12)',
    borderWidth: 1.5, borderColor: '#FF4444', borderRadius: 10, padding: 14,
  },
  errorText: { fontFamily: F.bodyMed, fontSize: 16, color: '#FF6B6B', letterSpacing: 0.4, lineHeight: 23 },
});
