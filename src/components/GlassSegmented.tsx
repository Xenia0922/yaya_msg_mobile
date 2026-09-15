/**
 * GlassSegmented · 玻璃滑动分段控件（全站 tap 切换统一用它）
 *
 * 结构照搬底栏：玻璃轨道 + 一块会滑动的玻璃选中胶囊（跟手/跟值），
 * 选中文字用主题色强调。用于「直播/录播」「大房间/小房间」这类切换。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
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
  const isDark = palette.name === 'dark';
  const [trackW, setTrackW] = useState(0);
  const idx = Math.max(0, options.findIndex((o) => o.key === value));
  const pad = 3;
  const cellW = trackW > 0 ? (trackW - pad * 2) / options.length : 0;
  const x = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(x, {
      toValue: idx * cellW,
      tension: 220,
      friction: 30,
      useNativeDriver: true,
    }).start();
  }, [idx, cellW, x]);

  return (
    <GlassSurface role="chip" radius={height / 2} style={[styles.track, { height }, style]}>
      <View
        style={styles.row}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          setTrackW((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
        }}
      >
        {cellW > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.pill, { width: cellW, height: height - pad * 2, transform: [{ translateX: x }] }]}
          >
            {/* 选中态用干净实底填充：轨道已是玻璃，胶囊再叠一层玻璃会出现
                双重描边/光晕（用户反馈的「二次修正」）。这里只用单色填充。 */}
            <View
              style={{
                flex: 1,
                borderRadius: (height - pad * 2) / 2,
                backgroundColor: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.92)',
              }}
            />
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
  scrollRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 3 },
  // left 必须是 0：cell 的 onLayout.x 已经包含行的 paddingHorizontal(3)
  scrollPill: { position: 'absolute', left: 0, top: 3, borderRadius: 999, overflow: 'hidden' },
  scrollCell: { paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
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
  labelLg: { fontSize: 14 },
  label: { fontSize: 14 },
  labelActive: { fontWeight: '800' },
});

/**
 * 可横向滚动的滑动选中块 —— 选项多（如分组筛选 7 个）时用这个：
 * 不给每个格子等分宽度，而是测量每项的实际位置/宽度，让玻璃胶囊滑过去。
 */
export function GlassSegmentedScroll<T extends string>({
  options,
  value,
  onChange,
  style,
  height = 34,
}: Props<T>) {
  const palette = usePalette();
  const [layouts, setLayouts] = useState<{ x: number; w: number }[]>([]);
  const idx = Math.max(0, options.findIndex((o) => o.key === value));
  const x = useRef(new Animated.Value(0)).current;
  const w = useRef(new Animated.Value(0)).current;
  const target = layouts[idx];

  useEffect(() => {
    if (!target) return;
    Animated.spring(x, { toValue: target.x, tension: 220, friction: 30, useNativeDriver: true }).start();
    Animated.spring(w, { toValue: target.w, tension: 220, friction: 30, useNativeDriver: true }).start();
  }, [target, x, w]);

  return (
    <GlassSurface role="chip" radius={height / 2} style={[styles.track, { height }, style]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollRow}>
        {target ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.scrollPill, { height: height - 6, width: w, transform: [{ translateX: x }] }]}
          >
            <View
              style={{
                flex: 1,
                borderRadius: (height - 6) / 2,
                backgroundColor: palette.name === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.92)',
              }}
            />
          </Animated.View>
        ) : null}
        {options.map((o, i) => {
          const active = o.key === value;
          return (
            <Pressable
              key={o.key}
              onPress={() => onChange(o.key)}
              onLayout={(e) => {
                const { x: lx, width: lw } = e.nativeEvent.layout;
                setLayouts((prev) => {
                  const cur = prev[i];
                  // 数值没变就不 setState：否则「量测 → 重渲染 → 再量测」会持续抖动
                  if (cur && Math.abs(cur.x - lx) < 0.5 && Math.abs(cur.w - lw) < 0.5) return prev;
                  const next = [...prev];
                  next[i] = { x: lx, w: lw };
                  return next;
                });
              }}
              style={[styles.scrollCell, { height }]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text
                numberOfLines={1}
                style={[styles.label, { color: active ? palette.tint : palette.labelSecondary }, active && styles.labelActive]}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </GlassSurface>
  );
}
