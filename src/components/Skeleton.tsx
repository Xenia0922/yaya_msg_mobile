/**
 * Skeleton：iOS 26 玻璃色块骨架屏
 *  - 浅色脉冲（rgba(0,0,0,0.06) ~ rgba(0,0,0,0.12)）双主题适应
 */
import React from 'react';
import { Animated, Easing, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { usePalette, radii } from '../theme';

export interface SkeletonProps {
  width?: number | string;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({ width = '100%' as const, height = 14, radius = radii.sm, style }: SkeletonProps) {
  const palette = usePalette();
  const opacity = React.useRef(new Animated.Value(0.55)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius: radius,
          backgroundColor: palette.fill3,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function SkeletonRow() {
  return (
    <Skeleton width="60%" height={12} radius={6} style={{ marginVertical: 6 }} />
  );
}
