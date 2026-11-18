import React from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Pill } from './Pill';
import { usePalette } from '../theme';

/**
 * 筛选 chips 公共件（C3）。
 *
 * - `wrap`（默认 false）：横向滚动 + 右缘渐隐（适合分团/日期等长列表）；
 * 传 `wrap` 则自动换行（适合数量少、希望一眼看全的成员筛选）。
 * - 选中态由 `Pill` 统一为「半透明 tint 玻璃 + tint 描边」。
 */
export function FilterChips({
  items,
  value,
  onSelect,
  wrap = false,
  style,
}: {
  items: { key: string; label: string }[];
  value: string;
  onSelect: (key: string) => void;
  wrap?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();

  if (wrap) {
    return (
      <View style={[styles.wrap, style]}>
        {items.map((item) => (
          <Pill
            key={item.key}
            label={item.label}
            selected={item.key === value}
            onPress={() => onSelect(item.key)}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={[styles.rowWrap, style]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {items.map((item) => (
          <Pill
            key={item.key}
            label={item.label}
            selected={item.key === value}
            onPress={() => onSelect(item.key)}
          />
        ))}
      </ScrollView>
      <LinearGradient
        pointerEvents="none"
        colors={
          palette.name === 'dark'
            ? ['rgba(20,20,26,0)', 'rgba(20,20,26,0.85)']
            : ['rgba(244,245,249,0)', 'rgba(244,245,249,0.9)']
        }
        style={styles.fade}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  rowWrap: { position: 'relative' },
  scrollContent: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 26 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fade: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 26 },
});
