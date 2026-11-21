import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  PressableProps,
  StyleProp,
  TouchableOpacityProps,
  ViewProps,
  ViewStyle,
} from 'react-native';
import Reanimated, {
  Easing as REasing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

export const EASE_OUT = Easing.out(Easing.cubic);

export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);

const AnimatedPressable = Reanimated.createAnimatedComponent(Pressable);

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
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withDelay(
      delay,
      withTiming(1, { duration, easing: REasing.bezier(0.23, 1, 0.32, 1) }),
    );

    const guard = setTimeout(
      () => {
        progress.value = 1;
      },
      delay + duration + 200,
    );
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

interface ScalePressableProps extends Omit<TouchableOpacityProps, 'style'> {
  pressedScale?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export function ScalePressable({
  pressedScale = 0.97,
  activeOpacity = 0.9,
  onPressIn,
  onPressOut,
  style,
  children,
  disabled,
  ...props
}: ScalePressableProps) {
  const pressProgress = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - (1 - activeOpacity) * pressProgress.value,
    transform: [{ scale: 1 - (1 - pressedScale) * pressProgress.value }],
  }));

  return (
    <AnimatedPressable
      {...(props as PressableProps)}
      disabled={disabled}
      onPressIn={(event) => {
        if (!disabled) {
          pressProgress.value = withTiming(1, { duration: 60 });
        }
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        pressProgress.value = withSpring(0, { damping: 18, stiffness: 320, mass: 0.7 });
        onPressOut?.(event);
      }}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}

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
          transform: [
            {
              scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
