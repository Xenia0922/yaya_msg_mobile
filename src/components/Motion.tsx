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
import Reanimated, {
  Easing as REasing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

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
  /**
   * 入场进度 0→1。
   *
   * ⚠️【掉帧修复】这里用 reanimated 的 shared value（跑在 UI 线程），不是 RN Animated：
   * 进房间要挂载 Chat（几百条消息 + 玻璃气泡）、退房间要卸载 Chat 并重建整个房间列表，
   * 这几百毫秒里 JS 线程是满载的。JS 驱动的 opacity 动画只能排队等 JS 空档，
   * 肉眼看到的就是「渐入一顿一顿」。shared value 由 UI 线程推进，JS 再忙也不影响帧率。
   *
   * 为什么不用 RN 的 useNativeDriver: true —— 见 f30c1c0：原生动画在转场/切后台/
   * screens 冻结时会被系统中断且 setValue 救不回来，整块内容停在 opacity 0（丢界面）。
   * reanimated 的值由 UI 线程持有，冻结后恢复会继续推进，不存在这个问题。
   */
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withDelay(delay, withTiming(1, { duration, easing: REasing.bezier(0.23, 1, 0.32, 1) }));
    // 兜底：万一 UI 线程动画没推进（异常/被回收），到点直接置 1，绝不留透明块
    const guard = setTimeout(() => { progress.value = 1; }, delay + duration + 200);
    return () => clearTimeout(guard);
  }, [delay, duration, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: distance * (1 - progress.value) }],
  }));

  return (
    <Reanimated.View pointerEvents={pointerEvents} style={[style, animatedStyle]}>
      {children}
    </Reanimated.View>
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
