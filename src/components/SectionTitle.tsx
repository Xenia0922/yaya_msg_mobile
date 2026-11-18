/**
 * 全站区块标题（统一视觉 token）：
 * - 13px / 700，字距 0.3
 * - 20px 圆角 tintSoft 图标 chip（可选）
 * - 与设置页 Section 标题完全同规格
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { usePalette } from '../theme';
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
  title: { fontSize: 13, fontWeight: '700', letterSpacing: 0.3 },
  action: { fontSize: 11, fontWeight: '700', marginRight: 2 },
});
