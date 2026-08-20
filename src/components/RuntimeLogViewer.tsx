import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useUiStore } from '../store';
import { useI18n } from '../i18n';
import { usePalette, radii, spacing } from '../theme';
import { typography } from '../theme/typography';
import { Pill } from './Pill';
import { CenterSpinner } from './Loaders';
import {
  clearLog,
  exportLogText,
  getLogCounts,
  getLogEntries,
  LogLevel,
} from '../utils/runtimeLog';

type FilterKey = 'all' | LogLevel;

const LEVELS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'info', label: '信息' },
  { key: 'warn', label: '警告' },
  { key: 'error', label: '错误' },
  { key: 'crash', label: '崩溃' },
];

function levelColor(level: LogLevel): string {
  switch (level) {
    case 'crash':
      return '#ff3b30';
    case 'error':
      return '#e74c3c';
    case 'warn':
      return '#e6a700';
    default:
      return '#888';
  }
}

function fmtTime(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function RuntimeLogViewer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const palette = usePalette();
  const { t } = useI18n();
  const showToast = useUiStore((s) => s.showToast);
  const [entries, setEntries] = useState(getLogEntries());
  const [filter, setFilter] = useState<FilterKey>('all');

  useEffect(() => {
    if (visible) {
      setEntries(getLogEntries());
      setFilter('all');
    }
  }, [visible]);

  const counts = useMemo(() => getLogCounts(), [entries]);

  const filtered = useMemo(() => {
    if (filter === 'all') return entries;
    return entries.filter((e) => e.level === filter);
  }, [entries, filter]);

  const refresh = () => setEntries(getLogEntries());

  const onCopy = () => {
    const text = exportLogText(filtered);
    Clipboard.setString(text);
    showToast(t('已复制 {count} 条日志', { count: filtered.length }));
  };

  const onShare = () => {
    const text = exportLogText(filtered);
    Share.share({ title: t('牙牙消息运行日志'), message: text }).catch(() => showToast(t('分享失败')));
  };

  const onCopyEntry = (entry: any) => {
    const lines = [
      `[${fmtTime(entry.t)}] [${entry.level.toUpperCase()}]${entry.ctx ? ` [${entry.ctx}]` : ''}`,
      entry.msg,
      entry.stack ? `\n${entry.stack}` : '',
    ].filter(Boolean);
    Clipboard.setString(lines.join('\n'));
    showToast(t('已复制该条日志'));
  };

  const onClear = () => {
    Alert.alert(t('清空运行日志'), t('将删除本地保存的全部运行记录，确认？'), [
      { text: t('取消'), style: 'cancel' },
      {
        text: t('清空'),
        style: 'destructive',
        onPress: async () => {
          await clearLog();
          setEntries([]);
          showToast(t('已清空'));
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: palette.background }]}>
        <View style={[styles.header, { backgroundColor: palette.surface, borderBottomColor: palette.hairline }]}>
          <Text style={[typography.title3, { color: palette.label }]}>{t('运行日志')}</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.6} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={[typography.subhead, { color: palette.tint, fontWeight: '700' }]}>{t('关闭')}</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.filterRow, { backgroundColor: palette.surface, borderBottomColor: palette.hairline }]}>
          {LEVELS.map((lv) => {
            const c = lv.key === 'all' ? entries.length : counts[lv.key as LogLevel];
            const active = filter === lv.key;
            return (
              <Pill
                key={lv.key}
                label={`${t(lv.label)} ${c}`}
                selected={active}
                onPress={() => setFilter(lv.key)}
              />
            );
          })}
        </View>

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator>
          {filtered.length === 0 ? (
            <CenterSpinner text={t('暂无记录')} style={{ marginTop: 60 }} />
          ) : (
            filtered.map((e) => (
              <TouchableOpacity
                key={e.id}
                style={[
                  styles.row,
                  {
                    backgroundColor: palette.surface,
                    borderLeftColor: levelColor(e.level),
                  },
                ]}
                onLongPress={() => onCopyEntry(e)}
                activeOpacity={0.8}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              >
                <View style={styles.rowTop}>
                  <Text style={[styles.time, { color: palette.labelTertiary }]}>{fmtTime(e.t)}</Text>
                  <View style={[styles.badge, { backgroundColor: levelColor(e.level) }]}>
                    <Text style={styles.badgeText}>{e.level.toUpperCase()}</Text>
                  </View>
                  {e.ctx ? <Text style={[styles.ctx, { color: palette.labelTertiary }]} numberOfLines={1}>{e.ctx}</Text> : null}
                </View>
                <Text style={[typography.subhead, styles.msg, { color: palette.label }]}>{e.msg}</Text>
                {e.stack ? (
                  <Text style={[styles.stack, { color: palette.labelTertiary }]} numberOfLines={6}>
                    {e.stack}
                  </Text>
                ) : null}
              </TouchableOpacity>
            ))
          )}
        </ScrollView>

        <View style={[styles.toolbar, { backgroundColor: palette.surface, borderTopColor: palette.hairline }]}>
          <TouchableOpacity style={[styles.toolBtn, { backgroundColor: palette.fill2 }]} onPress={refresh} activeOpacity={0.7}>
            <Text style={[styles.toolText, { color: palette.label }]}>{t('刷新')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.toolBtn, { backgroundColor: palette.fill2 }]} onPress={onCopy} activeOpacity={0.7}>
            <Text style={[styles.toolText, { color: palette.label }]}>{t('复制')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.toolBtn, { backgroundColor: palette.fill2 }]} onPress={onShare} activeOpacity={0.7}>
            <Text style={[styles.toolText, { color: palette.label }]}>{t('分享')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.toolBtn, { backgroundColor: palette.tintSoft }]} onPress={onClear} activeOpacity={0.7}>
            <Text style={[styles.toolText, { color: palette.danger }]}>{t('清空')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: 48,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  list: { flex: 1 },
  listContent: { padding: spacing.sm, paddingBottom: 24 },
  row: {
    borderRadius: radii.sm,
    padding: spacing.sm,
    marginBottom: spacing.xs,
    borderLeftWidth: 3,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 8 },
  time: { fontSize: 11 },
  badge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  badgeText: { fontSize: 9, color: '#fff', fontWeight: '800' },
  ctx: { fontSize: 11, fontStyle: 'italic', flexShrink: 1 },
  msg: { lineHeight: 18 },
  stack: { fontSize: 10, marginTop: 4, lineHeight: 14 },
  toolbar: {
    flexDirection: 'row',
    padding: 10,
    gap: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toolBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolText: { fontWeight: '800', fontSize: 13 },
});
