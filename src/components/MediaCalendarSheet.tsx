import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useI18n } from '../i18n';
import { usePalette, radiiAlias, fontFamily } from '../theme';

export function MediaCalendarSheet({
  visible,
  initial,
  onSelect,
  onClose,
}: {
  visible: boolean;
  initial: Date | null;
  onSelect: (_date: Date) => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  const { t } = useI18n();
  const base = initial || new Date();
  const [view, setView] = useState(() => new Date(base.getFullYear(), base.getMonth(), 1));
  const year = view.getFullYear();
  const month = view.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'].map((w) => t(w));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity
        style={styles.mask}
        activeOpacity={1}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('关闭')}
      >
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: palette.surfaceElevated,
              borderColor: palette.hairline,
              borderWidth: StyleSheet.hairlineWidth,
            },
          ]}
          onStartShouldSetResponder={() => true}
        >
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => setView(new Date(year, month - 1, 1))}
              hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('上个月')}
            >
              <MaterialCommunityIcons name="chevron-left" size={24} color={palette.label} />
            </TouchableOpacity>
            <Text style={[styles.title, { color: palette.label }]}>
              {t('{year} 年 {month} 月', { year, month: month + 1 })}
            </Text>
            <TouchableOpacity
              onPress={() => setView(new Date(year, month + 1, 1))}
              hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('下个月')}
            >
              <MaterialCommunityIcons name="chevron-right" size={24} color={palette.label} />
            </TouchableOpacity>
          </View>
          <View style={styles.weekRow}>
            {weekdays.map((w) => (
              <Text key={w} style={[styles.week, { color: palette.labelTertiary }]}>
                {w}
              </Text>
            ))}
          </View>
          <View style={styles.grid}>
            {cells.map((d, i) =>
              d ? (
                <TouchableOpacity
                  key={i}
                  style={styles.day}
                  onPress={() => onSelect(new Date(year, month, d))}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`${year}-${month + 1}-${d}`}
                >
                  <Text style={[styles.dayText, { color: palette.label }]}>{d}</Text>
                </TouchableOpacity>
              ) : (
                <View key={i} style={styles.day} />
              ),
            )}
          </View>
          <View style={[styles.footer, { borderTopColor: palette.hairline }]}>
            <TouchableOpacity
              onPress={onClose}
              style={styles.cancel}
              accessibilityRole="button"
              accessibilityLabel={t('取消')}
            >
              <Text style={[styles.cancelText, { color: palette.tint }]}>{t('取消')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                onSelect(new Date());
                onClose();
              }}
              style={[styles.today, { backgroundColor: palette.tint }]}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('今天')}
            >
              <Text style={[styles.todayText, { color: palette.onTint }]}>{t('今天')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheet: {
    width: '88%',
    maxWidth: 360,
    borderRadius: radiiAlias.input,
    padding: 16,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: { fontSize: 17, fontFamily: fontFamily.system, fontWeight: '800' },
  weekRow: { flexDirection: 'row', marginBottom: 6 },
  week: { flex: 1, textAlign: 'center', fontSize: 12, color: '#999', fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  day: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 15, fontFamily: fontFamily.system },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancel: { paddingHorizontal: 14, paddingVertical: 6 },
  cancelText: { fontSize: 14, fontFamily: fontFamily.system },
  today: { borderRadius: radiiAlias.button, paddingHorizontal: 18, paddingVertical: 6 },
  todayText: { fontSize: 14, fontWeight: '800' },
});
