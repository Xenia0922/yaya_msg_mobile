
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
  /**
   * ⚠️ 双层位移结构（用户反馈：大小房间切换完成后胶囊抖动）：
   *  - xTap（外层，native driver）：点击/外部 value 变化的 spring —— 原生线程驱动，
   *    切换完成后的重渲染（聊天列表 N 个玻璃气泡）再忙也**不会卡住胶囊动画**；
   *  - xDrag（内层，JS driver）：仅拖动时承载手指偏移（drag 需要 JS setValue，
   *    单值无法既 native 又可 setValue —— 铁律见文件头）。
   *  视觉位置 = xTap + xDrag（两层嵌套 transform 相加）。非拖动时 xDrag 恒 0。
   */
  const xDrag = useRef(new Animated.Value(0)).current;
  const xTapRef = useRef(0);
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

  /**
   * 点击/外部变更吸附。
   *
   * ⚠️ 必须 JS 驱动（2026-10-18 修复「滑过去又弹回左边再滑回去」）：
   * native driver 把值托管给原生后，JS 侧仍持有旧值；父级重渲染（列表/弹幕刷新）时
   * RN 会用 JS 旧值重建该节点的 transform，随后原生动画再把它推回目标 →
   * 视觉上就是「先到位 → 弹回原位 → 再滑到位」。
   * 工程铁律同样适用于此：跟手/可被 JS 复位的值一律 useNativeDriver:false。
   */
  /** 松手/外部变更：清掉拖拽偏移，胶囊位置由 idx 直接决定（无位移动画） */
  const settle = (_target: number) => {
    xTapRef.current = _target;
    xDrag.setValue(0);
  };

  /**
   * 只在「页签真的变了」时做弹簧动画。
   *
   * ⚠️ 2026-10-18 修「胶囊滑过去又弹回左边再滑回来」：
   * cellW 由 trackW 算出，首次布局（0 → 真实宽）或父级重排都会让它变一次；
   * 之前无脑 `settle(idx*cellW)`，等于每次都从索引 0 的位置重新弹一遍 ——
   * 视觉上就是「到位 → 弹回左边 → 又滑回右边」。
   * 现在：布局变化（idx 未变）直接落位、不做动画；只有 idx 变化才 spring。
   */
  const lastIdxRef = useRef(idx);
  useEffect(() => {
    if (draggingRef.current) return;
    if (cellW <= 0) return; // 还没量到宽度：什么都不做（避免 settle(0)）
    const target = idx * cellW;
    const idxChanged = idx !== lastIdxRef.current;
    lastIdxRef.current = idx;
    if (!idxChanged) {
      // 仅布局宽度变化 → 瞬时落位
      xTapRef.current = target;
      xDrag.setValue(0);
      return;
    }
    settle(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, cellW]);

  const pan = useRef(
    PanResponder.create({
      // 点击不抢：只有横向拖动才接管，保证各格 Pressable 的点击照常触发
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        draggingRef.current = true;
        // 拖动基准 = 逻辑吸附位（xTapRef 在 settle 时同步）。native 值无法从 JS 读取，
        // 若在 spring 飞行中抓住会先吸附到逻辑位再跟手 —— 两格分段可接受的取舍。
        xDrag.setValue(0);
      },
      onPanResponderMove: (_, g) => {
        const n = optionsRef.current.length;
        const cw = cellWRef.current;
        if (!cw) return;
        const limit = Math.max(0, (n - 1) * cw);
        const nx = Math.min(limit, Math.max(0, xTapRef.current + g.dx));
        xDrag.setValue(nx - xTapRef.current);
      },
      onPanResponderRelease: () => {
        draggingRef.current = false;
        const n = optionsRef.current.length;
        const cw = cellWRef.current;
        if (!cw) return;
        const dragOff = Number((xDrag as any)._value || 0);
        const pos = xTapRef.current + dragOff;
        const h = Math.min(n - 1, Math.max(0, Math.round(pos / cw)));
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
          /* ⚠️ 胶囊位置 = left: 3 + idx*cellW，**直接跟随选中的索引**，不做位移动画（2026-10-18 第三次修）。
             前两版用 spring/timing 驱动 translateX，只要父级 value 在切换瞬间有回退
             （点击 → 父级重渲染 → 旧值先回来 → 新值再到），胶囊就会「右边 → 弹回左边 → 再回右边」。
             现在位移只由索引决定，父级怎么抖都不会产生二次位移动画；
             拖拽跟手用内层 xDrag（Animated，JS 驱动）叠加，松手直接归零吸附到最近格。 */
          <View
            pointerEvents="none"
            style={[styles.pillPos, { left: pad + idx * cellW, width: cellW, height: height - pad * 2 }]}
          >
            <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: xDrag }] }]}>
              <SelectorCapsule radius={(height - pad * 2) / 2} dark={palette.name === 'dark'} />
            </Animated.View>
          </View>
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
