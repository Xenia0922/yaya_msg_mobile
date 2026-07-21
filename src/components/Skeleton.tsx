/**
 * 骨架屏组件 —— 用于替换「加载中...」+ 转圈圈 的加载态。
 *
 * 设计原则（呼应全局优化要求）：
 *   - 不出现任何「加载中 / 转圈」字样与图标
 *   - 用与真实内容同构的占位块 + 微光呼吸，降低「等待感」
 *   - 纯 RN Animated 实现，零额外依赖
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, ViewStyle } from 'react-native';

const BASE = '#e9e9ef';
const SHIMMER = '#f4f4f8';

function useShimmer() {
  const ref = useRef(new Animated.Value(0));
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(ref.current, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(ref.current, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return ref.current;
}

function Shimmer({ dark }: { dark?: boolean }) {
  const v = useShimmer();
  const from = dark ? '#2a2a2e' : BASE;
  const to = dark ? '#3a3a40' : SHIMMER;
  const bg = v.interpolate({ inputRange: [0, 1], outputRange: [from, to] });
  return <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: bg }]} />;
}

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: ViewStyle;
  dark?: boolean;
}

export function Skeleton({ width = '100%', height = 14, radius = 6, style, dark }: SkeletonProps) {
  return (
    <View
      style={[
        { width: width as any, height: height as any, borderRadius: radius, overflow: 'hidden', backgroundColor: dark ? '#2a2a2e' : BASE },
        style,
      ]}
    >
      <Shimmer dark={dark} />
    </View>
  );
}

/** 一条列表行占位（头像 + 两行文字）。 */
export function SkeletonRow({ dark }: { dark?: boolean }) {
  return (
    <View style={[styles.row, dark && styles.rowDark]}>
      <Skeleton width={48} height={48} radius={24} dark={dark} />
      <View style={styles.rowBody}>
        <Skeleton width="70%" height={14} radius={6} dark={dark} />
        <Skeleton width="92%" height={12} radius={6} dark={dark} style={{ marginTop: 8 }} />
      </View>
    </View>
  );
}

/** 列表骨架（count 行）。 */
export function SkeletonList({ count = 8, dark }: { count?: number; dark?: boolean }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} dark={dark} />
      ))}
    </View>
  );
}

/** 整屏骨架（顶部工具条 + 内容）。用于首屏加载，避免「转圈 + 空列表 + 工具条文案」叠加。 */
export function ScreenSkeleton({ dark }: { dark?: boolean }) {
  return (
    <View style={styles.screen}>
      <View style={[styles.bar, dark && styles.barDark]}>
        <Skeleton width={28} height={28} radius={14} dark={dark} />
        <Skeleton width={120} height={16} radius={8} dark={dark} style={{ marginLeft: 12 }} />
        <View style={{ flex: 1 }} />
        <Skeleton width={44} height={28} radius={14} dark={dark} />
      </View>
      <SkeletonList count={8} dark={dark} />
    </View>
  );
}

/** 网格骨架（相册/图片）。 */
export function SkeletonGrid({ count = 10, dark }: { count?: number; dark?: boolean }) {
  return (
    <View style={styles.grid}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} width="100%" height={120} radius={10} dark={dark} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  rowDark: {},
  rowBody: { flex: 1, marginLeft: 12 },
  screen: { flex: 1, backgroundColor: 'transparent' },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.06)' },
  barDark: { borderColor: 'rgba(255,255,255,0.08)' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: 8 },
});
