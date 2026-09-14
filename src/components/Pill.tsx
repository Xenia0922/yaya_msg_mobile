/**
 * Pill / Chip —— 委托 reactnatively 的 Chip（液态玻璃 UI 系统组件）
 * 保留原 API（label/selected/onPress/accent/style），全站调用点无需改动。
 */
import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { Chip } from 'reactnatively';

export interface PillProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** 强调填充（粉色实底白字），默认 off（玻璃底 + 描边） */
  accent?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Pill({ label, selected, onPress, accent, style }: PillProps) {
  return (
    <Chip
      label={label}
      isSelected={accent || selected}
      onPress={onPress}
      size="sm"
      style={style as never}
    />
  );
}
