import React from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Pill } from './Pill';

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
    </View>
  );
}

const styles = StyleSheet.create({
  rowWrap: { position: 'relative' },
  scrollContent: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
