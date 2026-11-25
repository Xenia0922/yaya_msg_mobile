import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { GlassSurface } from './GlassSurface';
import { usePalette, motion } from '../theme';
import { typography } from '../theme/typography';

export interface TabBarItem {
  key: string;
  label: string;
  icon: (props: { color: string; size: number }) => React.ReactNode;
  badgeDot?: boolean;
}

export interface AppTabBarProps {
  items: TabBarItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  hidden?: boolean;
}

const BAR_HEIGHT = 64;
const BAR_PAD = 4;
const INNER_RADIUS = (BAR_HEIGHT - BAR_PAD * 2) / 2;

const PILL_SPRING = { damping: 22, stiffness: 300 } as const;

const TabCell = React.memo(function TabCell({
  item,
  active,
  width,
}: {
  item: TabBarItem;
  active: boolean;
  width: number;
}) {
  const palette = usePalette();
  const popSV = useSharedValue(1);
  const prevActiveRef = useRef(active);

  useEffect(() => {
    const prev = prevActiveRef.current;
    prevActiveRef.current = active;
    if (active && !prev) {
      popSV.value = 0.92;
      popSV.value = withSpring(1, { damping: 20, stiffness: 320 });
    } else if (!active && prev) {
      popSV.value = 1;
    }
  }, [active, popSV]);

  const iconAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: popSV.value }],
  }));

  return (
    <View
      accessible
      accessibilityRole="tab"
      accessibilityLabel={item.label}
      accessibilityState={{ selected: active }}
      style={[styles.cell, { width }]}
    >
      <Reanimated.View style={[styles.cellIcon, iconAnimStyle]}>
        {item.icon({ color: active ? palette.tint : palette.labelSecondary, size: 23 })}
        {item.badgeDot ? (
          <View
            style={[
              styles.badgeDot,
              { borderColor: palette.name === 'dark' ? '#1E1E24' : '#FFFFFF' },
            ]}
          />
        ) : null}
      </Reanimated.View>
      <Text
        numberOfLines={1}
        style={[
          typography.caption2,
          {
            color: active ? palette.tint : palette.labelSecondary,
            fontWeight: active ? '600' : Platform.OS === 'android' ? '500' : '600',
            includeFontPadding: false,
            marginTop: 3,
          },
        ]}
      >
        {item.label}
      </Text>
    </View>
  );
});

export const AppTabBar = React.memo(function AppTabBar({
  items,
  activeKey,
  onSelect,
  hidden = false,
}: AppTabBarProps) {
  const palette = usePalette();
  const isDark = palette.name === 'dark';
  const { width: winW } = useWindowDimensions();

  const activeIndex = Math.max(
    0,
    items.findIndex((it) => it.key === activeKey),
  );

  const availableW = Math.min(winW, 520) - 32 - BAR_PAD * 2;
  const cellW = Math.max(1, Math.floor(availableW / Math.max(1, items.length)));

  const posSV = useSharedValue(activeIndex * cellW);
  const dragStartSV = useSharedValue(activeIndex * cellW);
  const dragScaleSV = useSharedValue(1);
  const dragStretchSV = useSharedValue(1);
  const draggingSV = useSharedValue(false);
  const followFingerSV = useSharedValue(false);
  const cellWSV = useSharedValue(cellW);
  const countSV = useSharedValue(items.length);
  const idxSV = useSharedValue(activeIndex);
  const targetIdxSV = useSharedValue(activeIndex);
  const lastHoverSV = useSharedValue(-1);

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const rollbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTargetRef = useRef<{ idx: number; ts: number } | null>(null);
  const lastSpringIdxRef = useRef(activeIndex);
  const lastCellWRef = useRef(cellW);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const cellWRef = useRef(cellW);
  cellWRef.current = cellW;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useLayoutEffect(() => {
    cellWSV.value = cellW;
    countSV.value = items.length;
    idxSV.value = activeIndex;
    const widthChanged = Math.abs(lastCellWRef.current - cellW) > 0.5;
    const pending = pendingTargetRef.current;

    if (pending) {
      if (activeIndex === pending.idx) {
        pendingTargetRef.current = null;
        if (rollbackTimerRef.current) {
          clearTimeout(rollbackTimerRef.current);
          rollbackTimerRef.current = null;
        }
      } else if (Date.now() - pending.ts < 800 && !widthChanged) {
        return;
      }
    }
    if (rollbackTimerRef.current) {
      clearTimeout(rollbackTimerRef.current);
      rollbackTimerRef.current = null;
    }
    const idxChanged = activeIndex !== lastSpringIdxRef.current;
    lastCellWRef.current = cellW;
    targetIdxSV.value = activeIndex;
    if (!draggingSV.value && (idxChanged || widthChanged)) {
      lastSpringIdxRef.current = activeIndex;
      posSV.value = withSpring(activeIndex * cellW, PILL_SPRING);
    }
  }, [activeIndex, cellW, items.length, cellWSV, countSV, draggingSV, idxSV, posSV, targetIdxSV]);

  useEffect(
    () => () => {
      if (rollbackTimerRef.current) clearTimeout(rollbackTimerRef.current);
    },
    [],
  );

  const commitIndex = useCallback(
    (nextIdx: number) => {
      const target = itemsRef.current[nextIdx];
      if (!target) return;
      lastSpringIdxRef.current = nextIdx;
      pendingTargetRef.current = { idx: nextIdx, ts: Date.now() };
      if (target.key === activeKeyRef.current) return;
      if (rollbackTimerRef.current) clearTimeout(rollbackTimerRef.current);
      onSelectRef.current(target.key);

      rollbackTimerRef.current = setTimeout(() => {
        rollbackTimerRef.current = null;
        if (pendingTargetRef.current?.idx === nextIdx) {
          pendingTargetRef.current = null;
        }
        if (!draggingSV.value && activeIndexRef.current !== nextIdx) {
          lastSpringIdxRef.current = activeIndexRef.current;
          targetIdxSV.value = activeIndexRef.current;
          posSV.value = withSpring(activeIndexRef.current * cellWRef.current, PILL_SPRING);
        }
      }, 1800);
    },
    [draggingSV, posSV, targetIdxSV],
  );

  const finishDrag = useCallback(
    (nextIdx: number, shouldCommit: boolean) => {
      setHoverIndex(null);
      if (shouldCommit) commitIndex(nextIdx);
    },
    [commitIndex],
  );

  const composedGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .activeOffsetX([-14, 14])
      .failOffsetY([-12, 12])
      .maxPointers(1)
      .onStart((e) => {
        'worklet';
        const cw = cellWSV.value;
        const n = countSV.value;
        if (cw <= 0 || n <= 1) return;
        const limit = (n - 1) * cw;
        draggingSV.value = true;
        dragScaleSV.value = withSpring(1.08, { damping: 20, stiffness: 320 });
        dragStretchSV.value = withSpring(1.04, { damping: 20, stiffness: 320 });
        const fingerX = e.x - BAR_PAD;
        const indCenter = posSV.value + cw / 2;
        if (Math.abs(fingerX - indCenter) <= cw * 0.65) {
          followFingerSV.value = false;
          dragStartSV.value = posSV.value;
        } else {
          followFingerSV.value = true;
          const next = Math.min(limit, Math.max(0, fingerX - cw / 2));
          dragStartSV.value = next;
          posSV.value = withSpring(next, { damping: 24, stiffness: 360 });
        }
        const h = Math.min(n - 1, Math.max(0, Math.round(posSV.value / cw)));
        lastHoverSV.value = h;
        runOnJS(setHoverIndex)(h);
      })
      .onUpdate((e) => {
        'worklet';
        const cw = cellWSV.value;
        const n = countSV.value;
        if (cw <= 0 || n <= 1) return;
        const limit = (n - 1) * cw;
        const nx = followFingerSV.value
          ? Math.min(limit, Math.max(0, e.x - BAR_PAD - cw / 2))
          : Math.min(limit, Math.max(0, dragStartSV.value + e.translationX));
        posSV.value = nx;
        const moved = Math.abs(nx - dragStartSV.value) / cw;
        dragStretchSV.value = Math.min(1.24, 1.04 + moved * 0.2);
        const h = Math.min(n - 1, Math.max(0, Math.round(nx / cw)));
        if (h !== lastHoverSV.value) {
          lastHoverSV.value = h;
          runOnJS(setHoverIndex)(h);
        }
      })
      .onEnd((e, success) => {
        'worklet';
        const cw = cellWSV.value;
        const n = countSV.value;
        draggingSV.value = false;
        dragScaleSV.value = withSpring(1, PILL_SPRING);
        dragStretchSV.value = withSpring(1, PILL_SPRING);
        lastHoverSV.value = -1;
        if (cw <= 0 || n <= 0) {
          runOnJS(finishDrag)(idxSV.value, false);
          return;
        }
        const curIdx = idxSV.value;
        if (!success) {
          posSV.value = withSpring(curIdx * cw, PILL_SPRING);
          runOnJS(finishDrag)(curIdx, false);
          return;
        }
        let h = Math.min(n - 1, Math.max(0, Math.round(posSV.value / cw)));

        if (
          !followFingerSV.value &&
          h === curIdx &&
          (Math.abs(e.translationX) >= Math.min(18, cw * 0.22) || Math.abs(e.velocityX) >= 120)
        ) {
          h = Math.min(n - 1, Math.max(0, curIdx + (e.translationX > 0 ? 1 : -1)));
        }
        targetIdxSV.value = h;
        posSV.value = withSpring(h * cw, PILL_SPRING);
        runOnJS(finishDrag)(h, h !== curIdx);
      });

    const tap = Gesture.Tap()
      .maxDistance(12)
      .onEnd((e, success) => {
        'worklet';
        if (!success) return;
        const cw = cellWSV.value;
        const n = countSV.value;
        if (cw <= 0 || n <= 0) return;
        const h = Math.min(n - 1, Math.max(0, Math.floor((e.x - BAR_PAD) / cw)));
        if (h !== targetIdxSV.value) {
          targetIdxSV.value = h;
          posSV.value = withSpring(h * cw, PILL_SPRING);
          runOnJS(commitIndex)(h);
        }
      });

    return Gesture.Race(pan, tap);
  }, [
    cellWSV,
    commitIndex,
    countSV,
    dragScaleSV,
    dragStartSV,
    dragStretchSV,
    draggingSV,
    finishDrag,
    followFingerSV,
    idxSV,
    lastHoverSV,
    posSV,
    targetIdxSV,
  ]);

  const indicatorAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: posSV.value },
      { scaleX: dragStretchSV.value },
      { scaleY: dragScaleSV.value },
    ],
  }));

  const barVisibility = useSharedValue(hidden ? 0 : 1);

  useEffect(() => {
    barVisibility.value = withTiming(hidden ? 0 : 1, {
      duration: 175,
      easing: Easing.out(Easing.cubic),
    });
  }, [hidden, barVisibility]);

  const barAnimStyle = useAnimatedStyle(() => ({
    opacity: barVisibility.value,
    transform: [{ translateY: (1 - barVisibility.value) * 14 }],
  }));

  const litIndex = hoverIndex ?? activeIndex;

  return (
    <Reanimated.View
      pointerEvents={hidden ? 'none' : 'box-none'}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      style={[styles.outer, { paddingBottom: 16 }, barAnimStyle]}
    >
      <GestureDetector gesture={composedGesture}>
        <GlassSurface role="bar" radius={BAR_HEIGHT / 2} frostedOnly={hidden} style={styles.bar}>
          <Reanimated.View
            pointerEvents="none"
            style={[styles.indicator, { width: cellW }, indicatorAnimStyle]}
          >
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  borderRadius: INNER_RADIUS,
                  borderCurve: 'continuous',
                  backgroundColor:
                    hoverIndex !== null
                      ? isDark
                        ? 'rgba(255,255,255,0.11)'
                        : 'rgba(255,255,255,0.62)'
                      : isDark
                        ? 'rgba(255,255,255,0.16)'
                        : 'rgba(255,255,255,0.78)',
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.88)',
                },
              ]}
            />
          </Reanimated.View>
          {items.map((item, i) => (
            <TabCell key={item.key} item={item} active={i === litIndex} width={cellW} />
          ))}
        </GlassSurface>
      </GestureDetector>
    </Reanimated.View>
  );
});

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
    borderRadius: BAR_HEIGHT / 2,
    borderCurve: 'continuous',
    paddingVertical: BAR_PAD,
    paddingHorizontal: BAR_PAD,
    height: BAR_HEIGHT,
    minHeight: BAR_HEIGHT,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 16,
      },
      android: null,
      default: null,
    }),
  },

  indicator: {
    position: 'absolute',
    top: BAR_PAD,
    bottom: BAR_PAD,
    left: BAR_PAD,
    borderRadius: INNER_RADIUS,
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRadius: INNER_RADIUS,
  },
  cellIcon: { alignItems: 'center', justifyContent: 'center' },
  badgeDot: {
    position: 'absolute',
    top: -2,
    right: -5,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#FF3B30',
    borderWidth: 1.5,
  },
});

export function MCI(name: string) {
  return ({ color, size }: { color: string; size: number }) => (
    <MaterialCommunityIcons name={name} color={color} size={size} />
  );
}

export { motion };
