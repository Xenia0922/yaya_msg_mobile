/**
 * MarqueeText · 单行跑马灯文字
 *
 * 用途：歌名/标题过长时不再换行（换行会让网格卡高度不一致，看起来「多了一部分」），
 * 而是保持单行 + 自动循环滚动。
 *
 * 实现要点：
 *  - 文字节点不设 numberOfLines，让它在容器外自然撑开，靠 onLayout 量到真实宽度
 *  - 只有「文字宽 > 容器宽」时才启动循环；否则静态显示，不做无意义的动画
 *  - 用 Animated.loop + useNativeDriver，避免 JS 线程抖动
 */
import React from 'react';
import { Animated, Easing, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

export interface MarqueeTextProps {
  text: string;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  /** 每秒滚动像素 */
  speed?: number;
  /** 两端停顿（毫秒） */
  pause?: number;
  /** 超出部分额外滚出的边距 */
  gap?: number;
}

export function MarqueeText({
  text,
  style,
  containerStyle,
  speed = 28,
  pause = 1200,
  gap = 24,
}: MarqueeTextProps) {
  const [boxW, setBoxW] = React.useState(0);
  const x = React.useRef(new Animated.Value(0)).current;

  // 文字宽不能靠 onLayout 量：Text 在容器内会被约束到容器宽（量到的是容器宽，永不溢出）。
  // 用字号估算（CJK/混排经验系数 0.62），配合容器实测宽判断是否需要滚动。
  const flat = (StyleSheet.flatten(style) || {}) as TextStyle;
  const fontSize = Number(flat.fontSize) || 15;
  const textW = React.useMemo(() => Math.round(text.length * fontSize * 0.62), [text, fontSize]);
  const overflow = boxW > 0 && textW > boxW + 4;

  React.useEffect(() => {
    if (!overflow) {
      x.setValue(0);
      return;
    }
    const dist = textW - boxW + gap;
    const move = Math.max(600, Math.round((dist / Math.max(1, speed)) * 1000));
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(pause),
        Animated.timing(x, {
          toValue: -dist,
          duration: move,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.delay(pause),
        Animated.timing(x, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [overflow, textW, boxW, gap, speed, pause, x]);

  return (
    <View
      style={[styles.box, containerStyle]}
      onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}
    >
      <Animated.View style={[styles.row, { transform: [{ translateX: x }] }]}>
        {/* 必须 numberOfLines={1}：否则文字会在容器内换行（把卡片撑高，网格卡高度就不一致了）。
            必须 flexShrink: 0：否则文字被压缩到容器宽，量不到真实宽度、跑马灯永不触发。
            两者叠加 → 单行 + 不压缩 → 超出部分由外层 overflow:'hidden' 裁掉。 */}
        <Text numberOfLines={1} style={[style, styles.text]}>
          {text}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
  row: { flexDirection: 'row' },
  text: { flexShrink: 0 },
});
