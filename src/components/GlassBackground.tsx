/**
 * GlassBackground · 真液态玻璃背景层（absoluteFill）
 *
 * 用法：作为卡片背景层插入（父容器需 backgroundColor: 'transparent' + 圆角/overflow）：
 *   <View style={[styles.card, { backgroundColor: 'transparent' }]}>
 *     <GlassBackground radius={20} refract={false} />
 *     ...原内容...
 *   </View>
 *
 * 为什么玻璃只做背景层：原生玻璃视图不承载 RN 布局（flexDirection/padding 会失效），
 * 布局仍由外层 View 负责。
 *
 * 分级（Apple 材质原则 + 库每帧 backdrop 采样成本）：
 *  - refract=false 列表卡：磨砂更实 + 边缘光清楚（关折射，避免多份 shader 掉帧）
 *  - refract=true  浮层/大容器：完整折射 + 色散
 */
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { LiquidGlassView, LIQUID_GLASS_FROSTED } from '@uginy/react-native-liquid-glass';
import { usePalette } from '../theme';

export interface GlassBackgroundProps {
  radius?: number;
  /** 强玻璃（浮层/需更强可读性） */
  strong?: boolean;
  /** 是否开启真折射（列表卡关闭以省性能） */
  refract?: boolean;
}

const isGlassPlatform = Platform.OS === 'android' || Platform.OS === 'ios';

export function GlassBackground({ radius = 20, strong = false, refract = true }: GlassBackgroundProps) {
  const palette = usePalette();
  const isDark = palette.name === 'dark';
  const listMode = !refract;

  if (!isGlassPlatform) {
    return (
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: palette.surfaceGlassStrong }]}
      />
    );
  }

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* 保底层：AGSL 在部分设备/模拟器不渲染（GPU 限制），这层纯 RN 材质保证
          「任何设备都看得见玻璃」——半透明材质 + 顶部高光 + 边缘描边 */}
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: radius,
            backgroundColor: listMode
              ? isDark ? 'rgba(38,38,44,0.14)' : 'rgba(255,255,255,0.12)'
              : isDark ? 'rgba(30,30,36,0.10)' : 'rgba(255,255,255,0.08)',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.75)',
          },
        ]}
      />
      {/* 顶部高光：必须用渐变，硬边界会在卡片中间形成一条横线（用户已报） */}
      <LinearGradient
        colors={
          isDark
            ? ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.02)', 'rgba(255,255,255,0)']
            : ['rgba(255,255,255,0.34)', 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0)']
        }
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
      />
      <LiquidGlassView
      {...LIQUID_GLASS_FROSTED}
      cornerRadius={radius}
      blurRadius={listMode ? 30 : strong ? 20 : 26}
      refractionStrength={refract ? (strong ? 0.14 : 0.1) : 0}
      chromaticAberration={refract ? (strong ? 0.12 : 0.09) : 0.03}
      edgeGlowIntensity={listMode ? 0.9 : strong ? 0.85 : 0.6}
      edgeWidth={listMode ? 2.6 : strong ? 2.6 : 2.0}
      glassOpacity={listMode ? 0.42 : strong ? 0.16 : 0.1}
      tintColor={isDark ? '#1b1b21' : '#ffffff'}
      saturation={listMode ? 0.78 : 1}
      brightness={listMode ? 1.14 : 1}
      glareIntensity={listMode ? 0.28 : strong ? 0.4 : 0.3}
      style={StyleSheet.absoluteFill as never}
      />
    </View>
  );
}
