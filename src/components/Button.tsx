/**
 * iOS 26 风按钮：三种变体（filled / tinted / plain）
 * - filled：主按钮（品牌粉填充，白字）
 * - tinted：玻璃感按钮（accent 浅底 + accent 字）
 * - plain：纯文字按钮
 * - 胶囊形状（iOS 26 默认），按 size 区分高度
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { usePalette, radii, motion } from '../theme';
import { typography } from '../theme/typography';

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

const sizeMap = {
  sm: { h: 36, px: 14, font: typography.subhead, fontWeight: '600' as TextStyle['fontWeight'] },
  md: { h: 44, px: 18, font: typography.headline, fontWeight: '600' as TextStyle['fontWeight'] },
  lg: { h: 52, px: 22, font: typography.headline, fontWeight: '700' as TextStyle['fontWeight'] },
} as const;

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
  const cfg = sizeMap[size];
  const isDisabled = disabled || loading;

  const bg =
    variant === 'filled'
      ? palette.tint
      : variant === 'tinted'
      ? palette.tintSoft
      : 'transparent';
  const fg =
    variant === 'filled'
      ? '#FFFFFF'
      : variant === 'tinted'
      ? palette.tint
      : palette.tint;
  const borderColor = variant === 'plain' ? palette.hairline : 'transparent';

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.btn,
        {
          height: cfg.h,
          paddingHorizontal: cfg.px,
          borderRadius: radii.pill,
          backgroundColor: bg,
          borderColor,
          borderWidth: variant === 'plain' ? StyleSheet.hairlineWidth : 0,
          opacity: isDisabled ? 0.5 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <View style={{ marginRight: 8 }}>{icon}</View> : null}
          <Text
            style={[
              {
                ...cfg.font,
                fontWeight: cfg.fontWeight,
                color: fg,
                textAlign: 'center',
              },
              textStyle,
            ]}
          >
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// re-export motion so other files import from one place
export { motion };
