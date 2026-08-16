/**
 * AppToast · iOS 26 banner 风格
 *  - 顶部悬浮，玻璃圆角胶囊
 *  - Spring 入场 / 退场
 *  - 最大 2 行，消失后保留最末一段
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from '../hooks/useSafeAreaInsets';
import { useUiStore } from '../store';
import { usePalette, radii } from '../theme';
import { typography } from '../theme/typography';
import { motion } from '../theme/motion';

export default function AppToast() {
  const message = useUiStore((state) => state.toastMessage);
  const hideToast = useUiStore((state) => state.hideToast);
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const ty = useRef(new Animated.Value(40)).current;
  const op = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) {
      Animated.parallel([
        Animated.timing(ty, { toValue: 40, duration: motion.duration.fast, useNativeDriver: true }),
        Animated.timing(op, { toValue: 0, duration: motion.duration.fast, useNativeDriver: true }),
      ]).start();
      return;
    }
    Animated.parallel([
      Animated.spring(ty, { toValue: 0, ...motion.spring.bouncy, useNativeDriver: true }),
      Animated.timing(op, { toValue: 1, duration: motion.duration.base, useNativeDriver: true }),
    ]).start();
    const t = setTimeout(() => hideToast(), 2200);
    return () => clearTimeout(t);
  }, [hideToast, message, op, ty]);

  if (!message) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.outer,
        {
          top: Math.max(insets.top, 14) + 4,
          opacity: op,
          transform: [{ translateY: ty }],
        },
      ]}
    >
      <Animated.View
        style={[
          styles.pill,
          {
            backgroundColor:
              palette.name === 'dark' ? 'rgba(40,40,42,0.86)' : 'rgba(20,20,22,0.86)',
            borderColor: 'rgba(255,255,255,0.08)',
          },
        ]}
      >
        <Text
          numberOfLines={2}
          style={[
            typography.subhead,
            { color: '#FFFFFF', fontWeight: '600', textAlign: 'center' },
          ]}
        >
          {message}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
    left: 24,
    right: 24,
    zIndex: 9999,
    alignItems: 'center',
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '100%',
  },
});
