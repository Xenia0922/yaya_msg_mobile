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
import { useSettingsStore, useUiStore } from '../store';
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

function levelColor(level: LogLevel, isDark: boolean): string {
  switch (level) {
    case 'crash':
      return '#ff3b30';
    case 'error':
      return '#e74c3c';
    case 'warn':
      return '#e6a700';
    default:
      return isDark ? '#9aa0a6' : '#888';
  }
}

function fmtTime(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function RuntimeLogViewer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const isDark = useSettingsStore((s) => s.settings.theme === 'dark');
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
    showToast(`已复制 ${filtered.length} 条日志`);
  };

  const onShare = () => {
    const text = exportLogText(filtered);
    Share.share({ title: '牙牙消息运行日志', message: text }).catch(() => showToast('分享失败'));
  };

  const onCopyEntry = (entry: any) => {
    const lines = [
      `[${fmtTime(entry.t)}] [${entry.level.toUpperCase()}]${entry.ctx ? ` [${entry.ctx}]` : ''}`,
      entry.msg,
      entry.stack ? `\n${entry.stack}` : '',
    ].filter(Boolean);
    Clipboard.setString(lines.join('\n'));
    showToast('已复制该条日志');
  };

  const onClear = () => {
    Alert.alert('清空运行日志', '将删除本地保存的全部运行记录，确认？', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: async () => {
          await clearLog();
          setEntries([]);
          showToast('已清空');
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, isDark && styles.containerDark]}>
        <View style={[styles.header, isDark && styles.headerDark]}>
          <Text style={[styles.title, isDark && styles.textLight]}>运行日志</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={[styles.closeText, isDark && styles.textLight]}>关闭</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.filterRow}>
          {LEVELS.map((lv) => {
            const c = lv.key === 'all' ? entries.length : counts[lv.key as LogLevel];
            const active = filter === lv.key;
            return (
              <TouchableOpacity
                key={lv.key}
                style={[styles.filterChip, isDark && styles.filterChipDark, active && styles.filterChipOn]}
                onPress={() => setFilter(lv.key)}
              >
                <Text style={[styles.filterText, isDark && styles.textSubLight, active && styles.filterTextOn]}>
                  {lv.label} {c}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator>
          {filtered.length === 0 ? (
            <Text style={[styles.empty, isDark && styles.textSubLight]}>暂无记录</Text>
          ) : (
            filtered.map((e) => (
              <TouchableOpacity
                key={e.id}
                style={[styles.row, isDark && styles.rowDark]}
                onLongPress={() => onCopyEntry(e)}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              >
                <View style={styles.rowTop}>
                  <Text style={[styles.time, isDark && styles.textSubLight]}>{fmtTime(e.t)}</Text>
                  <View style={[styles.badge, { backgroundColor: levelColor(e.level, isDark) }]}>
                    <Text style={styles.badgeText}>{e.level.toUpperCase()}</Text>
                  </View>
                  {e.ctx ? <Text style={[styles.ctx, isDark && styles.textSubLight]}>{e.ctx}</Text> : null}
                </View>
                <Text style={[styles.msg, isDark && styles.textLight]}>{e.msg}</Text>
                {e.stack ? (
                  <Text style={[styles.stack, isDark && styles.textSubLight]} numberOfLines={6}>
                    {e.stack}
                  </Text>
                ) : null}
              </TouchableOpacity>
            ))
          )}
        </ScrollView>

        <View style={[styles.toolbar, isDark && styles.toolbarDark]}>
          <TouchableOpacity style={[styles.toolBtn, isDark && styles.toolBtnDark]} onPress={refresh}>
            <Text style={[styles.toolText, isDark && styles.textLight]}>刷新</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.toolBtn, isDark && styles.toolBtnDark]} onPress={onCopy}>
            <Text style={[styles.toolText, isDark && styles.textLight]}>复制</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.toolBtn, isDark && styles.toolBtnDark]} onPress={onShare}>
            <Text style={[styles.toolText, isDark && styles.textLight]}>分享</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolBtnDanger} onPress={onClear}>
            <Text style={styles.toolTextDanger}>清空</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  containerDark: { backgroundColor: '#111' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 48, paddingBottom: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)' },
  headerDark: { backgroundColor: '#1a1a1a', borderBottomColor: 'rgba(255,255,255,0.08)' },
  title: { fontSize: 18, fontWeight: '800', color: '#222' },
  textLight: { color: '#fff' },
  textSubLight: { color: '#bbb' },
  closeBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  closeText: { fontSize: 14, color: '#ff6f91', fontWeight: '700' },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)' },
  filterChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.05)' },
  filterChipDark: { backgroundColor: 'rgba(255,255,255,0.08)' },
  filterChipOn: { backgroundColor: '#ff6f91' },
  filterText: { fontSize: 12, color: '#555', fontWeight: '700' },
  filterTextOn: { color: '#fff' },
  list: { flex: 1 },
  listContent: { padding: 12, paddingBottom: 24 },
  empty: { textAlign: 'center', color: '#999', marginTop: 60, fontSize: 13 },
  row: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: 'rgba(0,0,0,0.1)' },
  rowDark: { backgroundColor: '#1e1e1e', borderLeftColor: 'rgba(255,255,255,0.15)' },
  rowTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 8 },
  time: { fontSize: 11, color: '#999' },
  badge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  badgeText: { fontSize: 9, color: '#fff', fontWeight: '800' },
  ctx: { fontSize: 11, color: '#999', fontStyle: 'italic' },
  msg: { fontSize: 13, color: '#222', lineHeight: 18 },
  stack: { fontSize: 10, color: '#999', marginTop: 4, lineHeight: 14 },
  toolbar: { flexDirection: 'row', padding: 10, gap: 8, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)' },
  toolbarDark: { backgroundColor: '#1a1a1a', borderTopColor: 'rgba(255,255,255,0.08)' },
  toolBtn: { flex: 1, minHeight: 42, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.05)', alignItems: 'center', justifyContent: 'center' },
  toolBtnDark: { backgroundColor: 'rgba(255,255,255,0.08)' },
  toolBtnDanger: { flex: 1, minHeight: 42, borderRadius: 18, backgroundColor: 'rgba(255,0,0,0.1)', alignItems: 'center', justifyContent: 'center' },
  toolText: { color: '#333', fontWeight: '800', fontSize: 13 },
  toolTextDanger: { color: '#e74c3c', fontWeight: '800', fontSize: 13 },
});
