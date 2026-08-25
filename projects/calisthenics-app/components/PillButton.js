import { TouchableOpacity, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { F } from '../constants/fonts';

// Glowing "ice pill" button — the shared primary/secondary action used across the
// player workout screens, matching the Gallery's BACK / + NEW pills.
//   variant: 'outline' (tinted bg + colored text, default) | 'solid' (filled bg + dark text)
//   tone:    accent | gold | green | danger | jade | muted
//   size:    sm | md | lg
const TONE = {
  accent: '#4A9EBF',
  gold:   '#FFD700',
  green:  '#4CAF50',
  danger: '#FF4444',
  jade:   '#1FD79A',
  muted:  '#4a6a8a',
};
const TINT = {
  accent: 'rgba(74,158,191,0.10)',
  gold:   'rgba(255,215,0,0.10)',
  green:  'rgba(76,175,80,0.12)',
  danger: 'rgba(255,68,68,0.10)',
  jade:   'rgba(31,215,154,0.12)',
  muted:  'rgba(74,106,138,0.10)',
};
const SIZE = {
  sm: { paddingVertical: 8,  paddingHorizontal: 16, fontSize: 15 },
  md: { paddingVertical: 12, paddingHorizontal: 22, fontSize: 17 },
  lg: { paddingVertical: 16, paddingHorizontal: 26, fontSize: 20 },
};

export default function PillButton({
  label, onPress, variant = 'outline', tone = 'accent', size = 'md',
  disabled = false, loading = false, style, textStyle,
}) {
  const color = TONE[tone] ?? TONE.accent;
  const solid = variant === 'solid';
  const s = SIZE[size] ?? SIZE.md;
  const inactive = disabled || loading;

  return (
    <TouchableOpacity
      onPress={inactive ? undefined : onPress}
      activeOpacity={0.85}
      disabled={inactive}
      style={[
        styles.base,
        {
          paddingVertical: s.paddingVertical,
          paddingHorizontal: s.paddingHorizontal,
          borderColor: color,
          backgroundColor: solid ? color : TINT[tone] ?? TINT.accent,
          shadowColor: color,
        },
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={solid ? '#050912' : color} size="small" />
      ) : (
        <Text
          style={[styles.label, { color: solid ? '#050912' : color, fontSize: s.fontSize }, textStyle]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 999,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
  disabled: { opacity: 0.4 },
  label: {
    fontFamily: F.heading,
    letterSpacing: 2,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
});
