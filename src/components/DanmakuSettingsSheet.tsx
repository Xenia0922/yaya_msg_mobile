import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GlassToggle } from './GlassToggle';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useDanmakuSettings, DanmakuArea } from '../store/danmakuSettings';
import { useI18n } from '../i18n';
import { usePalette, radii, spacing, fontFamily } from '../theme';
import { typography } from '../theme/typography';
import { Button } from './Button';
import { GlassSurface } from '../components/GlassSurface';
import { GlassSegmented } from '../components/GlassSegmented';
import { usePlayerStore } from '../player/store/playerStore';

interface Props {
  visible: boolean;
  onClose: () => void;
  staticFeed?: boolean;
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
  { v: 15, label: '中' },
  { v: 20, label: '大' },
];
const OPACITIES: { v: number; label: string }[] = [
  { v: 0.4, label: '低' },
  { v: 0.7, label: '中' },
  { v: 1, label: '高' },
];

export default function DanmakuSettingsSheet({ visible, onClose, staticFeed = false }: Props) {
  const palette = usePalette();
  const { t } = useI18n();
  const { enabled, area, speed, fontSize, opacity, set, reset } = useDanmakuSettings();

  const chipRow = (
    items: { key?: string; label: string; active: boolean; onPress: () => void }[],
  ) => {
    const activeIdx = Math.max(
      0,
      items.findIndex((i) => i.active),
    );
    return (
      <GlassSegmented
        options={items.map((item, i) => ({ key: String(i), label: item.label }))}
        value={String(activeIdx)}
        onChange={(k: string) => items[Number(k)]?.onPress()}
        height={34}
      />
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.mask} activeOpacity={1} onPress={onClose}>
        <GlassSurface
          radius={22}
          role="card"
          style={[
            styles.sheet,
            {
              backgroundColor: 'transparent',
              borderTopLeftRadius: radii.sheet,
              borderTopRightRadius: radii.sheet,
            },
          ]}
          onStartShouldSetResponder={() => true}
        >
          <View style={[styles.handle, { backgroundColor: palette.fill3 }]} />
          <View style={styles.header}>
            <Text style={[typography.headline, { color: palette.label }]}>{t('弹幕设置')}</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.6}
            >
              <MaterialCommunityIcons name="close" size={20} color={palette.labelSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            <View style={styles.row}>
              <Text style={[typography.subhead, { color: palette.label, fontWeight: '600' }]}>
                {t('显示弹幕')}
              </Text>
              <GlassToggle
                value={enabled}
                onValueChange={(v) => {
                  set({ enabled: v });
                  if (staticFeed && v && !usePlayerStore.getState().danmakuOn)
                    usePlayerStore.getState().toggleDanmaku();
                }}
                accessibilityLabel={t('显示弹幕')}
              />
            </View>

            {!staticFeed && (
              <>
                <Text style={[styles.section, { color: palette.labelTertiary }]}>
                  {t('显示区域')}
                </Text>
                {chipRow(
                  AREAS.map((a) => ({
                    key: a.key,
                    label: t(a.label),
                    active: area === a.key,
                    onPress: () => set({ area: a.key }),
                  })),
                )}

                <Text style={[styles.section, { color: palette.labelTertiary }]}>
                  {t('滚动速度')}
                </Text>
                {chipRow(
                  SPEEDS.map((s) => ({
                    key: s.label,
                    label: t(s.label),
                    active: speed === s.v,
                    onPress: () => set({ speed: s.v }),
                  })),
                )}
              </>
            )}

            <Text style={[styles.section, { color: palette.labelTertiary }]}>{t('字号')}</Text>
            {chipRow(
              SIZES.map((s) => ({
                key: s.label,
                label: t(s.label),
                active: Math.abs(fontSize - s.v) <= 1,
                onPress: () => set({ fontSize: s.v }),
              })),
            )}

            <Text style={[styles.section, { color: palette.labelTertiary }]}>{t('不透明度')}</Text>
            {chipRow(
              OPACITIES.map((o) => ({
                key: o.label,
                label: t(o.label),
                active: opacity === o.v,
                onPress: () => set({ opacity: o.v }),
              })),
            )}

            <View style={styles.resetWrap}>
              <Button
                title={t('恢复默认')}
                onPress={() => {
                  reset();
                  if (staticFeed && !usePlayerStore.getState().danmakuOn)
                    usePlayerStore.getState().toggleDanmaku();
                }}
                variant="plain"
                size="sm"
              />
            </View>
          </ScrollView>
        </GlassSurface>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '82%',
    paddingBottom: 18,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  body: { paddingHorizontal: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  section: {
    fontSize: 12,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 6,
  },
  resetWrap: { marginTop: 18, alignItems: 'center' },
});
