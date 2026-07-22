/**
 * 优雅加载指示 —— 替代骨架屏（微光闪烁）。
 *
 * 设计原则：
 *   - 居中 ActivityIndicator（品牌粉），可选一行低调提示；
 *   - 无任何 shimmer / 呼吸动画，彻底消除「老加载模式 + 骨架屏」叠加打架，
 *     以及搜索无结果时骨架一直闪烁的问题；
 *   - 纯 RN 内置组件，零额外依赖。
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

export function CenterSpinner({
  dark,
  text,
  style,
}: {
  dark?: boolean;
  text?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.center, style]}>
      <ActivityIndicator color={dark ? '#ff8fa8' : '#ff6f91'} />
      {text ? <Text style={[styles.text, dark && styles.textDark]}>{text}</Text> : null}
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
  text: { marginTop: 8, color: '#ff6f91', fontSize: 12, fontWeight: '600' },
  textDark: { color: '#ff8fa8' },
});
