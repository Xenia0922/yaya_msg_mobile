/**
 * 统一状态组件 —— 空态 / 错误态（含重试）
 *
 * 设计原则：
 *   - 空态：居中小图标 + 标题 + 可选说明 + 可选操作按钮；
 *   - 错误态：警示图标 + 错误信息 + 「重试」主按钮（审计发现的系统性短板）；
 *   - 全主题化（usePalette），与全站卡片语言一致。
 */
import React from 'react';
import { StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { usePalette } from '../theme';
import { useI18n } from '../i18n';

interface StateViewProps {
  icon?: string;
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
  /** 错误态样式（红色系图标） */
  error?: boolean;
}

export function StateView({ icon, title, hint, actionLabel, onAction, style, error }: StateViewProps) {
  const palette = usePalette();
  const { t } = useI18n();
  const glyph = icon || (error ? 'alert-circle-outline' : 'file-search-outline');
  return (
    <View style={[styles.wrap, style]}>
      <View style={[styles.iconWrap, { backgroundColor: error ? 'rgba(255,59,48,0.12)' : palette.tintSoft }]}>
        <MaterialCommunityIcons name={glyph} size={34} color={error ? palette.danger : palette.tint} />
      </View>
      <Text style={[styles.title, { color: palette.label }]}>{title}</Text>
      {hint ? <Text style={[styles.hint, { color: palette.labelSecondary }]}>{hint}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: palette.tint }]}
          onPress={onAction}
          activeOpacity={0.85}
        >
          <Text style={styles.btnText}>{actionLabel || t('重试')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/** 空态快捷封装 */
export function EmptyState(props: Omit<StateViewProps, 'error'>) {
  return <StateView {...props} />;
}

/** 错误态快捷封装（默认带「重试」按钮） */
export function ErrorState(props: Omit<StateViewProps, 'error'>) {
  const { t } = useI18n();
  return <StateView error {...props} actionLabel={props.actionLabel || t('重试')} />;
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: 48,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  hint: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 6 },
  btn: {
    marginTop: 18,
    paddingHorizontal: 26,
    paddingVertical: 9,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
});
