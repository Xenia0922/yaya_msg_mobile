/**
 * LiquidGlass · 液态玻璃材质卡
 *
 * 保留原 API（children / strong / padding / radius / style / interactive /
 * onPressIn / onPressOut），实现改走 GlassSurface（引擎换为
 * react-native-liquid-glassmorphism：iOS 26 原生 UIGlassEffect / Android AGSL 真折射）。
 *
 * 结构：外层 Animated.View 负责布局与按压缩放，玻璃只做绝对定位的底层（asBackground）——
 * 原生玻璃视图不承载 RN 布局，flex/padding 交给外层。
 */
import React, { useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { GlassSurface } from './GlassSurface';
import { spacing } from '../theme/spacing';

export interface LiquidGlassProps {
  children?: React.ReactNode;
  /** 强玻璃（更厚更亮，保证文字可读） */
  strong?: boolean;
  padding?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  /** 按压时材质微沉浸（默认开） */
  interactive?: boolean;
  onPressIn?: () => void;
  onPressOut?: () => void;
}

export function LiquidGlass({
  children,
  strong = false,
  padding = spacing.md,
  radius = 20,
  style,
  interactive = true,
  onPressIn,
  onPressOut,
}: LiquidGlassProps) {
  const pressed = useRef(new Animated.Value(0)).current;

  const pressTo = (toValue: number, duration: number) => {
    Animated.timing(pressed, {
      toValue,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const animStyle = {
    transform: [{
      scale: pressed.interpolate({ inputRange: [0, 1], outputRange: [1, 0.98] }),
    }],
  };

  return (
    <Animated.View
      style={[styles.wrap, { borderRadius: radius }, animStyle, style]}
      onTouchStart={() => { if (interactive) { pressTo(1, 120); onPressIn?.(); } }}
      onTouchEnd={() => { if (interactive) { pressTo(0, 150); onPressOut?.(); } }}
      onTouchCancel={() => { if (interactive) { pressTo(0, 150); onPressOut?.(); } }}
    >
      <GlassSurface role={strong ? 'card' : 'chip'} radius={radius} asBackground />
      <View style={{ padding }}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // 圆角裁剪与浮起由外层负责，玻璃自己不做阴影
    overflow: 'hidden',
    elevation: 3,
  },
});
