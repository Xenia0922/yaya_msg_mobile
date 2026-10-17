/**
 * v3.0 分段控件（重写，不复用 GlassSegmented）
 *
 * 为什么重写：
 *  - 旧版是「半屏宽的实心粉胶囊」，且和日期胶囊同形 → 两个控件同层级、同形状，眼睛分不清主次。
 *  - 旧版用 BlurView 做滑动胶囊，Android 原生驱动位移时 backdrop 裁剪框不跟随 → 胶囊被竖切。
 *
 * v3 规则：
 *  - 轨道 = 实底 fill2（**不用玻璃**，玻璃只留给底栏/弹层/浮窗）；
 *  - 选中 = 实底 tint + onTint 文字，**一动到底**（指示器只做 transform，不做宽度动画）；
 *  - 尺寸由内容决定（不是 flex:1 铺满），这样它旁边还能放第二个控件。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { usePalette } from '../../theme';
import { DURATION, R, TYPE } from '../tokens';

export type SegmentedOption<K extends string> = { key: K; label: string };

export function Segmented<K extends string>({
  options,
  value,
  onChange,
  cellWidth,
}: {
  options: SegmentedOption<K>[];
  value: K;
  onChange: (key: K) => void;
  /** 单个格宽；不传则按最长文案估算（保证胶囊与格子严格等宽） */
  cellWidth?: number;
}) {
  const palette = usePalette();
  const pad = 3;
  const longest = Math.max(...options.map((o) => o.label.length), 2);
  const cell = cellWidth ?? Math.max(56, longest * 14 + 20);
  const trackW = cell * options.length + pad * 2;

  const idx = Math.max(0, options.findIndex((o) => o.key === value));
  const x = useRef(new Animated.Value(idx * cell)).current;

  // 只有「值变了」才动；首帧直接定位，避免从左上角飞过来
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      x.setValue(idx * cell);
      return;
    }
    Animated.timing(x, {
      toValue: idx * cell,
      duration: DURATION.base,
      useNativeDriver: true,
    }).start();
  }, [idx, cell, x]);

  return (
    <View style={[styles.track, { width: trackW, backgroundColor: palette.fill2, padding: pad }]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.indicator,
          { width: cell, backgroundColor: palette.tint, transform: [{ translateX: x }] },
        ]}
      />
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => !active && onChange(o.key)}
            style={[styles.cell, { width: cell }]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text
              numberOfLines={1}
              style={[
                TYPE.secondary,
                { color: active ? palette.onTint : palette.labelSecondary, fontWeight: active ? '700' : '500' },
              ]}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 36, borderRadius: R.pill, flexDirection: 'row', alignItems: 'center' },
  indicator: { position: 'absolute', left: 3, top: 3, bottom: 3, borderRadius: R.pill },
  cell: { height: 30, alignItems: 'center', justifyContent: 'center' },
});
