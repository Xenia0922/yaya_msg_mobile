import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassSurface } from './GlassSurface';
import { fontFamily, usePalette } from '../theme';

export interface GlassSegmentOption<T extends string> {
  key: T;
  label: string;

  dot?: boolean;
}

function SelectorCapsule({
  radius,
  dark,
  transparentTrack = false,
}: {
  radius: number;
  dark: boolean;
  transparentTrack?: boolean;
}) {
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          borderRadius: radius,
          borderCurve: 'continuous',
          backgroundColor: dark
            ? transparentTrack
              ? 'rgba(255,255,255,0.16)'
              : 'rgba(255,255,255,0.14)'
            : transparentTrack
              ? 'rgba(255,255,255,0.78)'
              : 'rgba(255,255,255,0.96)',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: dark
            ? transparentTrack
              ? 'rgba(255,255,255,0.18)'
              : 'rgba(255,255,255,0.16)'
            : transparentTrack
              ? 'rgba(255,255,255,0.88)'
              : 'rgba(18,22,36,0.06)',
        },
      ]}
    />
  );
}

interface Props<T extends string> {
  options: GlassSegmentOption<T>[];
  value: T;
  onChange: (_key: T) => void;
  style?: StyleProp<ViewStyle>;

  height?: number;

  labelFontSize?: number;

  frostedOnly?: boolean;

  role?: 'chip' | 'bar';
}

export function GlassSegmented<T extends string>({
  options,
  value,
  onChange,
  style,
  height = 36,
  labelFontSize = 14,
  frostedOnly = false,
  role = 'chip',
}: Props<T>) {
  const palette = usePalette();
  const [trackW, setTrackW] = useState(0);
  const idx = Math.max(
    0,
    options.findIndex((o) => o.key === value),
  );
  const pad = 3;
  const cellW = trackW > 0 && options.length > 0 ? (trackW - pad * 2) / options.length : 0;

  const posSV = useSharedValue(0);
  const dragStartSV = useSharedValue(0);
  const dragScaleSV = useSharedValue(1);
  const draggingSV = useSharedValue(false);
  const followFingerSV = useSharedValue(false);
  const cellWSV = useSharedValue(cellW);
  const countSV = useSharedValue(options.length);
  const idxSV = useSharedValue(idx);

  const rollbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const idxRef = useRef(idx);
  idxRef.current = idx;
  const cellWRef = useRef(cellW);
  cellWRef.current = cellW;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const commitIndex = useCallback(
    (nextIdx: number) => {
      const target = optionsRef.current[nextIdx];
      const current = optionsRef.current[idxRef.current];
      if (!target || target.key === current?.key) return;
      if (rollbackTimerRef.current) clearTimeout(rollbackTimerRef.current);
      onChangeRef.current(target.key);

      rollbackTimerRef.current = setTimeout(() => {
        rollbackTimerRef.current = null;
        if (!draggingSV.value && cellWRef.current > 0) {
          posSV.value = withSpring(idxRef.current * cellWRef.current, {
            damping: 22,
            stiffness: 300,
          });
        }
      }, 1000);
    },
    [draggingSV, posSV],
  );

  const prevCellWRef = useRef(0);
  const prevIdxRef = useRef(idx);
  useLayoutEffect(() => {
    cellWSV.value = cellW;
    countSV.value = options.length;
    idxSV.value = idx;
    if (draggingSV.value) return;
    if (rollbackTimerRef.current) {
      clearTimeout(rollbackTimerRef.current);
      rollbackTimerRef.current = null;
    }
    if (cellW > 0) {
      const idxChanged = prevIdxRef.current !== idx;
      const layoutReady = prevCellWRef.current > 0 && Math.abs(prevCellWRef.current - cellW) < 0.5;
      prevCellWRef.current = cellW;
      prevIdxRef.current = idx;
      const target = idx * cellW;
      if (layoutReady && idxChanged) {
        posSV.value = withSpring(target, { damping: 22, stiffness: 300 });
      } else {
        posSV.value = target;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, cellW, options.length]);
  useEffect(
    () => () => {
      if (rollbackTimerRef.current) clearTimeout(rollbackTimerRef.current);
    },
    [],
  );

  const composedGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .activeOffsetX([-3, 3])
      .failOffsetY([-14, 14])
      .onStart((e) => {
        'worklet';
        const cw = cellWSV.value;
        const n = countSV.value;
        if (cw <= 0 || n <= 1) return;
        const limit = (n - 1) * cw;
        const curIdx = idxSV.value;
        const pillLeft = pad + curIdx * cw;
        const pillRight = pillLeft + cw;
        draggingSV.value = true;
        dragScaleSV.value = withSpring(1.04, { damping: 20, stiffness: 320 });

        if (e.x >= pillLeft - 6 && e.x <= pillRight + 6) {
          followFingerSV.value = false;
          dragStartSV.value = posSV.value;
        } else {
          followFingerSV.value = true;
          const next = Math.min(limit, Math.max(0, e.x - pad - cw / 2));
          dragStartSV.value = next;
          posSV.value = withSpring(next, { damping: 24, stiffness: 360 });
        }
      })
      .onUpdate((e) => {
        'worklet';
        const cw = cellWSV.value;
        const n = countSV.value;
        if (cw <= 0 || n <= 1) return;
        const limit = (n - 1) * cw;
        if (followFingerSV.value) {
          posSV.value = Math.min(limit, Math.max(0, e.x - pad - cw / 2));
        } else {
          posSV.value = Math.min(limit, Math.max(0, dragStartSV.value + e.translationX));
        }
      })
      .onEnd((e, success) => {
        'worklet';
        const cw = cellWSV.value;
        const n = countSV.value;
        draggingSV.value = false;
        dragScaleSV.value = withSpring(1, { damping: 20, stiffness: 300 });
        if (cw <= 0 || n <= 0) return;
        const curIdx = idxSV.value;
        if (!success) {
          posSV.value = withSpring(curIdx * cw, { damping: 22, stiffness: 300 });
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
        posSV.value = withSpring(h * cw, { damping: 22, stiffness: 300 });
        if (h !== curIdx) {
          runOnJS(commitIndex)(h);
        }
      });

    const tap = Gesture.Tap()
      .maxDistance(12)
      .onEnd((e, success) => {
        'worklet';
        if (!success) return;
        const cw = cellWSV.value;
        const n = countSV.value;
        if (cw <= 0 || n <= 0) return;
        const h = Math.min(n - 1, Math.max(0, Math.floor((e.x - pad) / cw)));
        posSV.value = withSpring(h * cw, { damping: 22, stiffness: 300 });
        if (h !== idxSV.value) {
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
    draggingSV,
    followFingerSV,
    idxSV,
    posSV,
  ]);

  const pillAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: posSV.value }, { scale: dragScaleSV.value }],
  }));

  if (!options.length) return null;

  return (
    <GlassSurface
      role={role}
      radius={height / 2}
      frostedOnly={frostedOnly}
      tintColor={role === 'bar' || palette.name === 'dark' ? undefined : 'rgba(235,237,245,0.76)'}
      style={[
        styles.track,
        {
          height,
          borderColor:
            role === 'bar'
              ? undefined
              : palette.name === 'dark'
                ? 'rgba(255,255,255,0.12)'
                : 'rgba(18,22,36,0.07)',
        },
        style,
      ]}
    >
      <GestureDetector gesture={composedGesture}>
        <View
          style={styles.row}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0 && options.length > 0 && prevCellWRef.current === 0) {
              const cw = (w - pad * 2) / options.length;
              posSV.value = idx * cw;
              cellWSV.value = cw;
              countSV.value = options.length;
              idxSV.value = idx;
              prevCellWRef.current = cw;
              prevIdxRef.current = idx;
            }
            setTrackW((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
          }}
        >
          {cellW > 0 ? (
            <Reanimated.View
              pointerEvents="none"
              style={[
                styles.pillPos,
                {
                  left: pad,
                  width: cellW,
                  height: height - pad * 2,
                },
                pillAnimatedStyle,
              ]}
            >
              <SelectorCapsule
                radius={(height - pad * 2) / 2}
                dark={palette.name === 'dark'}
                transparentTrack={role === 'bar'}
              />
            </Reanimated.View>
          ) : null}
          {options.map((o) => {
            const active = o.key === value;
            return (
              <View
                key={o.key}
                style={styles.cell}
                accessible
                accessibilityRole="button"
                accessibilityLabel={o.label}
                accessibilityState={{ selected: active }}
              >
                <View style={styles.labelWrap}>
                  {o.dot ? (
                    <View style={[styles.optDot, { backgroundColor: palette.tint }]} />
                  ) : null}
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.label,
                      {
                        fontSize: labelFontSize,
                        color: active
                          ? palette.tint
                          : role === 'bar'
                            ? palette.name === 'light'
                              ? palette.label
                              : 'rgba(255,255,255,0.78)'
                            : palette.labelSecondary,
                      },
                      active && styles.labelActive,
                    ]}
                  >
                    {o.label}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </GestureDetector>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  scrollRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 3 },

  scrollPill: { position: 'absolute', left: 0, top: 3, borderRadius: 999, overflow: 'hidden' },
  scrollCell: { paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },

  track: { overflow: 'hidden', alignSelf: 'stretch' },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 3 },

  pillPos: { position: 'absolute', left: 3, top: 3 },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  labelWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  optDot: { width: 6, height: 6, borderRadius: 3 },
  label: {
    fontSize: 14,
    lineHeight: 18,
    fontFamily: fontFamily.system,
    includeFontPadding: false,
    textAlignVertical: 'center',
    ...Platform.select({ android: { paddingTop: 1 }, default: null }),
  },
  labelActive: { fontWeight: Platform.OS === 'android' ? '600' : '800' },
});

export function GlassSegmentedScroll<T extends string>({
  options,
  value,
  onChange,
  style,
  height = 38,
  labelFontSize = 14,
  frostedOnly = false,
  role = 'chip',
}: Props<T>) {
  const palette = usePalette();
  const [layouts, setLayouts] = useState<{ x: number; w: number }[]>([]);
  const idx = Math.max(
    0,
    options.findIndex((o) => o.key === value),
  );
  const x = useRef(new Animated.Value(0)).current;
  const target = layouts[idx];

  const lastXRef = useRef<number | null>(null);
  useEffect(() => {
    if (!target) return;

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
    Animated.spring(x, {
      toValue: target.x,
      tension: 220,
      friction: 30,
      useNativeDriver: true,
    }).start();
  }, [target, x]);

  if (!options.length) return null;

  return (
    <GlassSurface
      role={role}
      radius={height / 2}
      frostedOnly={frostedOnly}
      tintColor={role === 'bar' || palette.name === 'dark' ? undefined : 'rgba(235,237,245,0.76)'}
      style={[
        styles.track,
        {
          height,
          borderColor:
            role === 'bar'
              ? undefined
              : palette.name === 'dark'
                ? 'rgba(255,255,255,0.12)'
                : 'rgba(18,22,36,0.07)',
        },
        style,
      ]}
    >
      <View style={{ flex: 1, position: 'relative' }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.scrollRow, { paddingRight: 26 }]}
        >
          {target ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.scrollPill,
                { height: height - 6, width: target.w, transform: [{ translateX: x }] },
              ]}
            >
              <SelectorCapsule
                radius={(height - 6) / 2}
                dark={palette.name === 'dark'}
                transparentTrack={role === 'bar'}
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

                    if (cur && Math.abs(cur.x - lx) < 0.5 && Math.abs(cur.w - lw) < 0.5)
                      return prev;
                    const next = [...prev];
                    next[i] = { x: lx, w: lw };
                    return next;
                  });
                }}
                style={[styles.scrollCell, { height }]}
                accessibilityRole="button"
                accessibilityLabel={o.label}
                accessibilityState={{ selected: active }}
              >
                <View style={styles.labelWrap}>
                  {o.dot ? (
                    <View style={[styles.optDot, { backgroundColor: palette.tint }]} />
                  ) : null}
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.label,
                      {
                        fontSize: labelFontSize,
                        color: active
                          ? palette.tint
                          : role === 'bar'
                            ? palette.name === 'light'
                              ? palette.label
                              : 'rgba(255,255,255,0.78)'
                            : palette.labelSecondary,
                      },
                      active && styles.labelActive,
                    ]}
                  >
                    {o.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
        <LinearGradient
          pointerEvents="none"
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          colors={
            palette.name === 'dark'
              ? ['rgba(28,28,31,0)', 'rgba(28,28,31,0.45)']
              : ['rgba(255,255,255,0)', 'rgba(255,255,255,0.42)']
          }
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 22,
            borderTopRightRadius: height / 2,
            borderBottomRightRadius: height / 2,
          }}
        />
      </View>
    </GlassSurface>
  );
}
