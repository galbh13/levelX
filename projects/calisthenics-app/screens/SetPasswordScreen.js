import { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { clearMustChangePassword } from '../lib/invites';
import ScreenFrame from '../components/ScreenFrame';
import PillButton from '../components/PillButton';
import { C } from '../constants/colors';
import { F } from '../constants/fonts';

// The gate every invited player passes through exactly once.
//
// Invites hand out a SHARED starter password (see supabase/functions/invite-player),
// so it must not survive first contact: the account is created with
// `profiles.must_change_password = true`, and App.js renders this screen INSTEAD of
// the app until the flag clears. There is no skip and no back — the only ways out
// are setting a password or signing out.

const MIN_LEN = 8;

export default function SetPasswordScreen({ userId, onDone }) {
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState('');

  const tooShort = password.length > 0 && password.length < MIN_LEN;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = password.length >= MIN_LEN && confirm === password && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      const { error: authErr } = await supabase.auth.updateUser({ password });
      if (authErr) throw authErr;

      // Only clear the flag once the password actually changed — a failed
      // clear would otherwise let them in still holding the shared password.
      await clearMustChangePassword(userId);
      onDone();
    } catch (e) {
      setError(e?.message || 'Could not set your password. Try again.');
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <ScreenFrame maxWidth={560} duration={5200}>
          <View style={styles.card}>
            <Text style={styles.kicker}>FIRST LOGIN</Text>
            <Text style={styles.title}>SET YOUR PASSWORD</Text>
            <View style={styles.rule} />

            <Text style={styles.body}>
              The password you were emailed is a one-time starter that everyone
              receives. Choose your own now — at least {MIN_LEN} characters.
            </Text>

            <Text style={styles.label}>NEW PASSWORD</Text>
            <TextInput
              style={[styles.input, tooShort && styles.inputBad]}
              value={password}
              onChangeText={setPassword}
              placeholder={`At least ${MIN_LEN} characters`}
              placeholderTextColor={C.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />

            <Text style={styles.label}>CONFIRM PASSWORD</Text>
            <TextInput
              style={[styles.input, mismatch && styles.inputBad]}
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Type it again"
              placeholderTextColor={C.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onSubmitEditing={submit}
            />

            {tooShort ? <Text style={styles.hint}>Too short — {MIN_LEN} characters minimum.</Text> : null}
            {mismatch ? <Text style={styles.hint}>Those two do not match.</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <PillButton
              label="ENTER THE SYSTEM"
              onPress={submit}
              disabled={!canSubmit}
              loading={busy}
              size="lg"
              style={styles.submit}
            />

            <PillButton
              label="SIGN OUT"
              onPress={() => supabase.auth.signOut()}
              tone="muted"
              size="sm"
              disabled={busy}
              style={styles.signOut}
            />
          </View>
        </ScreenFrame>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1, justifyContent: 'center' },
  card:   { paddingHorizontal: 32, paddingVertical: 40 },

  kicker: {
    fontFamily: F.heading,
    fontSize: 12,
    color: C.deepBlue,
    letterSpacing: 5,
    textAlign: 'center',
    marginBottom: 10,
  },
  title: {
    fontFamily: F.heading,
    fontSize: 30,
    color: C.text,
    letterSpacing: 4,
    textAlign: 'center',
  },
  rule: {
    height: 2,
    backgroundColor: C.cardBorder,
    marginTop: 18,
    marginBottom: 22,
  },
  body: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    lineHeight: 22,
    color: C.textMuted,
    textAlign: 'center',
    marginBottom: 28,
  },
  label: {
    fontFamily: F.heading,
    fontSize: 11,
    color: C.deepBlue,
    letterSpacing: 2.5,
    marginBottom: 8,
  },
  input: {
    backgroundColor: C.surface,
    borderWidth: 1.5,
    borderColor: C.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: F.body,
    fontSize: 16,
    color: C.text,
    marginBottom: 18,
  },
  inputBad: { borderColor: C.alarmRed },
  hint: {
    fontFamily: F.body,
    fontSize: 13,
    color: C.alarmRed,
    marginBottom: 12,
  },
  error: {
    fontFamily: F.body,
    fontSize: 13,
    color: C.alarmRed,
    marginBottom: 12,
  },
  submit:  { marginTop: 10 },
  signOut: { marginTop: 16, alignSelf: 'center' },
});
