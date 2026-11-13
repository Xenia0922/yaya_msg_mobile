
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

/**
 * 选中胶囊（**刻意不用 BlurView**）。
 *
 * ⚠️ 2026-10-06 实测修复「切换页签瞬间胶囊被挤压/变形」：
 * expo-blur 的 BlurView 在 Android 上用**原生驱动 transform** 位移时，backdrop 的裁剪框
 * 不跟随视图移动 → 移出旧裁剪框的部分被**竖直切掉**（连拍实拍：胶囊左圆头整块消失、
 * 左边缘是一条硬直线），用户看到的就是「切换时被挤一下」。
 *
 * 这里改用与 `SELECTOR` 材质**等价的不透明层**（深色主题 = 12% 白 + 10% 白描边；
 * 浅色 = 55% 浅灰 + 45% 白描边）。胶囊底下是纯色/平滑渐变的轨道，模糊在视觉上本就看不出来，
 * 因此观感一致；同时省掉动画期间每帧一次 backdrop 重采样（更省电、更不掉帧）。
 * 需要真模糊时请用 `GlassSurface role="selector"`（静止不动的场景）。
 */
function SelectorCapsule({ radius, dark }: { radius: number; dark: boolean }) {
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          borderRadius: radius,
          backgroundColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(232,232,238,0.55)',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.45)',
        },
      ]}
    />
  );
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
  // 点击、拖动和松手共用同一个位置，避免父级更新前先回到旧索引。
  const position = useRef(new Animated.Value(0)).current;
  const positionRef = useRef(0);
  const dragStartRef = useRef(0);
  const draggingRef = useRef(false);
  const rollbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    positionRef.current = target;
    position.setValue(target);
  };
  useLayoutEffect(() => {
    if (draggingRef.current) return;
    if (rollbackTimerRef.current) { clearTimeout(rollbackTimerRef.current); rollbackTimerRef.current = null; }
    if (cellW > 0) settle(idx * cellW);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, cellW]);
  useEffect(() => () => { if (rollbackTimerRef.current) clearTimeout(rollbackTimerRef.current); }, []);

  const pan = useRef(
    PanResponder.create({
      // 点击不抢：只有横向拖动才接管，保证各格 Pressable 的点击照常触发
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        draggingRef.current = true;
        if (rollbackTimerRef.current) { clearTimeout(rollbackTimerRef.current); rollbackTimerRef.current = null; }
        dragStartRef.current = positionRef.current;
      },
      onPanResponderMove: (_, g) => {
        const n = optionsRef.current.length;
        const cw = cellWRef.current;
        if (!cw) return;
        const limit = Math.max(0, (n - 1) * cw);
        const nx = Math.min(limit, Math.max(0, dragStartRef.current + g.dx));
        settle(nx);
      },
      onPanResponderRelease: () => {
        draggingRef.current = false;
        const n = optionsRef.current.length;
        const cw = cellWRef.current;
        if (!cw) return;
        const h = Math.min(n - 1, Math.max(0, Math.round(positionRef.current / cw)));
        settle(h * cw);
        const target = optionsRef.current[h];
        if (target && target.key !== optionsRef.current[idxRef.current]?.key) {
          onChangeRef.current(target.key);
          // 父级拒绝切换时恢复当前值；正常更新由上面的 effect 取消此定时器。
          rollbackTimerRef.current = setTimeout(() => {
            rollbackTimerRef.current = null;
            if (!draggingRef.current) settle(idxRef.current * cellWRef.current);
          }, 1000);
        }
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
            style={[styles.pillPos, { left: pad, width: cellW, height: height - pad * 2, transform: [{ translateX: position }] }]}
          >
            <SelectorCapsule radius={(height - pad * 2) / 2} dark={palette.name === 'dark'} />
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
  /** 胶囊外层定位（不含 overflow hidden —— 圆角裁剪由内层 GlassSurface 自己负责） */
  pillPos: { position: 'absolute', left: 3, top: 3 },
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

  const lastXRef = useRef<number | null>(null);
  useEffect(() => {
    if (!target) return;
    // 宽度瞬时到位：宽度动画与位置动画是两条独立弹簧，收敛节奏不同 → 看起来像被「二次修正」。
    w.setValue(target.w);
    // 首次测量 / 仅宽度变化 → 直接落位，避免「从左边滑过去」
    if (lastXRef.current === null) {
      lastXRef.current = target.x;
      x.setValue(target.x);
      return;
    }
    if (Math.abs(lastXRef.current - target.x) < 0.5) {
      lastXRef.current = target.x;
      return;
    }
    lastXRef.current = target.x;
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
            <SelectorCapsule radius={(height - 6) / 2} dark={palette.name === 'dark'} />
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
