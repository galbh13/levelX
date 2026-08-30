import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, Animated } from 'react-native';
import { F } from '../constants/fonts';
import PillButton from './PillButton';
import { ShimmerFrame, BLUE } from './Shimmer';

// ─── In-app confirm dialog ──────────────────────────────────────────────────────
// The system's own voice, not the OS's. Alert.alert / window.confirm dropped a
// grey Android box (or a browser bar) on top of the app and broke the fiction —
// so this is the DAILY QUESTS panel in dialog form: dim backdrop, ice-glow frame,
// drag handle, spaced heading. Same pop-in, same palette, works on web + native.
//
//   <SystemConfirm
//     visible={...} title="START NEW CHECK-UP" message="…"
//     confirmLabel="START NEW" onConfirm={fn} onCancel={fn}
//   />
const SL = {
  panel:  '#0a1322',
  border: '#1a3a5c',
  accent: '#4A9EBF',
  text:   '#E8F4FF',
  muted:  '#8FB4CC',
};

export default function SystemConfirm({
  visible,
  title,
  message,
  confirmLabel = 'CONFIRM',
  cancelLabel  = 'CANCEL',
  tone = 'accent',
  onConfirm,
  onCancel,
}) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) { anim.setValue(0); return; }
    Animated.spring(anim, {
      toValue: 1, useNativeDriver: true, friction: 7, tension: 70,
    }).start();
  }, [visible, anim]);

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        {/* Tap-outside cancels — same escape the quest panel gives. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />

        <Animated.View
          style={[
            styles.frameOuter,
            {
              opacity: anim,
              transform: [
                { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
                { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) },
              ],
            },
          ]}
        >
          <View style={styles.contentClip}>
            <View style={styles.handle} />
            {!!title && <Text style={styles.title}>{title}</Text>}
            {!!message && <Text style={styles.message}>{message}</Text>}

            <View style={styles.actions}>
              <PillButton
                label={confirmLabel}
                onPress={onConfirm}
                variant="solid"
                tone={tone}
                size="md"
              />
              <PillButton
                label={cancelLabel}
                onPress={onCancel}
                variant="outline"
                tone="muted"
                size="md"
                style={{ marginTop: 10 }}
              />
            </View>
          </View>

          {/* Live ice-glow border — the panel's signature. */}
          <ShimmerFrame
            style={styles.border}
            colors={BLUE}
            radius={24}
            thickness={2.5}
            duration={4200}
            active
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(2,5,12,0.84)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  frameOuter: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 24,
    shadowColor: SL.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 30,
    elevation: 26,
  },
  contentClip: {
    width: '100%',
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: SL.panel,
    paddingHorizontal: 26,
    paddingTop: 16,
    paddingBottom: 24,
  },
  border: { ...StyleSheet.absoluteFillObject, borderRadius: 24 },

  handle: {
    alignSelf: 'center',
    width: 48, height: 4, borderRadius: 2,
    backgroundColor: SL.border,
    marginBottom: 18,
  },
  title: {
    fontFamily: F.heading,
    fontSize: 22,
    color: '#FFFFFF',
    letterSpacing: 3.5,
    textAlign: 'center',
  },
  message: {
    fontFamily: F.body,
    fontSize: 15,
    lineHeight: 23,
    letterSpacing: 0.3,
    color: SL.muted,
    textAlign: 'center',
    marginTop: 14,
  },
  actions: { marginTop: 24 },
});
