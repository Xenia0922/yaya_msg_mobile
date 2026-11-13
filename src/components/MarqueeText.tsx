/**
 * MarqueeText · 单行跑马灯文字
 *
 * 需求：标题/歌词单行显示；放不下时自动循环滚动，放得下静止；任何分辨率/字号都不能靠猜。
 *
 * 实现（2026-10-18 第三次重写，前两版均失败）：
 *  - **测量**：用一条不可见的横向 ScrollView 装同样文本，`onContentSizeChange` 拿到的是
 *    文本的真实内容宽（横向滚动视图不会把子节点压到容器宽）。上一版用「绝对定位 Text」
 *    量宽，在 Android 上仍会被父容器约束，量到的就是容器宽 → 永远判定「不需要滚」，
 *    这正是「歌词不滚动」的根因。
 *  - **动画**：可见层用 Animated.View 平移（JS 驱动，可 setValue 复位），
 *    dist = 文本宽 - 容器宽 + 间隙；两份文本接续形成无缝循环。
 *  - 可见文本 `ellipsizeMode="clip"`，滚动过程不会出现「…」。
 */
import React from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

export interface MarqueeTextProps {
  text: string;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  /** 每秒滚动像素 */
  speed?: number;
  /** 开始滚动前的停顿（毫秒） */
  pause?: number;
  /** 两份文本之间的间距 */
  gap?: number;
}

export function MarqueeText({
  text,
  style,
  containerStyle,
  speed = 26,
  pause = 900,
  gap = 28,
}: MarqueeTextProps) {
  const [boxW, setBoxW] = React.useState(0);
  const [textW, setTextW] = React.useState(0);
  const x = React.useRef(new Animated.Value(0)).current;

  /**
   * 兜底：若测量层因某些 ROM/布局异常拿不到内容宽（=0），按字号估算一次，
   * 保证长文本至少能滚起来。真实测量成功时（>0）完全以测量值为准。
   */
  const estW = React.useMemo(() => {
    if (textW > 0) return textW;
    const flat = (StyleSheet.flatten(style) || {}) as TextStyle;
    const fs = Number(flat.fontSize) || 13;
    let width = 0;
    for (const ch of text) width += /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch) ? fs : fs * 0.55;
    return Math.round(width);
  }, [textW, text, style]);

  // 采样值若恰好等于容器宽，多半是被 Android 的横向 ScrollView 按视口钳制了 → 改用估算值
  const clamped = textW > 0 && boxW > 0 && Math.abs(textW - boxW) <= 1.5;
  const useW = textW > 0 && !clamped ? textW : Math.max(textW, estW);
  const overflow = boxW > 0 && useW > boxW + 2;

  React.useEffect(() => {
    if (!overflow) {
      x.stopAnimation();
      x.setValue(0);
      return undefined;
    }
    const dist = useW - boxW + gap;
    const duration = Math.max(1200, Math.round((dist / Math.max(8, speed)) * 1000));
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(pause),
        Animated.timing(x, { toValue: -dist, duration, easing: Easing.linear, useNativeDriver: false }),
        Animated.delay(280),
        Animated.timing(x, { toValue: 0, duration: 0, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [overflow, useW, boxW, gap, speed, pause, x]);

  React.useEffect(() => {
    x.setValue(0);
  }, [text, x]);

  return (
    <View
      style={[styles.box, containerStyle]}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (Math.abs(w - boxW) > 0.5) setBoxW(w);
      }}
    >
      {/* 测量层：横向可滚动容器，子文本不会被压到容器宽 → 内容宽即文本真实宽 */}
      <ScrollView
        horizontal
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        pointerEvents="none"
        style={styles.measure}
        contentContainerStyle={styles.measureContent}
        onContentSizeChange={(w) => {
          if (Math.abs(w - textW) > 0.5) setTextW(w);
        }}
      >
        <Text numberOfLines={1} style={[style, styles.text]}>
          {text}
        </Text>
      </ScrollView>

      <Animated.View style={[styles.row, { transform: [{ translateX: x }] }]}>
        <Text numberOfLines={1} ellipsizeMode="clip" style={[style, styles.text]}>
          {text}
        </Text>
        {overflow ? (
          <Text numberOfLines={1} ellipsizeMode="clip" style={[style, styles.text, { marginLeft: gap }]}>
            {text}
          </Text>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
  row: { flexDirection: 'row' },
  text: { flexShrink: 0 },
  /** 测量层不可见、不参与交互，但要有宽度才能触发 onContentSizeChange */
  measure: { position: 'absolute', left: 0, top: 0, right: 0, opacity: 0 },
  measureContent: { flexGrow: 0 },
});
