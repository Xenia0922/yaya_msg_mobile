/**
 * Pill / Chip —— 玻璃胶囊
 *
 * 保留原 API（label / selected / onPress / accent / style），全站调用点无需改动。
 * 实现走 GlassSurface（chip 材质），旧 reactnatively Chip 已移除。
 */
import React from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { GlassSurface } from './GlassSurface';
import { usePalette } from '../theme';
import { typography } from '../theme/typography';

export interface PillProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** 强调填充（实心 tint 底 + 白字），默认 off（玻璃底 + 描边） */
  accent?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Pill({ label, selected, onPress, accent, style }: PillProps) {
  const palette = usePalette();
  const solid = accent || selected;

  const content = (
    <Text
      numberOfLines={1}
      style={[
        typography.footnote,
        { fontWeight: '600' },
        { color: solid ? '#fff' : palette.label },
      ]}
    >
      {label}
    </Text>
  );

  // 实心强调态不做玻璃（玻璃底下压一层实心色既看不出玻璃，也浪费一次 backdrop 采样）
  if (solid) {
    return (
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={[styles.box, { backgroundColor: palette.tint }, style]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} disabled={!onPress} style={style}>
      <GlassSurface role="chip" radius={999} style={styles.box} interactive={!!onPress}>
        {content}
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
});
