/**
 * SectionHeader：iOS 26 风格分组标题
 *  - 顶部大标题（inset 风格）
 *  - 副标题小字（可选）
 *  - 右侧可放操作按钮（如"查看更多"）
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePalette } from '../theme';
import { typography } from '../theme/typography';
import { insets } from '../theme/spacing';

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  /** 右侧操作按钮 label + onPress（iOS "更多"风格） */
  actionLabel?: string;
  onAction?: () => void;
  /** largeTitle 风格（默认 section header 是 title3） */
  large?: boolean;
}

export function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
  large,
}: SectionHeaderProps) {
  const palette = usePalette();
  return (
    <View style={[styles.container, { paddingHorizontal: insets.screenHorizontal }]}>
      <View style={{ flex: 1 }}>
        <Text
          style={[
            large ? typography.largeTitle : typography.title3,
            { color: palette.label },
          ]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={[typography.subhead, { color: palette.labelSecondary, marginTop: 2 }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={10}>
          <Text
            style={[
              typography.subhead,
              { color: palette.tint, fontWeight: '600' },
            ]}
          >
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingTop: 24,
    paddingBottom: 8,
  },
});
