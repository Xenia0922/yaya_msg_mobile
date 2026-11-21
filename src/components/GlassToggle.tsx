import React, { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { usePalette } from '../theme';

interface GlassToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}

const TRACK_W = 48;
const TRACK_H = 28;
const THUMB_SIZE = 22;
const THUMB_PAD = 3;
const TRAVEL = TRACK_W - THUMB_SIZE - THUMB_PAD * 2;
const TOGGLE_SPRING = { damping: 20, stiffness: 280, mass: 0.85 };

export function GlassToggle({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
}: GlassToggleProps) {
  const palette = usePalette();
  const posSV = useSharedValue(value ? TRAVEL : 0);

  useEffect(() => {
    posSV.value = withSpring(value ? TRAVEL : 0, TOGGLE_SPRING);
  }, [value, posSV]);

  const thumbAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: posSV.value }],
  }));

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      style={({ pressed }) => [
        styles.track,
        {
          backgroundColor: value ? palette.tint : palette.fill3,
          borderColor: value ? palette.tint : palette.innerStroke,
          opacity: disabled ? 0.45 : pressed ? 0.86 : 1,
        },
      ]}
    >
      <Reanimated.View style={[styles.thumb, thumbAnimStyle]}>
        <View style={styles.thumbInner} />
      </Reanimated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    padding: THUMB_PAD,
    justifyContent: 'center',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: '#FFFFFF',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 4,
      },
      android: { elevation: 3 },
      default: null,
    }),
  },
  thumbInner: {
    flex: 1,
    borderRadius: THUMB_SIZE / 2,
  },
});
