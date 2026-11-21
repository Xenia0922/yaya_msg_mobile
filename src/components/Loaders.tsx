import React from 'react';
import { ActivityIndicator, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { usePalette } from '../theme';
import { typography } from '../theme/typography';

export function CenterSpinner({ text, style }: { text?: string; style?: StyleProp<ViewStyle> }) {
  const palette = usePalette();
  return (
    <View style={[styles.center, style]}>
      <ActivityIndicator color={palette.tint} />
      {text ? (
        <Text style={[typography.caption1, styles.text, { color: palette.labelTertiary }]}>
          {text}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { marginTop: 8, fontWeight: '600' },
});
