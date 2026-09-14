/**
 * 按钮 —— 委托 reactnatively 的 Button（液态玻璃 UI 系统）
 * 保留原 API（title/onPress/variant/size/disabled/loading/icon/style/textStyle/fullWidth），
 * 全站调用点无需改动；tinted/plain 变体由库的玻璃材质渲染。
 */
import React from 'react';
import { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { Button as RNButton } from 'reactnatively';

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

const VARIANT_MAP: Record<ButtonVariant, 'solid' | 'tinted' | 'ghost'> = {
  filled: 'solid',
  tinted: 'tinted',
  plain: 'ghost',
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
  return (
    <RNButton
      label={title}
      onPress={onPress}
      variant={VARIANT_MAP[variant]}
      size={size}
      disabled={!!disabled}
      loading={loading}
      leftIcon={icon as never}
      fullWidth={fullWidth}
      style={style as never}
      textStyle={textStyle as never}
    />
  );
}
