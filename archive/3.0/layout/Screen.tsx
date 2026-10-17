/**
 * v3.0 页面骨架 —— 所有页面都必须套这一层，不再各自拼 ScreenHeader + 手写 paddingTop/Bottom。
 *
 * 结构（自顶向下）：
 *   状态栏留白 → AppBar(48) → [Toolbar(44)] → 分隔线 → children（页面自己持有滚动容器）
 *
 * 为什么让 children 自己滚：
 *   旧版大量「ScrollView 里套 FlatList」→ 两层滚动互相吃手势；v3 规定**一屏只有一个滚动容器**，
 *   由页面在 children 里放 FlatList / ScrollView，Screen 只负责顶部与安全区。
 */
import React from 'react';
import { Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

import { usePalette } from '../../theme';
import { GUTTER, LAYOUT, SPACE, TYPE } from '../tokens';

/** 状态栏留白（与旧版 ScreenHeader 同一策略，保证新老页顶部对齐） */
export function statusTop(): number {
  return Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight || 24) + 10;
}

export type AppBarAction = {
  /** 文字按钮；有 icon 时只显 icon */
  label?: string;
  icon?: string;
  onPress: () => void;
  disabled?: boolean;
};

type ScreenProps = {
  title: string;
  /** 左侧返回（不传则不显示） */
  onBack?: () => void;
  /** 右侧最多 2 个动作 */
  actions?: AppBarAction[];
  /** 工具条内容（分段控件 / 次要筛选）。不传则不占高度 */
  toolbar?: React.ReactNode;
  children: React.ReactNode;
};

/**
 * 页面骨架。顶栏标题左对齐、动作右对齐，两侧都用 GUTTER —— 全站只有这一条基准线。
 */
export function Screen({ title, onBack, actions, toolbar, children }: ScreenProps) {
  const palette = usePalette();
  return (
    <View style={[styles.root, { backgroundColor: 'transparent' }]}>
      <View style={{ height: statusTop() }} />
      <View style={styles.appBar}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.back}>
            <MaterialCommunityIcons name="chevron-left" size={26} color={palette.label} />
          </TouchableOpacity>
        ) : null}
        <Text style={[styles.title, TYPE.title, { color: palette.label }]} numberOfLines={1}>{title}</Text>
        <View style={styles.actions}>
          {(actions || []).slice(0, 2).map((a, i) => (
            <TouchableOpacity
              key={`${a.label || a.icon}-${i}`}
              onPress={a.onPress}
              disabled={a.disabled}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[styles.action, a.disabled ? { opacity: 0.4 } : null]}
            >
              {a.icon ? (
                <MaterialCommunityIcons name={a.icon as any} size={20} color={palette.labelSecondary} />
              ) : (
                <Text style={[TYPE.secondary, { color: palette.tint }]}>{a.label}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>
      {toolbar ? (
        <>
          <View style={styles.toolbar}>{toolbar}</View>
          <View style={[styles.hairline, { backgroundColor: palette.hairline }]} />
        </>
      ) : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  appBar: {
    height: LAYOUT.appBar,
    paddingHorizontal: GUTTER,
    flexDirection: 'row',
    alignItems: 'center',
  },
  back: { marginLeft: -6, marginRight: SPACE.xs },
  title: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  action: { minWidth: 24, alignItems: 'flex-end' },
  toolbar: {
    height: LAYOUT.toolbar,
    paddingHorizontal: GUTTER,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
  },
  hairline: { height: StyleSheet.hairlineWidth, marginHorizontal: GUTTER },
  body: { flex: 1 },
});
