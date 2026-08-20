/**
 * iOS 26 Liquid Glass 卡片（无原生 backdrop-filter 时的纯色 + 内描边 + 微阴影模拟）
 * - 玻璃表面：半透明 + 1px 内描边模拟透光感
 * - 双主题：跟随 usePalette 自动切换 light/dark
 * - 强/弱两种强度
 *
 * 注：原生 blur 需要 expo-blur 之类的原生包。本工程刻意不装新依赖，
 *     Android 上用纯色 + innerStroke 渲染出"近似"玻璃感，效果优于毛玻璃模糊，且 0 性能开销。
 */
import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { usePalette, radiiAlias, makeShadows } from '../theme';
import { spacing } from '../theme/spacing';

export interface GlassCardProps {
  children?: React.ReactNode;
  /** 强玻璃（更高不透明度，背景模糊场景下需要看清文字） */
  strong?: boolean;
  /** 自定义 padding */
  padding?: number;
  /** 自定义圆角，默认 card (16) */
  radius?: number;
  style?: StyleProp<ViewStyle>;
  /** 内部强制染色（慎用） */
  tint?: 'pink' | 'plain';
}

export function GlassCard({
  children,
  strong = false,
  padding = spacing.md,
  radius = radiiAlias.card,
  style,
  tint = 'plain',
}: GlassCardProps) {
  const palette = usePalette();
  const shadows = makeShadows(palette.name === 'dark');
  const surface = strong ? palette.surfaceGlassStrong : palette.surfaceGlass;
  const bg = tint === 'pink' && palette.name === 'dark' ? 'rgba(28,28,30,0.78)' : surface;
  return (
    <View
      style={[
        styles.card,
        shadows.sm,
        {
          backgroundColor: bg,
          borderRadius: radius,
          borderColor: palette.innerStroke,
          padding,
        },
        style,
      ]}
    >
      {/* 1px 内描边 + 顶部高光，营造"玻璃边缘" */}
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.innerStroke }]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
});
