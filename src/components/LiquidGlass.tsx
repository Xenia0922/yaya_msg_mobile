/**
 * LiquidGlass · 液态玻璃材质卡
 *
 * 现在使用真·液态玻璃原生库 @uginy/react-native-liquid-glass：
 *  - Android：AGSL GPU shader —— 真折射 / 色散 / 边缘辉光 / 眩光（API 33+；以下自动降级）
 *  - New Architecture（Fabric）· Expo Module 自动链接
 *
 * 设计约定（来自库文档的关键约束）：
 *  「玻璃后面必须有细节」——折射弯曲平坦颜色等于没效果，因此全站底衬使用
 *  PageBackdrop 的渐变 + 光斑（提供高频细节），玻璃卡才会真正「液态」。
 */
import React, { useRef } from 'react';
import { Animated, Easing, Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import {
  LiquidGlassView,
  LIQUID_GLASS_FROSTED,
  LIQUID_GLASS_CRYSTAL,
} from '@uginy/react-native-liquid-glass';
import { usePalette } from '../theme';
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

const isGlassPlatform = Platform.OS === 'android' || Platform.OS === 'ios';

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
  const palette = usePalette();
  const pressed = useRef(new Animated.Value(0)).current;
  const isDark = palette.name === 'dark';

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

  // 预置材质：常规卡用 FROSTED（磨砂），强卡用更高玻璃不透明度 + 更强边缘辉光
  const preset = strong ? LIQUID_GLASS_CRYSTAL : LIQUID_GLASS_FROSTED;

  return (
    <Animated.View
      style={[styles.wrap, { borderRadius: radius }, animStyle, style]}
      onTouchStart={() => { if (interactive) { pressTo(1, 120); onPressIn?.(); } }}
      onTouchEnd={() => { if (interactive) { pressTo(0, 150); onPressOut?.(); } }}
      onTouchCancel={() => { if (interactive) { pressTo(0, 150); onPressOut?.(); } }}
    >
      {isGlassPlatform ? (
        <LiquidGlassView
          {...preset}
          cornerRadius={radius}
          blurRadius={strong ? 24 : 16}
          refractionStrength={strong ? 0.16 : 0.2}
          chromaticAberration={strong ? 0.14 : 0.18}
          edgeGlowIntensity={strong ? 0.85 : 1.0}
          edgeWidth={strong ? 2.4 : 2.8}
          glassOpacity={strong ? 0.14 : 0.07}
          glareIntensity={strong ? 0.45 : 0.5}
          tintColor={isDark ? '#15151a' : '#ffffff'}
          style={StyleSheet.absoluteFill as never}
        />
      ) : (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: palette.surfaceGlassStrong }]}
        />
      )}
      <View style={{ padding }}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // 库自带阴影/边缘处理，这里只保证圆角裁剪与浮起
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 3,
  },
  glass: {
    overflow: 'hidden',
  },
});
