import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

// Springy pop-in for a checkmark (or any small "done" glyph). Mount it only when
// the item flips to done — it scales up from small with a little overshoot, so
// ticking things off feels like it lands. Native-driver only.
export default function PopCheck({ children, style }) {
  const scale = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1, useNativeDriver: true, speed: 22, bounciness: 14,
    }).start();
  }, [scale]);
  return (
    <Animated.View style={[style, { transform: [{ scale }] }]}>
      {children}
    </Animated.View>
  );
}
