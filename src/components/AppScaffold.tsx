/**
 * AppScaffold · iOS 26 页面脚手架
 *  - 顶部 largeTitle 顶栏（毛玻璃悬浮）
 *  - 内容区 ScrollView / FlatList 注入
 *  - safe area
 *  - onScroll 时顶栏收缩（iOS 系统行为；本轮先简化，不实现收缩）
 */
import React from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from '../hooks/useSafeAreaInsets';
import { usePalette } from '../theme';
import { typography } from '../theme/typography';

export interface AppScaffoldProps {
  title?: string;
  subtitle?: string;
  /** right-aligned trailing node (button / icon) */
  trailing?: React.ReactNode;
  /** left-aligned leading node (back button etc.) */
  leading?: React.ReactNode;
  /** content node */
  children: React.ReactNode;
  /** hide top bar entirely (for full-bleed pages) */
  noTopBar?: boolean;
  /** background color override */
  bg?: string;
  style?: ViewStyle;
}

export function AppScaffold({
  title,
  subtitle,
  trailing,
  leading,
  children,
  noTopBar,
  bg,
  style,
}: AppScaffoldProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const bgColor = bg ?? palette.background;

  return (
    <View style={[styles.outer, { backgroundColor: bgColor }, style]}>
      {!noTopBar ? (
        <View
          style={[
            styles.topBar,
            {
              paddingTop: insets.top + 6,
              backgroundColor: noTopBar ? 'transparent' : bgColor,
            },
          ]}
        >
          <View style={styles.side}>{leading}</View>
          <View style={styles.side}>{trailing}</View>
        </View>
      ) : null}
      {title && !noTopBar ? (
        <View style={[styles.titleRow, { paddingHorizontal: 20 }]}>
          <Text numberOfLines={2} style={[typography.largeTitle, { color: palette.label, lineHeight: 38 }]}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[typography.subhead, { color: palette.labelSecondary, marginTop: 4 }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : null}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <View style={{ flex: 1 }}>{children}</View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  titleRow: { paddingTop: 2, paddingBottom: 10 },
  side: { minWidth: 60, flexDirection: 'row', alignItems: 'center' },
});
