import React from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { GlassSurface } from './GlassSurface';
import { usePalette } from '../theme';
import { typography } from '../theme/typography';

export interface PillProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;

  accent?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Pill({ label, selected, onPress, accent, style }: PillProps) {
  const palette = usePalette();

  const solid = !!accent;
  const selectedGlass = !!selected && !accent;

  const content = (
    <Text
      numberOfLines={1}
      style={[
        typography.footnote,
        {
          fontWeight: Platform.OS === 'android' ? '600' : '600',
          includeFontPadding: false,
        },

        { color: solid ? palette.onTint : palette.label },
      ]}
    >
      {label}
    </Text>
  );

  if (solid) {
    return (
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: !!selected, disabled: !onPress }}
        style={[styles.box, { backgroundColor: palette.tint }, style]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected, disabled: !onPress }}
      style={style}
    >
      <GlassSurface
        role="chip"
        radius={999}
        style={[styles.box, selectedGlass ? { borderColor: 'rgba(255,111,145,0.55)' } : null]}
        tintColor={selectedGlass ? 'rgba(255,111,145,0.20)' : undefined}
        interactive={!!onPress}
      >
        {content}
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderCurve: 'continuous',
  },
});
