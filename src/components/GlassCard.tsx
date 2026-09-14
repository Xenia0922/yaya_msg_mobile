/**
 * iOS 26 Liquid Glass 卡片 —— 已升级为真·液态玻璃材质。
 * 内部委托 LiquidGlass（expo-blur 真模糊 + 顶部高光层 + hairline 折射描边 + Reanimated 弹性）。
 * 保留原 API（strong/padding/radius/style），所有调用点自动升级。
 */
import React from 'react';
import { LiquidGlass } from './LiquidGlass';
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
  /** 保留兼容：旧 pink 染色语义已并入材质层 */
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
    <LiquidGlass
      strong={strong}
      padding={padding}
      radius={radius}
      style={style as never}
    >
      {children}
    </LiquidGlass>
  );
}
