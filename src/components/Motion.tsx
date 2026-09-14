/**
 * Apple 流体动效组件（RN Animated + native driver，零 worklet 依赖）
 *
 * 规范来源：WWDC Designing Fluid Interfaces + emilkowalski/animate-expo：
 *  - FadeInView：进场 ease-out 强曲线（0.23,1,0.32,1）+ 轻位移
 *  - ScalePressable：按下即反馈（press-in 即刻 scale 0.97/120ms），松手 spring 回弹
 *  - MotionIcon：图标挂载 spring 浮现（0.92→1，轻微过冲）
 * 只动 transform/opacity（native driver 可动画属性）。
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleProp,
  TouchableOpacity,
  TouchableOpacityProps,
  ViewProps,
  ViewStyle,
} from 'react-native';

/**
 * Apple 家族强 ease-out（UI 进出场默认）。
 * ⚠️ 必须用预定义 easing：native driver 无法序列化 Easing.bezier 自定义函数，
 * 一旦用了自定义 bezier，动画可能整体不执行 → opacity 卡在 0 → 页面不可见。
 */
export const EASE_OUT = Easing.out(Easing.cubic);
/** 屏上移动 */
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

interface FadeInViewProps extends Pick<ViewProps, 'pointerEvents'> {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  distance?: number;
  style?: StyleProp<ViewStyle>;
}

export function FadeInView({
  children,
  delay = 0,
  duration = 300,
  distance = 10,
  style,
  pointerEvents,
}: FadeInViewProps) {
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    value.setValue(0);
    const animation = Animated.timing(value, {
      toValue: 1,
      duration,
      delay,
      easing: EASE_OUT,
      useNativeDriver: true,
    });
    animation.start();
    // 兜底：动画未回调（native driver 异常/被打断）时强制可见，避免整块内容消失
    const guard = setTimeout(() => value.setValue(1), delay + duration + 150);
    return () => { animation.stop(); clearTimeout(guard); };
  }, [delay, duration, value]);

  return (
    <Animated.View
      pointerEvents={pointerEvents}
      style={[
        style,
        {
          opacity: value,
          transform: [{
            translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
          }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

interface ScalePressableProps extends TouchableOpacityProps {
  pressedScale?: number;
  children: React.ReactNode;
}

export function ScalePressable({
  pressedScale = 0.97,
  activeOpacity = 0.9,
  onPressIn,
  onPressOut,
  style,
  children,
  ...props
}: ScalePressableProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (toValue: number, bouncy: boolean) => {
    scale.stopAnimation();
    Animated.spring(scale, {
      toValue,
      // 松手回弹用轻弹（物理感）；按下用快收敛（即时反馈）
      speed: bouncy ? 24 : 32,
      bounciness: bouncy ? 5 : 2,
      useNativeDriver: true,
    }).start();
  };

  return (
    <AnimatedTouchable
      {...props}
      activeOpacity={activeOpacity}
      onPressIn={(event: any) => {
        // 按下即刻反馈：不等松手（Apple: highlight on touch-down）
        animateTo(pressedScale, false);
        onPressIn?.(event);
      }}
      onPressOut={(event: any) => {
        animateTo(1, true);
        onPressOut?.(event);
      }}
      style={[style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedTouchable>
  );
}

/** 图标挂载动画：0.92→1 spring 浮现（用于快捷入口/工具/行内图标） */
export function MotionIcon({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    value.setValue(0);
    Animated.spring(value, {
      toValue: 1,
      speed: 20,
      bounciness: 7,
      useNativeDriver: true,
    }).start();
  }, [value]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: value,
          transform: [{
            scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }),
          }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
