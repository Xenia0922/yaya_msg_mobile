import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  ViewProps,
  StyleProp,
  TouchableOpacity,
  TouchableOpacityProps,
  ViewStyle,
} from 'react-native';

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
  duration = 360,
  distance = 10,
  style,
  pointerEvents,
}: FadeInViewProps) {
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    value.setValue(0);
    Animated.timing(value, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [delay, duration, value]);

  return (
    <Animated.View
      pointerEvents={pointerEvents}
      style={[
        style,
        {
          opacity: value,
          transform: [{
            translateY: value.interpolate({
              inputRange: [0, 1],
              outputRange: [distance, 0],
            }),
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
  pressedScale = 0.96,
  activeOpacity = 0.9,
  onPressIn,
  onPressOut,
  style,
  children,
  ...props
}: ScalePressableProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (toValue: number) => {
    Animated.spring(scale, {
      toValue,
      speed: 28,
      bounciness: 6,
      useNativeDriver: true,
    }).start();
  };

  return (
    <AnimatedTouchable
      {...props}
      activeOpacity={activeOpacity}
      onPressIn={(event) => {
        animateTo(pressedScale);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animateTo(1);
        onPressOut?.(event);
      }}
      style={[style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedTouchable>
  );
}
