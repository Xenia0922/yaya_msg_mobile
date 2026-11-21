import React from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { fontFamily, usePalette } from '../theme';
import { ScalePressable } from './Motion';

export function SectionTitle({
  title,
  icon,
  actionLabel,
  onAction,
  style,
}: {
  title: string;
  icon?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  return (
    <View style={[styles.head, style]}>
      <View style={styles.left}>
        {icon ? (
          <View style={[styles.iconChip, { backgroundColor: palette.tintSoft }]}>
            <MaterialCommunityIcons name={icon} size={11} color={palette.tint} />
          </View>
        ) : (
          <View style={[styles.dot, { backgroundColor: palette.tint }]} />
        )}
        <Text style={[styles.title, { color: palette.label }]}>{title}</Text>
      </View>
      {actionLabel && onAction ? (
        <ScalePressable
          onPress={onAction}
          pressedScale={0.94}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <View style={styles.left}>
            <Text style={[styles.action, { color: palette.tint }]}>{actionLabel}</Text>
            <MaterialCommunityIcons name="chevron-right" color={palette.tint} size={15} />
          </View>
        </ScalePressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  left: { flexDirection: 'row', alignItems: 'center' },
  iconChip: {
    width: 20,
    height: 20,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7,
  },
  dot: { width: 3, height: 16, borderRadius: 1.5, marginRight: 8 },
  title: {
    fontSize: 13,
    fontFamily: fontFamily.system,
    fontWeight: '600',
    letterSpacing: Platform.OS === 'android' ? 0 : 0.3,
    includeFontPadding: false,
  },
  action: {
    fontSize: 11,
    fontFamily: fontFamily.system,
    fontWeight: '600',
    marginRight: 2,
    includeFontPadding: false,
  },
});
