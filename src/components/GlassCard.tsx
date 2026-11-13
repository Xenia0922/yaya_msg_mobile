/**
 * GlassCard —— 内容卡（玻璃 + padding + children）
 *
 * 保留原 API（strong / padding / radius / style / tint），全站调用点无需改动。
 * 实现走 GlassSurface，旧 reactnatively BlurSurface 已移除。
 */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { GlassSurface } from './GlassSurface';
import { radiiAlias } from '../theme';
import { spacing } from '../theme/spacing';

export interface GlassCardProps {
  children?: React.ReactNode;
  /** 强玻璃（更厚更实，文字可读性优先） */
  strong?: boolean;
  /** 自定义 padding */
  padding?: number;
  /** 自定义圆角，默认 card (20) */
  radius?: number;
  style?: StyleProp<ViewStyle>;
  /** 保留兼容（当前未使用） */
  tint?: 'pink' | 'plain';
}

export function GlassCard({
  children,
  strong = false,
  padding = spacing.md,
  radius = radiiAlias.card,
  style,
}: GlassCardProps) {
  return (
    <GlassSurface role={strong ? 'card' : 'chip'} radius={radius} style={style}>
      <View style={{ padding }}>{children}</View>
    </GlassSurface>
  );
}
