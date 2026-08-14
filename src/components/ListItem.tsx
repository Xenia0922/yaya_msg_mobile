/**
 * ListItem：iOS 26 inset-grouped 风格列表行
 *  - 圆形/方形 leading icon/image
 *  - 主标题 + 副标题
 *  - 右侧可选 trailing（chevron / text / custom）
 *  - 选中态：accent 染色
 */
import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { usePalette, spacing, radii } from '../theme';
import { typography } from '../theme/typography';

export interface ListItemProps {
  title: string;
  subtitle?: string;
  caption?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  showChevron?: boolean;
  onPress?: () => void;
  selected?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ListItem({
  title,
  subtitle,
  caption,
  leading,
  trailing,
  showChevron,
  onPress,
  selected,
  disabled,
  style,
}: ListItemProps) {
  const palette = usePalette();
  const titleColor = selected ? palette.tint : palette.label;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? (palette.name === 'dark' ? '#2A2A2C' : '#F2F2F7') : 'transparent',
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      {leading ? (
        <View style={styles.leading}>{leading}</View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[typography.body, { color: titleColor, fontWeight: '500' }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={[typography.footnote, { color: palette.labelSecondary, marginTop: 2 }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {caption ? (
        <Text style={[typography.footnote, { color: palette.labelTertiary, marginRight: spacing.xs }]}>
          {caption}
        </Text>
      ) : null}
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      {showChevron ? <Chevron color={palette.labelTertiary} /> : null}
    </Pressable>
  );
}

function Chevron({ color }: { color: string }) {
  return (
    <View style={styles.chevronWrap}>
      <View style={[styles.chevronStem, { borderColor: color }]} />
      <View style={[styles.chevronHead, { borderColor: color }]} />
    </View>
  );
}

const ROW_HEIGHT = 56;

const styles = StyleSheet.create({
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radii.md,
  },
  leading: {
    marginRight: 14,
  },
  trailing: {
    marginLeft: 10,
  },
  chevronWrap: { width: 10, height: 14, justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
  chevronStem: { width: 8, height: 1.5, transform: [{ rotate: '-45deg' }, { translateY: -2 }], borderTopWidth: 1.5, borderRightWidth: 0 },
  chevronHead: { width: 8, height: 1.5, transform: [{ rotate: '45deg' }, { translateY: 2 }], borderTopWidth: 1.5 },
});
