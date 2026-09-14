/**
 * 按钮 —— 保留原 API（title / onPress / variant / size / disabled / loading /
 * icon / style / textStyle / fullWidth），全站调用点无需改动。
 *
 * 变体：
 *  - filled：实心 tint 底 + 白字（主操作；不做玻璃，实心底下玻璃不可见）
 *  - tinted：玻璃胶囊 + tint 字（次操作，玻璃质感）
 *  - plain ：纯文字按钮（无底）
 * 旧 reactnatively Button 已移除，实现走 GlassSurface。
 */
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
import { usePalette } from '../theme';

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
  sm: { padH: 12, padV: 6, font: 13, radius: 999 },
  md: { padH: 16, padV: 9, font: 15, radius: 999 },
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
      <Text style={[styles.label, { color: labelColor, fontSize: s.font }, textStyle]} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );

  const box: StyleProp<ViewStyle> = [
    styles.box,
    { paddingHorizontal: s.padH, paddingVertical: s.padV, borderRadius: s.radius },
    fullWidth ? styles.full : null,
    variant === 'filled' ? { backgroundColor: palette.tint } : null,
    dim ? styles.dim : null,
    style,
  ];

  if (variant === 'tinted') {
    return (
      <Pressable onPress={onPress} disabled={dim} style={fullWidth ? styles.full : undefined}>
        <GlassSurface role="chip" radius={s.radius} style={box} interactive={!dim}>
          {inner}
        </GlassSurface>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} disabled={dim} style={box}>
      {inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  full: { alignSelf: 'stretch' },
  dim: { opacity: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  label: { fontWeight: '600' },
});
