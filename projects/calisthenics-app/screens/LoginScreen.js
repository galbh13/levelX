import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Animated, Dimensions, Easing,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import ScreenFrame from '../components/ScreenFrame';
import { ShimmerText, ShimmerFill, BLUE } from '../components/Shimmer';
import DeviationOverlay from '../components/DeviationOverlay';
import BrickShatter from '../components/BrickShatter';
import ScatterCollapse from '../components/ScatterCollapse';
import { startVoid, stopVoid, playDeviation, playCollapse } from '../lib/glitchSound';

const WIN_H = Dimensions.get('window').height;

const PULSE = 2600;
const ICE_SHEEN = ['#1E5A7A', '#2E7DA3', '#4A9EBF', '#2E7DA3', '#1E5A7A'];

const DEV_MS = 240;            // how long one deviation lasts (matches the TV-switch SFX)
const MIN_GAP = 1500;          // shortest wait between deviations
const MAX_GAP = 6000;          // longest wait between deviations

// Full-spectrum datamosh palette — corrupted RGB channels (image reference).
const STREAK_PALETTE = [C.glitchCyan, C.deepBlue, C.glitchMagenta, C.glitchGreen, C.alarmRed, C.text];
const BAND_PALETTE   = [C.glitchCyan, C.glitchMagenta, C.alarmRed, C.text];

// SHARP shake: each step is an INSTANT snap (1ms) held for `hold` ms — never
// eased, so it cracks like a real system glitch.
function jitterSeq(val, amp, jumps, hold) {
  const seq = [];
  for (let i = 0; i < jumps; i++) {
    seq.push(Animated.timing(val, { toValue: (Math.random() - 0.5) * amp, duration: 1, useNativeDriver: true }));
    seq.push(Animated.delay(hold));
  }
  seq.push(Animated.timing(val, { toValue: 0, duration: 1, useNativeDriver: true }));
  return Animated.sequence(seq);
}

// FLICKER: opacity snaps between near-dark and near-full at random — a dying
// neon / failing-signal blink. Settles back to fully on (1).
function flickerSeq(val, jumps, hold) {
  const seq = [];
  for (let i = 0; i < jumps; i++) {
    const v = Math.random() < 0.5 ? 0.06 + Math.random() * 0.22 : 0.8 + Math.random() * 0.2;
    seq.push(Animated.timing(val, { toValue: v, duration: 1, useNativeDriver: true }));
    seq.push(Animated.delay(hold));
  }
  seq.push(Animated.timing(val, { toValue: 1, duration: 1, useNativeDriver: true }));
  return Animated.sequence(seq);
}

// GHOST: opacity blinks on/off at random for the RGB-split copies — they appear
// only mid-glitch and vanish (0) when stable.
function ghostSeq(val, jumps, hold) {
  const seq = [];
  for (let i = 0; i < jumps; i++) {
    const v = Math.random() < 0.4 ? 0 : 0.45 + Math.random() * 0.4;
    seq.push(Animated.timing(val, { toValue: v, duration: 1, useNativeDriver: true }));
    seq.push(Animated.delay(hold));
  }
  seq.push(Animated.timing(val, { toValue: 0, duration: 1, useNativeDriver: true }));
  return Animated.sequence(seq);
}

// A few thin VERTICAL streak-columns — some corrupted-signal hacking in the card.
function makeStreaks() {
  const n = 8 + Math.floor(Math.random() * 8); // 8–15
  return Array.from({ length: n }, () => ({
    left: `${Math.random() * 99}%`,
    w: 1 + Math.random() * 4,
    color: STREAK_PALETTE[Math.floor(Math.random() * STREAK_PALETTE.length)],
    op: 0.22 + Math.random() * 0.55,
  }));
}

// A couple of HORIZONTAL pixel-smear displacement bands.
function makeBands() {
  const n = 2 + Math.floor(Math.random() * 3); // 2–4
  return Array.from({ length: n }, () => ({
    top: `${Math.random() * 92}%`,
    h: 6 + Math.random() * 34,
    color: BAND_PALETTE[Math.floor(Math.random() * BAND_PALETTE.length)],
    op: 0.16 + Math.random() * 0.35,
  }));
}

export default function LoginScreen() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [busy, setBusy]         = useState(false);
  const [collapsing, setCollapsing] = useState(false);
  // measured boxes so each element's bricks line up exactly
  const [titleSize, setTitleSize] = useState(null);
  const [emailSize, setEmailSize] = useState(null);
  const [pwSize, setPwSize]       = useState(null);
  const [btnSize, setBtnSize]     = useState(null);
  const collapsingRef = useRef(false);
  const cardFallY = useRef(new Animated.Value(0)).current; // drops the empty shell off-screen
  const measure = (setter) => (e) => {
    const { width, height } = e.nativeEvent.layout;
    setter((prev) => prev || { width, height });
  };

  // ── Deviation engine ──
  const shakeX   = useRef(new Animated.Value(0)).current;
  const shakeY   = useRef(new Animated.Value(0)).current;
  const rot      = useRef(new Animated.Value(0)).current;
  const sliceOff = useRef(new Animated.Value(0)).current;
  const flash    = useRef(new Animated.Value(0)).current;
  const logoFlick = useRef(new Animated.Value(1)).current;
  const logoTx    = useRef(new Animated.Value(0)).current;  // title horizontal jitter
  const logoGhost = useRef(new Animated.Value(0)).current;  // RGB-split offset
  const logoGhostOp = useRef(new Animated.Value(0)).current; // ghost visibility
  const btnFlick  = useRef(new Animated.Value(1)).current;
  const btnTx      = useRef(new Animated.Value(0)).current;  // button horizontal jitter
  const btnGhost   = useRef(new Animated.Value(0)).current;  // button RGB-split offset
  const btnGhostOp = useRef(new Animated.Value(0)).current;  // button ghost visibility
  const [streaks, setStreaks] = useState([]);
  const [bands, setBands]     = useState([]);
  const mounted = useRef(true);

  const runDeviation = useCallback(() => {
    if (!mounted.current) return;
    playDeviation();                 // sound fired AT the deviation → 1:1, never independent

    flash.setValue(1);
    setStreaks(makeStreaks());
    setBands(makeBands());

    // Re-scramble the corrupted frame a few times across the deviation window.
    const scramble = setInterval(() => {
      if (!mounted.current) return;
      setStreaks(makeStreaks());
      setBands(makeBands());
    }, 45);

    // Sharp whole-page shake + sideways stripe shear.
    Animated.parallel([
      jitterSeq(shakeX, 16, 8, 22),
      jitterSeq(shakeY, 11, 8, 22),
      jitterSeq(rot, 1, 8, 22),
      jitterSeq(sliceOff, 22, 8, 22),
    ]).start();

    setTimeout(() => {
      clearInterval(scramble);
      if (!mounted.current) return;
      flash.setValue(0);
      setStreaks([]);
      setBands([]);
    }, DEV_MS);
  }, [shakeX, shakeY, rot, sliceOff, flash]);

  // Special deviation: the TITLE destabilizes — RGB channel-split ghosts tear
  // apart, the whole word jitters sideways, and its brightness stutters, so the
  // title structure looks unstable. The button flickers along. TV-switch sound, 1:1.
  const runFlicker = useCallback(() => {
    if (!mounted.current) return;
    playDeviation();
    const jumps = 12, hold = 20;
    Animated.parallel([
      flickerSeq(logoFlick, jumps, hold),     // title brightness instability
      jitterSeq(logoTx, 12, jumps, hold),     // the word jolts sideways
      jitterSeq(logoGhost, 16, jumps, hold),  // chromatic split widens/narrows
      ghostSeq(logoGhostOp, jumps, hold),     // ghosts blink in mid-glitch
      flickerSeq(btnFlick, jumps, hold),      // button brightness instability
      jitterSeq(btnTx, 10, jumps, hold),      // button jolts sideways
      jitterSeq(btnGhost, 14, jumps, hold),   // button chromatic split
      ghostSeq(btnGhostOp, jumps, hold),      // button ghosts blink in
      jitterSeq(shakeX, 9, jumps, hold),
      jitterSeq(shakeY, 6, jumps, hold),
    ]).start();
  }, [logoFlick, logoTx, logoGhost, logoGhostOp, btnFlick, btnTx, btnGhost, btnGhostOp, shakeX, shakeY]);

  // Random 1.5–6s loop + the black-hole void drone underneath. Each tick picks a
  // deviation variant: mostly the datamosh glitch, sometimes the flicker.
  useEffect(() => {
    mounted.current = true;
    let t;
    startVoid();
    const tick = () => {
      if (!mounted.current) return;
      if (!collapsingRef.current) {        // hold idle deviations during the intro
        if (Math.random() < 0.35) runFlicker();
        else runDeviation();
      }
      t = setTimeout(tick, MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP));
    };
    t = setTimeout(tick, MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP));
    return () => { mounted.current = false; clearTimeout(t); stopVoid(); };
  }, [runDeviation, runFlicker]);

  // Login intro: the CARD shatters into pixels in place (heavy shake + crash),
  // then the whole card drops off the bottom of the screen, revealing the next
  // screen. We sign in once it's fallen away.
  function handleLogin() {
    if (busy) return;
    setError('');
    setBusy(true);
    collapsingRef.current = true;
    playCollapse();
    setCollapsing(true);                 // every element shatters into bricks

    // Phase 1: violent shake while the card crumbles brick by brick.
    Animated.parallel([
      jitterSeq(shakeX, 30, 26, 26),
      jitterSeq(shakeY, 24, 26, 26),
      jitterSeq(rot, 1.5, 26, 26),
    ]).start();

    // Phase 2: once it's crumbled, drop the empty shell off-screen.
    setTimeout(() => {
      if (!mounted.current) return;
      Animated.parallel([
        Animated.timing(cardFallY, {
          toValue: WIN_H * 1.2, duration: 720, easing: Easing.in(Easing.cubic), useNativeDriver: true,
        }),
        jitterSeq(shakeX, 16, 12, 26),
        jitterSeq(shakeY, 12, 12, 26),
      ]).start(() => onCollapseDone());
    }, 780);
  }

  async function onCollapseDone() {
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      // failed — restore the screen so they can retry
      setError(authError.message);
      setCollapsing(false);
      collapsingRef.current = false;
      cardFallY.setValue(0);
      setBusy(false);
    }
    // success → the app swaps screens while the card is off-screen
  }

  const rotate = rot.interpolate({ inputRange: [-1, 1], outputRange: ['-3deg', '3deg'] });
  const logoGhostNeg = Animated.multiply(logoGhost, -1);
  const btnGhostNeg  = Animated.multiply(btnGhost, -1);

  return (
    <Animated.View style={[styles.root, { transform: [{ translateX: shakeX }, { translateY: shakeY }, { rotate }] }]}>
      {/* urgent debris collapsing across the whole screen, behind the card */}
      {collapsing && <ScatterCollapse />}
      <Animated.View style={[styles.fallWrap, { transform: [{ translateY: cardFallY }] }]}>
      <ScreenFrame
        maxWidth={680}
        duration={PULSE}
        shatter={collapsing}
        overlay={
          <DeviationOverlay opacity={flash} streaks={streaks} bands={bands} sliceOff={sliceOff} />
        }
      >
        <View style={styles.inner}>
          {/* Logo — RGB-split ghosts on deviation; shatters into falling bricks on login */}
          <Animated.View
            style={[styles.logoWrap, { transform: [{ translateX: logoTx }] }]}
            onLayout={measure(setTitleSize)}
          >
            {collapsing && titleSize ? (
              <BrickShatter width={titleSize.width} height={titleSize.height} cols={12} rows={3}>
                <Text style={[styles.logo, styles.shatterTitle]}>LevelX</Text>
              </BrickShatter>
            ) : (
              <>
                <Animated.Text style={[styles.logo, styles.logoGhostCyan, { opacity: logoGhostOp, transform: [{ translateX: logoGhost }] }]}>
                  LevelX
                </Animated.Text>
                <Animated.Text style={[styles.logo, styles.logoGhostRed, { opacity: logoGhostOp, transform: [{ translateX: logoGhostNeg }] }]}>
                  LevelX
                </Animated.Text>
                <Animated.View style={{ opacity: logoFlick }}>
                  <ShimmerText text="LevelX" style={styles.logo} colors={BLUE} duration={PULSE} active />
                </Animated.View>
              </>
            )}
          </Animated.View>

          {/* Inputs */}
          <View style={styles.form}>
            {collapsing && emailSize ? (
              <BrickShatter width={emailSize.width} height={emailSize.height} cols={11} rows={2} startDelay={90}>
                <View style={[styles.input, styles.fieldGhost]}>
                  <Text style={styles.fieldGhostText} numberOfLines={1}>{email || 'Email'}</Text>
                </View>
              </BrickShatter>
            ) : (
              <TextInput
                style={styles.input}
                onLayout={measure(setEmailSize)}
                placeholder="Email"
                placeholderTextColor={C.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
            )}

            {collapsing && pwSize ? (
              <BrickShatter width={pwSize.width} height={pwSize.height} cols={11} rows={2} startDelay={150}>
                <View style={[styles.input, styles.fieldGhost]}>
                  <Text style={styles.fieldGhostText} numberOfLines={1}>{password ? '•'.repeat(password.length) : 'Password'}</Text>
                </View>
              </BrickShatter>
            ) : (
              <TextInput
                style={styles.input}
                onLayout={measure(setPwSize)}
                placeholder="Password"
                placeholderTextColor={C.textMuted}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {collapsing && btnSize ? (
              <BrickShatter width={btnSize.width} height={btnSize.height} cols={11} rows={2} startDelay={210}>
                <View style={[styles.button, styles.btnGhost]}>
                  <View style={[styles.buttonFill, styles.btnSolidFill]} />
                  <Text style={styles.buttonText}>Login</Text>
                </View>
              </BrickShatter>
            ) : (
              <TouchableOpacity
                style={[styles.button, busy && styles.buttonDisabled]}
                onLayout={measure(setBtnSize)}
                onPress={handleLogin}
                disabled={busy}
                activeOpacity={0.85}
              >
                <Animated.View style={[styles.btnFlickerWrap, { opacity: btnFlick, transform: [{ translateX: btnTx }] }]}>
                  <ShimmerFill style={styles.buttonFill} colors={ICE_SHEEN} duration={PULSE} active />
                  <View style={styles.btnTextStack}>
                    <Animated.Text style={[styles.buttonText, styles.btnGhostCyan, { opacity: btnGhostOp, transform: [{ translateX: btnGhost }] }]}>Login</Animated.Text>
                    <Animated.Text style={[styles.buttonText, styles.btnGhostRed, { opacity: btnGhostOp, transform: [{ translateX: btnGhostNeg }] }]}>Login</Animated.Text>
                    <Text style={styles.buttonText}>Login</Text>
                  </View>
                </Animated.View>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </ScreenFrame>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  fallWrap: { flex: 1 },

  inner: { width: '100%', alignItems: 'center', paddingHorizontal: 52, paddingVertical: 74 },
  logoWrap: { marginBottom: 52 },
  logo: {
    fontFamily: F.heading, fontSize: 84, color: C.iceGlow, letterSpacing: 9, textTransform: 'uppercase',
    textShadowColor: 'rgba(74,158,191,0.55)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 30,
  },
  // RGB-split ghost copies — sit exactly over the real title, invisible until a
  // deviation blinks them in and shears them apart.
  logoGhostCyan: { position: 'absolute', left: 0, right: 0, textAlign: 'center', color: C.glitchCyan },
  logoGhostRed:  { position: 'absolute', left: 0, right: 0, textAlign: 'center', color: C.alarmRed },
  form: { width: '100%', gap: 22 },
  input: {
    width: '100%', height: 92, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.cardBorder,
    borderRadius: 16, paddingHorizontal: 28, fontFamily: F.body, fontSize: 26, color: C.text,
  },
  // Static copies used by the shatter (real look, sliced into bricks).
  shatterTitle: { color: C.iceGlow },
  fieldGhost: { height: '100%', justifyContent: 'center' },
  fieldGhostText: { fontFamily: F.body, fontSize: 26, color: C.text },
  btnGhost: { height: '100%' },
  btnSolidFill: { backgroundColor: C.iceGlow },
  error: { fontFamily: F.body, fontSize: 15, color: '#FF6B6B', textAlign: 'center' },

  button: {
    width: '100%', height: 80, borderRadius: 14, overflow: 'hidden',
    justifyContent: 'center', alignItems: 'center', marginTop: 10,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.55, shadowRadius: 18,
  },
  btnFlickerWrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  btnTextStack: { justifyContent: 'center', alignItems: 'center' },
  buttonFill: { ...StyleSheet.absoluteFillObject },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    fontFamily: F.heading, fontSize: 23, color: C.bg, letterSpacing: 5, textTransform: 'uppercase',
    textShadowColor: 'rgba(5,9,18,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
  // RGB-split ghost copies of the button label — over the real text, hidden until
  // a deviation blinks them in and shears them apart.
  btnGhostCyan: { position: 'absolute', left: 0, right: 0, textAlign: 'center', color: C.glitchCyan },
  btnGhostRed:  { position: 'absolute', left: 0, right: 0, textAlign: 'center', color: C.alarmRed },
});
