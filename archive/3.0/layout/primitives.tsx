/**
 * v3.0 布局原语 —— 只做「排版」，不含任何业务。
 *
 * 设计约束（对应 README 的规则）：
 *  - 分组用间距（Divider）而不是卡片；Section 只提供标题 + 右侧动作，不画底框。
 *  - 列表行统一 56 高 + GUTTER 内边距；行与行之间用 hairline 分隔（不是每行一个圆角卡）。
 *  - Grid 的 gap 必须 ≥ 圆角（用同一 token 里的值算），否则卡片会视觉粘连。
 */
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

import { usePalette } from '../../theme';
import { GUTTER, LAYOUT, R, SPACE, TYPE } from '../tokens';

/** 区块标题：左侧 17px 标题，右侧可选动作。不画底框 —— 分组靠它上方的 Divider + 间距 */
export function SectionHeader({ title, action }: { title: string; action?: { label: string; onPress: () => void } }) {
  const palette = usePalette();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[TYPE.title, { color: palette.label, flex: 1 }]} numberOfLines={1}>{title}</Text>
      {action ? (
        <Text
          onPress={action.onPress}
          style={[TYPE.secondary, { color: palette.tint }]}
          suppressHighlighting
        >
          {action.label}
        </Text>
      ) : null}
    </View>
  );
}

/** 分隔线：同页区块之间唯一的"切块"手段 */
export function Divider({ inset = GUTTER }: { inset?: number }) {
  const palette = usePalette();
  return <View style={{ height: StyleSheet.hairlineWidth, marginLeft: inset, backgroundColor: palette.hairline }} />;
}

/** 分组容器：只负责上下间距（组间用 lg），不画背景、不画圆角、不描边 */
export function Group({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return <View style={{ paddingTop: first ? 0 : SPACE.lg }}>{children}</View>;
}

/**
 * 列表行：rank / avatar / 主标题+副标题 / 右侧数值。
 * 所有页面共用同一套行结构，保证「眼睛扫过时左边缘与右边缘都不跳」。
 */
export function ListRow({
  leading,
  avatar,
  title,
  subtitle,
  value,
  valueHint,
  onPress,
  highlightValue,
}: {
  /** 左侧固定宽度的序号（右对齐，等宽数字） */
  leading?: React.ReactNode;
  /** 头像（36 圆），可选 */
  avatar?: string;
  title: string;
  subtitle?: string;
  /** 右侧主数值（等宽字体、右对齐） */
  value?: string;
  /** 数值下方的小字（如"较上周 +3"） */
  valueHint?: string;
  onPress?: () => void;
  /** 主数值用主色（一屏只给关键数字用） */
  highlightValue?: boolean;
}) {
  const palette = usePalette();
  return (
    <View
      style={styles.row}
      onTouchEnd={onPress}
    >
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      {avatar ? (
        <Image source={{ uri: avatar }} style={[styles.avatar, { backgroundColor: 'transparent' }]} />
      ) : null}
      <View style={styles.rowMain}>
        <Text style={[TYPE.body, { color: palette.label }]} numberOfLines={1}>{title}</Text>
        {subtitle ? (
          <Text style={[TYPE.caption, { color: palette.labelTertiary, marginTop: 2 }]} numberOfLines={1}>{subtitle}</Text>
        ) : null}
      </View>
      {value ? (
        <View style={styles.valueWrap}>
          <Text
            style={[
              TYPE.body,
              styles.valueText,
              { color: highlightValue ? palette.tint : palette.label },
            ]}
            numberOfLines={1}
          >
            {value}
          </Text>
          {valueHint ? (
            <Text style={[TYPE.caption, styles.valueText, { color: palette.labelTertiary, marginTop: 2 }]} numberOfLines={1}>
              {valueHint}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** 空态：图标 + 一行标题 + 一行说明。不用大插画，保持安静 */
export function EmptyHint({ icon = 'inbox-outline', title, hint }: { icon?: string; title: string; hint?: string }) {
  const palette = usePalette();
  return (
    <View style={styles.empty}>
      <MaterialCommunityIcons name={icon as any} size={34} color={palette.labelTertiary} />
      <Text style={[TYPE.body, { color: palette.labelSecondary, marginTop: SPACE.md }]}>{title}</Text>
      {hint ? (
        <Text style={[TYPE.caption, { color: palette.labelTertiary, marginTop: SPACE.xs, textAlign: 'center' }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

/**
 * 网格：列数固定 + gap 与圆角同源。
 * 单元格用 width 百分比而不是 flex:1 —— 奇数张时最后一张不会被拉成整行。
 */
export function gridCellWidth(columns: number): `${number}%` {
  return `${100 / columns}%` as `${number}%`;
}

export const GRID_GAP = SPACE.sm + SPACE.xs; // 12：必须 ≥ R.sm(8)
export const GRID_RADIUS = R.sm;

const styles = StyleSheet.create({
  sectionHeader: {
    height: 40,
    paddingHorizontal: GUTTER,
    flexDirection: 'row',
    alignItems: 'center',
  },
  row: {
    minHeight: LAYOUT.row,
    paddingHorizontal: GUTTER,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
  },
  leading: { minWidth: 28, alignItems: 'flex-end' },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  rowMain: { flex: 1, justifyContent: 'center' },
  valueWrap: { alignItems: 'flex-end' },
  valueText: { fontVariant: ['tabular-nums'] },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACE.xl },
});
