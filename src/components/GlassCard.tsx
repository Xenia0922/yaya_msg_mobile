/**
 * GlassCard —— 委托 reactnatively 的 BlurSurface（液态玻璃 UI 系统的磨砂面板）
 * 保留原 API（strong/padding/radius/style），全站调用点无需改动。
 * 跨平台材质（expo-blur 系），任何设备都可见玻璃观感。
 */
import React from 'react';
import { BlurSurface } from 'reactnatively';
import { radiiAlias } from '../theme';
import { spacing } from '../theme/spacing';

export interface GlassCardProps {
  children?: React.ReactNode;
  /** 强玻璃（更高不透明度，保证文字可读） */
  strong?: boolean;
  /** 自定义 padding */
  padding?: number;
  /** 自定义圆角，默认 card (20) */
  radius?: number;
  style?: Record<string, unknown>;
  /** 保留兼容 */
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
    <BlurSurface
      variant="frosted"
      elevation={strong ? 3 : 2}
      borderRadius={radius}
      style={[{ padding }, style as never]}
    >
      {children}
    </BlurSurface>
  );
}
