/**
 * GlassSegmented · 玻璃滑动分段控件（全站 tap 切换统一用它）
 *
 * 结构照搬底栏：玻璃轨道 + 一块会滑动的玻璃选中胶囊（跟手/跟值），
 * 选中文字用主题色强调。用于「直播/录播」「大房间/小房间」这类切换。
 *
 * 交互（对齐底栏 AppTabBar）：
 *  - 点击某格 → 胶囊 spring 过去并回调 onChange
 *  - **按住横向拖动 → 胶囊跟手指走**，松手吸附到最近一格并回调 onChange
 *
 * ⚠️ driver 必须用 JS（`useNativeDriver: false`）：
 *  native driver 会把 Animated.Value 迁移到原生节点，之后从 JS 侧 `setValue()`
 *  会被原生节点静默丢弃（不报错、不生效）→ 症状是「点了变胶囊，但拖不动/不跟手」。
 *  这里只有 1 个胶囊 View 在动，JS driver 成本可忽略。
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
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
  const xRef = useRef(0);
  const startXRef = useRef(0);
  const draggingRef = useRef(false);

  // ref 化最新值：PanResponder 只创建一次，闭包会捕到过期的 options/value
  const cellWRef = useRef(cellW);
  cellWRef.current = cellW;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const idxRef = useRef(idx);
  idxRef.current = idx;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const settle = (target: number) => {
    xRef.current = target;
    Animated.spring(x, { toValue: target, tension: 220, friction: 30, useNativeDriver: false }).start();
  };

  useEffect(() => {
    // 拖动中不要被外部 value 变化拽走（与底栏同一处理）
    if (draggingRef.current) return;
    settle(idx * cellW);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, cellW]);

  const pan = useRef(
    PanResponder.create({
      // 点击不抢：只有横向拖动才接管，保证各格 Pressable 的点击照常触发
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        draggingRef.current = true;
        x.stopAnimation((v: number) => {
          xRef.current = v;
          startXRef.current = v;
        });
      },
      onPanResponderMove: (_, g) => {
        const n = optionsRef.current.length;
        const cw = cellWRef.current;
        if (!cw) return;
        const limit = Math.max(0, (n - 1) * cw);
        const nx = Math.min(limit, Math.max(0, startXRef.current + g.dx));
        xRef.current = nx;
        x.setValue(nx);
      },
      onPanResponderRelease: () => {
        draggingRef.current = false;
        const n = optionsRef.current.length;
        const cw = cellWRef.current;
        if (!cw) return;
        const h = Math.min(n - 1, Math.max(0, Math.round(xRef.current / cw)));
        settle(h * cw);
        const target = optionsRef.current[h];
        if (target && target.key !== optionsRef.current[idxRef.current]?.key) onChangeRef.current(target.key);
      },
      onPanResponderTerminate: () => {
        draggingRef.current = false;
        settle(idxRef.current * cellWRef.current);
      },
    }),
  ).current;

  return (
    <GlassSurface role="chip" radius={height / 2} style={[styles.track, { height }, style]}>
      <View
        style={styles.row}
        {...pan.panHandlers}
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
  scrollRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 3 },
  // left 必须是 0：cell 的 onLayout.x 已经包含行的 paddingHorizontal(3)
  scrollPill: { position: 'absolute', left: 0, top: 3, borderRadius: 999, overflow: 'hidden' },
  scrollCell: { paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  // alignSelf stretch：轨道宽度必须由父容器决定，不能被文字长短撑开/缩窄
  // （否则切换 tab 时 trackW 变化 → 等分胶囊重算 → 视觉上被「二次修正」）
  track: { overflow: 'hidden', alignSelf: 'stretch' },
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
    // 宽度瞬时到位：宽度动画与位置动画是两条独立弹簧，收敛节奏不同 → 看起来像被「二次修正」。
    // 文案长短不一时这一点尤其明显，因此宽度直接落位，只让位置做弹簧。
    // ⚠️ JS driver：`w.setValue()` 必须能在 JS 侧生效（见文件头 driver 说明）。
    w.setValue(target.w);
    Animated.spring(x, { toValue: target.x, tension: 220, friction: 30, useNativeDriver: false }).start();
  }, [target, x, w]);

  return (
    <GlassSurface role="chip" radius={height / 2} style={[styles.track, { height }, style]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollRow}>
        {target ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.scrollPill, { height: height - 6, width: w, transform: [{ translateX: x }] }]}
          >
            <GlassSurface role="selector" radius={(height - 6) / 2} asBackground />
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
