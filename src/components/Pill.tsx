/**
 * Pill / Chip：圆角胶囊小标签 / 可交互切换控件
 * iOS 26 风格：pill (完全圆角)、玻璃底、可选中态
 */
import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import { usePalette, radii } from '../theme';
import { typography } from '../theme/typography';

export interface PillProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** 强调填充（粉色实底白字），默认 off（玻璃底 + 描边） */
  accent?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Pill({ label, selected, onPress, accent, style }: PillProps) {
  const palette = usePalette();
  const filled = accent || selected;
  const bg = filled ? palette.tint : palette.fill3;
  const fg = filled ? '#FFFFFF' : palette.label;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        {
          backgroundColor: bg,
          borderColor: filled ? 'transparent' : palette.hairline,
          transform: [{ scale: pressed ? 0.96 : 1 }],
        },
        style,
      ]}
    >
      <Text
        style={[
          typography.subhead,
          {
            color: fg,
            fontWeight: '600',
            fontSize: 14,
            lineHeight: 18,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
  },
});
