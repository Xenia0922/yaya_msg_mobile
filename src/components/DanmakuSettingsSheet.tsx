/**
 * 弹幕设置面板（哔哩哔哩风格）：总开关、显示区域、速度、字号、不透明度、重置。
 * 设置来自 useDanmakuSettings，记忆持久化。
 */
import React from 'react';
import { Modal, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSettingsStore } from '../store';
import { useDanmakuSettings, DanmakuArea } from '../store/danmakuSettings';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const AREAS: { key: DanmakuArea; label: string }[] = [
  { key: 'top', label: '顶部' },
  { key: 'half', label: '半屏' },
  { key: 'full', label: '全屏' },
];
const SPEEDS: { v: number; label: string }[] = [
  { v: 0.5, label: '0.5x' },
  { v: 1, label: '1x' },
  { v: 1.5, label: '1.5x' },
  { v: 2, label: '2x' },
];
const SIZES: { v: number; label: string }[] = [
  { v: 13, label: '小' },
  { v: 16, label: '中' },
  { v: 20, label: '大' },
];
const OPACITIES: { v: number; label: string }[] = [
  { v: 0.4, label: '低' },
  { v: 0.7, label: '中' },
  { v: 1, label: '高' },
];

function Chip({
  active,
  label,
  onPress,
  isDark,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  isDark: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, isDark && styles.chipD, active && styles.chipOn]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, isDark && styles.chipTextD, active && styles.chipTextOn]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export default function DanmakuSettingsSheet({ visible, onClose }: Props) {
  const isDark = useSettingsStore((s) => s.settings.theme === 'dark');
  const { enabled, area, speed, fontSize, opacity, set, reset } = useDanmakuSettings();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.mask} activeOpacity={1} onPress={onClose}>
        <View style={[styles.sheet, isDark && styles.sheetD]} onStartShouldSetResponder={() => true}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={[styles.title, isDark && styles.textLight]}>弹幕设置</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialCommunityIcons name="close" size={20} color={isDark ? '#ccc' : '#666'} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* 总开关 */}
            <View style={styles.row}>
              <Text style={[styles.rowLabel, isDark && styles.textLight]}>显示弹幕</Text>
              <Switch
                value={enabled}
                onValueChange={(v) => set({ enabled: v })}
                thumbColor={enabled ? '#ff6f91' : '#fff'}
                trackColor={{ false: isDark ? '#444' : '#ccc', true: '#ff6f91' }}
              />
            </View>

            {/* 显示区域 */}
            <Text style={[styles.section, isDark && styles.sectionD]}>显示区域</Text>
            <View style={styles.chipRow}>
              {AREAS.map((a) => (
                <Chip
                  key={a.key}
                  active={area === a.key}
                  label={a.label}
                  onPress={() => set({ area: a.key })}
                  isDark={isDark}
                />
              ))}
            </View>

            {/* 速度 */}
            <Text style={[styles.section, isDark && styles.sectionD]}>滚动速度</Text>
            <View style={styles.chipRow}>
              {SPEEDS.map((s) => (
                <Chip
                  key={s.label}
                  active={speed === s.v}
                  label={s.label}
                  onPress={() => set({ speed: s.v })}
                  isDark={isDark}
                />
              ))}
            </View>

            {/* 字号 */}
            <Text style={[styles.section, isDark && styles.sectionD]}>字号</Text>
            <View style={styles.chipRow}>
              {SIZES.map((s) => (
                <Chip
                  key={s.label}
                  active={fontSize === s.v}
                  label={s.label}
                  onPress={() => set({ fontSize: s.v })}
                  isDark={isDark}
                />
              ))}
            </View>

            {/* 不透明度 */}
            <Text style={[styles.section, isDark && styles.sectionD]}>不透明度</Text>
            <View style={styles.chipRow}>
              {OPACITIES.map((o) => (
                <Chip
                  key={o.label}
                  active={opacity === o.v}
                  label={o.label}
                  onPress={() => set({ opacity: o.v })}
                  isDark={isDark}
                />
              ))}
            </View>

            <TouchableOpacity style={styles.reset} onPress={() => reset()}>
              <Text style={styles.resetText}>恢复默认</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '82%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 18,
  },
  sheetD: { backgroundColor: '#1b1b1b' },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: '#ddd', alignSelf: 'center', marginTop: 8, marginBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  title: { fontSize: 16, fontWeight: '800', color: '#222' },
  body: { paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  rowLabel: { fontSize: 14, fontWeight: '700', color: '#333' },
  section: { fontSize: 12, color: '#999', fontWeight: '700', marginTop: 12, marginBottom: 6 },
  sectionD: { color: '#aaa' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.05)', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  chipD: { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.14)' },
  chipOn: { backgroundColor: '#ff6f91', borderColor: '#ff6f91' },
  chipText: { fontSize: 13, color: '#555', fontWeight: '700' },
  chipTextD: { color: '#ccc' },
  chipTextOn: { color: '#fff' },
  reset: { marginTop: 18, alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 9, borderRadius: 16, borderWidth: 1, borderColor: '#ff6f91' },
  resetText: { color: '#ff6f91', fontSize: 13, fontWeight: '800' },
  textLight: { color: '#eee' },
});
