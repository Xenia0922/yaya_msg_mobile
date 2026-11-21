import React from 'react';
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

export interface MarqueeTextProps {
  text: string;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;

  speed?: number;

  pause?: number;

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

  const estW = React.useMemo(() => {
    if (textW > 0) return textW;
    const flat = (StyleSheet.flatten(style) || {}) as TextStyle;
    const fs = Number(flat.fontSize) || 13;
    let width = 0;
    for (const ch of text)
      width += /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch) ? fs : fs * 0.55;
    return Math.round(width);
  }, [textW, text, style]);

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
        Animated.timing(x, {
          toValue: -dist,
          duration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.delay(280),
        Animated.timing(x, { toValue: 0, duration: 0, useNativeDriver: true }),
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
          <Text
            numberOfLines={1}
            ellipsizeMode="clip"
            style={[style, styles.text, { marginLeft: gap }]}
          >
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

  measure: { position: 'absolute', left: 0, top: 0, right: 0, opacity: 0 },
  measureContent: { flexGrow: 0 },
});
