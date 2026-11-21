import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { GlassSurface } from './GlassSurface';
import { SquircleView } from './SquircleView';
import { fontFamily, usePalette } from '../theme';

export type ButtonVariant = 'filled' | 'tinted' | 'plain';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  fullWidth?: boolean;
}

const SIZE_MAP: Record<ButtonSize, { padH: number; padV: number; font: number; radius: number }> = {
  sm: { padH: 14, padV: 9, font: 13, radius: 999 },
  md: { padH: 16, padV: 10, font: 15, radius: 999 },
  lg: { padH: 20, padV: 12, font: 16, radius: 999 },
};

export function Button({
  title,
  onPress,
  variant = 'filled',
  size = 'md',
  disabled,
  loading,
  icon,
  style,
  textStyle,
  fullWidth,
}: ButtonProps) {
  const palette = usePalette();
  const s = SIZE_MAP[size];
  const dim = !!disabled || !!loading;

  const labelColor =
    variant === 'filled' ? '#fff' : variant === 'tinted' ? palette.tint : palette.label;

  const inner = (
    <View style={styles.row}>
      {loading ? (
        <ActivityIndicator size="small" color={labelColor} style={{ marginRight: 6 }} />
      ) : icon ? (
        <View style={{ marginRight: 6 }}>{icon}</View>
      ) : null}
      <Text
        style={[styles.label, { color: labelColor, fontSize: s.font }, textStyle]}
        numberOfLines={1}
      >
        {title}
      </Text>
    </View>
  );

  const box: StyleProp<ViewStyle> = [
    styles.box,
    {
      paddingHorizontal: s.padH,
      paddingVertical: s.padV,
      borderRadius: s.radius,
      borderCurve: 'continuous',
    },
    fullWidth ? styles.full : null,
    variant === 'filled' ? { backgroundColor: palette.tint } : null,
    dim ? styles.dim : null,
    style,
  ];

  if (variant === 'tinted') {
    return (
      <Pressable
        onPress={onPress}
        disabled={dim}
        style={fullWidth ? styles.full : undefined}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: dim, busy: !!loading }}
      >
        <GlassSurface role="chip" radius={s.radius} style={box} interactive={!dim}>
          {inner}
        </GlassSurface>
      </Pressable>
    );
  }

  if (variant === 'filled') {
    return (
      <Pressable
        onPress={onPress}
        disabled={dim}
        style={fullWidth ? styles.full : undefined}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: dim, busy: !!loading }}
      >
        <SquircleView radius={s.radius} style={box}>
          {inner}
        </SquircleView>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={dim}
      style={box}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: dim, busy: !!loading }}
    >
      {inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  full: { alignSelf: 'stretch' },
  dim: { opacity: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  label: {
    fontFamily: fontFamily.system,
    fontWeight: '600',
    includeFontPadding: false,
  },
});
