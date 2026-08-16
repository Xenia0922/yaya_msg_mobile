/**
 * 优雅加载指示 —— 全站统一居中 spinner。
 *
 * 设计原则：
 *   - 居中 ActivityIndicator（palette.tint 品牌粉，双主题自动切换），可选一行低调提示；
 *   - 纯 RN 内置组件，零额外依赖；
 *   - 不再接受 dark prop：主题由 usePalette 单一来源决定。
 */
import React from 'react';
import {
  ActivityIndicator,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { usePalette } from '../theme';
import { typography } from '../theme/typography';

export function CenterSpinner({
  text,
  style,
}: {
  text?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  return (
    <View style={[styles.center, style]}>
      <ActivityIndicator color={palette.tint} />
      {text ? (
        <Text style={[typography.caption1, styles.text, { color: palette.labelTertiary }]}>
          {text}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { marginTop: 8, fontWeight: '600' },
});
