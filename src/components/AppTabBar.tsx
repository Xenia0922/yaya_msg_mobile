/**
 * AppTabBar · iOS 26 Liquid Glass 底栏
 *
 * 行为对齐 iOS 26（WWDC25 session 284 / HIG）：
 *  - 底栏悬浮胶囊，材质走 GlassSurface（floatingTabBar 预设）
 *  - 选中指示器 = 一块**跟手滑动的玻璃胶囊**：按住底栏横向拖动时它跟着手指走，
 *    松手 spring 到最近的 tab 并切换（对应 Apple「按住拖过不同 tab，玻璃液化成软胶跟手迁移」）
 *  - 图标 spring 弹跳 + 按压反馈 + 安全留白
 *
 * 实现要点：
 *  - 手势用 PanResponder 且 `onStartShouldSetPanResponder: () => false`，
 *    只有横向位移 > 6px 才接管 → 点击仍然正常落到各 tab 的 Pressable 上
 *  - 指示器位移用 native driver 的 translateX（不触发 JS 帧）
 *
 * 后续（未做）：`LiquidGlassContainer` 的平滑 min 融合（拖到隔壁 tab 时拉出「液桥」）、
 * 滚动时底栏缩小/回弹 + 迷你播放器内联。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { GlassSurface } from './GlassSurface';
import { usePalette, motion } from '../theme';
import { typography } from '../theme/typography';

export interface TabBarItem {
  key: string;
  label: string;
  icon: (props: { color: string; size: number }) => React.ReactNode;
}

export interface AppTabBarProps {
  items: TabBarItem[];
  activeKey: string;
  onSelect: (key: string) => void;
}

/** 单格宽度（固定宽 → 指示器位移可直接用 index * CELL_W 算） */
const CELL_W = 76;
/** 底栏左右内边距（与 styles.bar.paddingHorizontal 保持一致） */
const BAR_PAD = 8;

function TabCell({
  item,
  active,
  onSelect,
}: {
  item: TabBarItem;
  active: boolean;
  onSelect: () => void;
}) {
  const palette = usePalette();
  const pop = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    pop.stopAnimation();
    if (active) {
      pop.setValue(0.92);
      const animation = Animated.spring(pop, { toValue: 1, ...motion.spring.bouncy, useNativeDriver: true });
      animation.start();
      return () => animation.stop();
    } else {
      pop.setValue(1);
    }
  }, [active, pop]);

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      hitSlop={6}
      onPress={onSelect}
      style={({ pressed }) => [styles.cell, pressed && { transform: [{ scale: 0.97 }] }]}
    >
      <Animated.View style={[styles.cellIcon, { transform: [{ scale: pop }] }]}>
        {item.icon({ color: active ? palette.tint : palette.labelSecondary, size: 23 })}
      </Animated.View>
      <Text
        style={[
          typography.caption2,
          {
            color: active ? palette.tint : palette.labelSecondary,
            fontWeight: active ? '700' : '600',
            marginTop: 3,
          },
        ]}
      >
        {item.label}
      </Text>
    </Pressable>
  );
}

export function AppTabBar({ items, activeKey, onSelect }: AppTabBarProps) {
  const palette = usePalette();
  const isDark = palette.name === 'dark';

  const activeIndex = Math.max(0, items.findIndex((it) => it.key === activeKey));
  const maxShift = Math.max(0, (items.length - 1) * CELL_W);

  const indX = useRef(new Animated.Value(activeIndex * CELL_W)).current;
  const indXRef = useRef(activeIndex * CELL_W);
  const startXRef = useRef(0);
  /** 拖动时选中玻璃放大（对应 Apple「按住拖动时玻璃膨起」） */
  const dragScale = useRef(new Animated.Value(1)).current;
  const scaleTo = useCallback(
    (v: number) => {
      Animated.spring(dragScale, { toValue: v, ...motion.spring.bouncy, useNativeDriver: true }).start();
    },
    [dragScale],
  );
  /** 拖动中手指当前悬停的格子（用于给「将要选中」的那个 tab 上色） */
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const hoverRef = useRef<number | null>(null);

  // 外部切页（含导航状态变化）时把指示器弹到位
  useEffect(() => {
    if (hoverRef.current != null) return; // 拖动中不要被外部状态拽走
    const target = activeIndex * CELL_W;
    indXRef.current = target;
    Animated.spring(indX, { toValue: target, ...motion.spring.bouncy, useNativeDriver: true }).start();
  }, [activeIndex, indX]);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  const settle = useCallback(
    (x: number) => {
      indXRef.current = x;
      Animated.spring(indX, { toValue: x, ...motion.spring.bouncy, useNativeDriver: true }).start();
    },
    [indX],
  );

  const pan = useRef(
    PanResponder.create({
      // 点击不抢：只有横向拖动才接管，保证 tab 的点击照常触发
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        indX.stopAnimation((v: number) => {
          indXRef.current = v;
          startXRef.current = v;
        });
        hoverRef.current = Math.round(indXRef.current / CELL_W);
        setHoverIndex(hoverRef.current);
        scaleTo(1.12);
      },
      onPanResponderMove: (_, g) => {
        const limit = Math.max(0, (itemsRef.current.length - 1) * CELL_W);
        const nx = Math.min(limit, Math.max(0, startXRef.current + g.dx));
        indXRef.current = nx;
        indX.setValue(nx);
        const h = Math.round(nx / CELL_W);
        if (h !== hoverRef.current) {
          hoverRef.current = h;
          setHoverIndex(h);
        }
      },
      onPanResponderRelease: () => {
        const n = itemsRef.current.length;
        const h = Math.min(n - 1, Math.max(0, Math.round(indXRef.current / CELL_W)));
        hoverRef.current = null;
        setHoverIndex(null);
        settle(h * CELL_W);
        scaleTo(1);
        const target = itemsRef.current[h];
        if (target && target.key !== activeKeyRef.current) onSelectRef.current(target.key);
      },
      onPanResponderTerminate: () => {
        hoverRef.current = null;
        setHoverIndex(null);
        settle(activeIndexRef.current * CELL_W);
        scaleTo(1);
      },
    }),
  ).current;

  const litIndex = hoverIndex ?? activeIndex;

  return (
    <View pointerEvents="box-none" style={[styles.outer, { paddingBottom: 16 }]}>
      <View style={styles.bar} {...pan.panHandlers}>
        {/* 底栏玻璃材质 */}
        <GlassSurface role="bar" radius={28} asBackground />

        {/* 选中指示器 = 一块真玻璃（带边缘色散），并做「拖动放大」。
            色调分工与用户确认过的观感一致：底栏面 = 浅奶白（GlassSurface 的白纱定色），
            选中态 = 玻璃本体（色散 + 拖动时放大）。
            注意：不能用库的 interactive —— 触摸被底栏的 PanResponder 接管了，
            放大由这里的 scale 动画自己出。 */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.indicator,
            {
              width: CELL_W,
              transform: [{ translateX: indX }, { scale: dragScale }],
            },
          ]}
        >
          {/* 选中态：比底栏多一点体量、且微微偏灰（用户指定），保留虹彩边作为区分 */}
          <GlassSurface role="chip" radius={999} tintColor="rgba(120,120,128,0.26)" iridescence={0.35} />
        </Animated.View>

        {items.map((item, i) => (
          <TabCell
            key={item.key}
            item={item}
            active={i === litIndex}
            onSelect={() => onSelect(item.key)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  bar: {
    flexDirection: 'row',
    borderRadius: 28,
    paddingVertical: 6,
    paddingHorizontal: BAR_PAD,
    minHeight: 64,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.10,
        shadowRadius: 16,
      },
      android: { elevation: 8 },
      default: null,
    }),
  },
  /** 选中指示器：绝对定位 + 由 translateX / scale 驱动（native driver），视觉全交给玻璃 */
  indicator: {
    position: 'absolute',
    top: 6,
    bottom: 6,
    left: BAR_PAD,
    overflow: 'hidden',
  },
  cell: {
    width: CELL_W,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRadius: 28,
  },
  cellIcon: { alignItems: 'center', justifyContent: 'center' },
});

// 辅助：复用项目里的 MaterialCommunityIcons
export function MCI(name: string) {
  return ({ color, size }: { color: string; size: number }) => (
    <MaterialCommunityIcons name={name} color={color} size={size} />
  );
}

export { motion };
