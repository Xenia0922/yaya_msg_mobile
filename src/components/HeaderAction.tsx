/**
 * HeaderAction · 页头右侧文字操作（全站统一）
 *  - 「刷新 / 清理完成 / 发送翻牌」等文字按钮统一字号与按压反馈
 *  - loading 时显示迷你 spinner；disabled 时降透明度
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { usePalette } from '../theme';
import { typography } from '../theme/typography';

export interface HeaderActionProps {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function HeaderAction({ label, onPress, disabled, loading }: HeaderActionProps) {
  const palette = usePalette();
  const inactive = disabled || loading;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={inactive}
      activeOpacity={0.6}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[styles.btn, { opacity: inactive ? 0.45 : 1 }]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.tint} />
      ) : (
        <Text
          style={[
            typography.subhead,
            { color: palette.tint, fontWeight: '700', fontSize: 14, lineHeight: 20 },
          ]}
        >
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    minWidth: 54,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingVertical: 4,
  },
});
