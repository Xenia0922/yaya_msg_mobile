/**
 * GlassSegmented · 玻璃滑动分段控件（全站 tap 切换统一用它）
 *
 * 结构照搬底栏：玻璃轨道 + 一块会滑动的玻璃选中胶囊（跟手/跟值），
 * 选中文字用主题色强调。用于「直播/录播」「大房间/小房间」这类切换。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { GlassSurface } from './GlassSurface';
import { usePalette } from '../theme';

export interface GlassSegmentOption<T extends string> {
  key: T;
  label: string;
}

interface Props<T extends string> {
  options: GlassSegmentOption<T>[];
  value: T;
  onChange: (key: T) => void;
  style?: StyleProp<ViewStyle>;
  /** 轨道高度，默认 36 */
  height?: number;
}

export function GlassSegmented<T extends string>({
  options,
  value,
  onChange,
  style,
  height = 36,
}: Props<T>) {
  const palette = usePalette();
  const [trackW, setTrackW] = useState(0);
  const idx = Math.max(0, options.findIndex((o) => o.key === value));
  const pad = 3;
  const cellW = trackW > 0 ? (trackW - pad * 2) / options.length : 0;
  const x = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(x, {
      toValue: idx * cellW,
      tension: 240,
      friction: 26,
      useNativeDriver: true,
    }).start();
  }, [idx, cellW, x]);

  return (
    <GlassSurface role="chip" radius={height / 2} style={[styles.track, { height }, style]}>
      <View
        style={styles.row}
        onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
      >
        {cellW > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.pill, { width: cellW, height: height - pad * 2, transform: [{ translateX: x }] }]}
          >
            {/* 无子元素的玻璃必须 asBackground 铺满，否则高度塌成 0（不可见） */}
            <GlassSurface role="selector" radius={(height - pad * 2) / 2} asBackground />
          </Animated.View>
        ) : null}
        {options.map((o) => {
          const active = o.key === value;
          return (
            <Pressable
              key={o.key}
              style={styles.cell}
              onPress={() => onChange(o.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.label,
                  { color: active ? palette.tint : palette.labelSecondary },
                  active && styles.labelActive,
                ]}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  track: { overflow: 'hidden' },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 3 },
  pill: {
    position: 'absolute',
    left: 3,
    top: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  label: { fontSize: 13 },
  labelActive: { fontWeight: '800' },
});
