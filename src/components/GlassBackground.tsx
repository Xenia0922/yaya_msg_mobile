/**
 * GlassBackground · 真液态玻璃背景层（absoluteFill）
 *
 * 用法：作为卡片的背景层插入（父容器需 backgroundColor: 'transparent' + overflow hidden）：
 *   <View style={[styles.card, { backgroundColor: 'transparent' }]}>
 *     <GlassBackground radius={20} />
 *     ...原内容...
 *   </View>
 *
 * 为什么不直接替换成 LiquidGlassView 容器：原生玻璃视图不承载 RN 布局
 * （flexDirection/padding 等会失效），因此玻璃只做背景层，布局仍由外层 View 负责。
 *
 * 性能分级（Apple 材质原则 + 库的每帧 backdrop 采样成本）：
 *  - variant="card"   列表卡：磨砂 + 边缘光，关闭折射（数量多，避免每帧多份 shader）
 *  - variant="float"  浮层/大容器/tab bar：完整折射 + 色散
 */
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { LiquidGlassView, LIQUID_GLASS_FROSTED } from '@uginy/react-native-liquid-glass';
import { usePalette } from '../theme';

export interface GlassBackgroundProps {
  radius?: number;
  /** 强玻璃（浮层/需要更强可读性时） */
  strong?: boolean;
  /** 是否开启真折射（列表卡关闭以省性能） */
  refract?: boolean;
}

const isGlassPlatform = Platform.OS === 'android' || Platform.OS === 'ios';

export function GlassBackground({ radius = 20, strong = false, refract = true }: GlassBackgroundProps) {
  const palette = usePalette();
  const isDark = palette.name === 'dark';

  if (!isGlassPlatform) {
    return (
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: palette.surfaceGlassStrong }]}
      />
    );
  }

  return (
    <LiquidGlassView
      {...LIQUID_GLASS_FROSTED}
      cornerRadius={radius}
      blurRadius={refract ? (strong ? 20 : 26) : 30}
      refractionStrength={refract ? (strong ? 0.14 : 0.1) : 0}
      chromaticAberration={refract ? (strong ? 0.12 : 0.09) : 0.02}
      edgeGlowIntensity={strong ? 0.85 : 0.6}
      edgeWidth={strong ? 2.6 : 2.0}
      glassOpacity={strong ? 0.16 : 0.1}
      glareIntensity={strong ? 0.4 : 0.3}
      tintColor={isDark ? '#1b1b21' : '#ffffff'}
      style={StyleSheet.absoluteFill as never}
    />
  );
}
