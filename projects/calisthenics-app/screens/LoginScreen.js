import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';

export default function LoginScreen() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleLogin() {
    setError('');
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) setError(authError.message);
    setLoading(false);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        {/* Logo */}
        <Text style={styles.logo}>LevelX</Text>
        <Text style={styles.tagline}>Train like a warrior</Text>

        {/* Inputs */}
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={C.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={C.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.buttonText}>Login</Text>
            }
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  logo: {
    fontFamily: F.heading,
    fontSize: 52,
    color: C.iceGlow,
    letterSpacing: 6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  tagline: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: C.textMuted,
    letterSpacing: 4,
    textTransform: 'uppercase',
    marginBottom: 48,
  },
  form: {
    width: '100%',
    gap: 14,
  },
  input: {
    width: '100%',
    height: 52,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderRadius: 8,
    paddingHorizontal: 16,
    fontFamily: F.body,
    fontSize: 14,
    color: C.text,
  },
  error: {
    fontFamily: F.body,
    fontSize: 12,
    color: '#ff4d4d',
    textAlign: 'center',
  },
  button: {
    width: '100%',
    height: 52,
    backgroundColor: C.iceGlow,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontFamily: F.heading,
    fontSize: 14,
    color: '#fff',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
});
