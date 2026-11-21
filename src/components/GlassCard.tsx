import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { GlassSurface } from './GlassSurface';
import { radiiAlias } from '../theme';
import { spacing } from '../theme/spacing';

export interface GlassCardProps {
  children?: React.ReactNode;

  strong?: boolean;

  padding?: number;

  radius?: number;
  style?: StyleProp<ViewStyle>;

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
