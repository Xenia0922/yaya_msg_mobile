import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GlassToggle } from '../components/GlassToggle';
import { CompositeNavigationProp, useFocusEffect, useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList, TabParamList } from '../navigation/types';
import { useSettingsStore, useUiStore, useUpdateStore } from '../store';
import { useMusicPlayerStore } from '../store/musicPlayerStore';
import { saveSettings } from '../services/settings';
import { setPipEnabled } from '../utils/pip';
import { exoClearCache, exoGetCacheStats, exoSetCacheLimitMb } from '../native/RadioExo';
import ScreenHeader from '../components/ScreenHeader';
import { ScalePressable } from '../components/Motion';
import RuntimeLogViewer from '../components/RuntimeLogViewer';
import UpdateInstaller from '../components/UpdateInstaller';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { fontFamily, usePalette, getPageBackground } from '../theme';
import { useI18n } from '../i18n';
import { GlassSurface } from '../components/GlassSurface';
import { GlassSegmented, GlassSegmentedScroll } from '../components/GlassSegmented';
import { orderHomeModules, type HomeModuleKey } from './home/modules';

type SettingsNavProp = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'Settings'>,
  StackNavigationProp<RootStackParamList>
>;

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: string;
  children: React.ReactNode;
}) {
  const palette = usePalette();
  return (
    <View>
      {title ? (
        <View style={styles.sectionTitleRow}>
          {icon ? (
            <View style={[styles.sectionIcon, { backgroundColor: palette.tintSoft }]}>
              <MaterialCommunityIcons name={icon} size={11} color={palette.tint} />
            </View>
          ) : null}
          <Text style={[styles.sectionTitle, { color: palette.label }]}>{title}</Text>
        </View>
      ) : null}

      <GlassSurface radius={22} role="card" frostedOnly style={styles.section}>
        {children}
      </GlassSurface>
    </View>
  );
}

function ChipRow<T>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (_value: T) => void;
}) {
  const segs = options.map((o, i) => ({ key: String(i), label: o.label }));
  const idx = String(options.findIndex((o) => o.value === value));

  const needScroll = options.length > 4 || options.some((o) => o.label.length > 4);
  if (needScroll) {
    return (
      <GlassSegmentedScroll
        options={segs}
        value={idx}
        onChange={(k) => onChange(options[Number(k)].value)}
        height={34}
        frostedOnly
      />
    );
  }
  return (
    <GlassSegmented
      options={segs}
      value={idx}
      onChange={(k) => onChange(options[Number(k)].value)}
      height={34}
      frostedOnly
    />
  );
}

function formatCacheBytes(bytes: number): string {
  const b = Math.max(0, Number(bytes) || 0);
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function UsagePreferencesScreen() {
  const navigation = useNavigation<SettingsNavProp>();
  const palette = usePalette();
  const settings = useSettingsStore((state) => state.settings);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const showToast = useUiStore((state) => state.showToast);
  const { t } = useI18n();
  const [logVisible, setLogVisible] = useState(false);
  const [updateVisible, setUpdateVisible] = useState(false);
  const latestVersion = useUpdateStore((s) => s.latestVersion);
  const [cacheUsedBytes, setCacheUsedBytes] = useState(0);
  const [clearingCache, setClearingCache] = useState(false);

  const refreshCacheStats = useCallback(async () => {
    const stats = await exoGetCacheStats();
    setCacheUsedBytes(stats.usedBytes);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshCacheStats();
    }, [refreshCacheStats]),
  );

  const cacheLimitMb = settings.yaya_music_cache_limit_mb || 300;
  const normalizedCap =
    [100, 300, 500, 1024].reduce((best, cand) =>
      Math.abs(cand - cacheLimitMb) < Math.abs(best - cacheLimitMb) ? cand : best,
    ) || 300;

  const update = async (key: string, value: any, extra: any = {}) => {
    const patch: Record<string, any> = { [key]: value, ...extra };

    const previous: Record<string, any> = {};
    for (const k of Object.keys(patch)) previous[k] = (settings as any)[k];
    setSettings(patch);
    try {
      await saveSettings(patch);
      showToast(t('设置已保存'));
    } catch (error: any) {
      setSettings(previous as any);
      showToast(t('保存失败：{msg}', { msg: error?.message || String(error) }));
    }
  };

  const orderedHomeModules = orderHomeModules(settings.home_modules_order);
  const toggleHomeModule = (key: HomeModuleKey, visible: boolean) => {
    const cur = ((settings.home_modules_hidden || []) as string[]).filter((k) => k !== key);
    update('home_modules_hidden', (visible ? cur : [...cur, key]) as any);
  };
  const moveHomeModule = (key: HomeModuleKey, dir: -1 | 1) => {
    const keys = orderHomeModules(settings.home_modules_order).map((m) => m.key);
    const i = keys.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    update('home_modules_order', keys as any);
  };

  return (
    <>
      <View style={[styles.container, { backgroundColor: getPageBackground() }]}>
        <ScreenHeader title={t('使用偏好')} onBack={() => navigation.goBack()} />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.pageSub, { color: palette.labelSecondary }]}>
            {t('小窗、通知与首页模块')}
          </Text>
          <Section title={t('个性化设置')} icon="tune-variant">
            <View style={styles.innerPad}>
              <Text style={[styles.rowLabel, { color: palette.labelSecondary }]}>
                {t('切到后台自动弹出系统小窗')}
              </Text>
              <ChipRow
                options={[
                  { label: t('关'), value: false as any },
                  { label: t('开'), value: true as any },
                ]}
                value={settings.pip_auto}
                onChange={(v) => {
                  setPipEnabled(!!v);
                  update('pip_auto', v);
                }}
              />
              <Text style={[styles.inlineNote, { color: palette.labelTertiary }]}>
                {t('开启后，视频切到后台时自动进入系统小窗')}
              </Text>
            </View>
            <View style={[styles.settingsDivider, { backgroundColor: palette.innerStroke }]} />
            <View style={styles.innerPad}>
              <Text style={[styles.rowLabel, { color: palette.labelSecondary }]}>
                {t('首页「私信」入口显示未读红点')}
              </Text>
              <ChipRow
                options={[
                  { label: t('关'), value: false as any },
                  { label: t('开'), value: true as any },
                ]}
                value={settings.yaya_pm_unread_badge}
                onChange={(v) => update('yaya_pm_unread_badge', v)}
              />
              <Text style={[styles.inlineNote, { color: palette.labelTertiary }]}>
                {t('关闭后首页不再拉取私信未读数，也不显示红点角标')}
              </Text>
            </View>
            <View style={[styles.settingsDivider, { backgroundColor: palette.innerStroke }]} />
            <View style={styles.innerPad}>
              <Text style={[styles.rowLabel, { color: palette.labelSecondary }]}>
                {t('房间列表显示消息时间')}
              </Text>
              <ChipRow
                options={[
                  { label: t('关'), value: false as any },
                  { label: t('开'), value: true as any },
                ]}
                value={settings.yaya_room_list_time !== false}
                onChange={(v) => update('yaya_room_list_time', v)}
              />
              <Text style={[styles.inlineNote, { color: palette.labelTertiary }]}>
                {t('开启后在房间列表行尾展示大、小房间最新一条消息时间')}
              </Text>
            </View>
            <View style={[styles.settingsDivider, { backgroundColor: palette.innerStroke }]} />
            <View style={styles.innerPad}>
              <Text style={[styles.rowLabel, { color: palette.labelSecondary }]}>
                {t('首页模块')}
              </Text>
              <Text
                style={[
                  styles.inlineNote,
                  { color: palette.labelTertiary, marginTop: 0, marginBottom: 2 },
                ]}
              >
                {t('开关控制显示；↑↓ 调整顺序（立即生效）')}
              </Text>
              {orderedHomeModules.map((def, idx) => {
                const visible = !((settings.home_modules_hidden || []) as string[]).includes(
                  def.key,
                );
                return (
                  <View
                    key={def.key}
                    style={[
                      styles.moduleRow,
                      idx > 0
                        ? {
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: palette.innerStroke,
                          }
                        : null,
                    ]}
                  >
                    <Text style={[styles.moduleName, { color: palette.label }]} numberOfLines={1}>
                      {t(def.titleKey)}
                    </Text>
                    <View style={styles.moduleCtrl}>
                      <ScalePressable
                        onPress={() => moveHomeModule(def.key, -1)}
                        pressedScale={0.9}
                        disabled={idx === 0}
                        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                        accessibilityRole="button"
                        accessibilityLabel={`${t('上移')} ${t(def.titleKey)}`}
                        accessibilityState={{ disabled: idx === 0 }}
                        style={{ opacity: idx === 0 ? 0.25 : 1, padding: 4 }}
                      >
                        <MaterialCommunityIcons
                          name="chevron-up"
                          size={20}
                          color={palette.labelSecondary}
                        />
                      </ScalePressable>
                      <ScalePressable
                        onPress={() => moveHomeModule(def.key, 1)}
                        pressedScale={0.9}
                        disabled={idx === orderedHomeModules.length - 1}
                        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                        accessibilityRole="button"
                        accessibilityLabel={`${t('下移')} ${t(def.titleKey)}`}
                        accessibilityState={{ disabled: idx === orderedHomeModules.length - 1 }}
                        style={{
                          opacity: idx === orderedHomeModules.length - 1 ? 0.25 : 1,
                          padding: 4,
                        }}
                      >
                        <MaterialCommunityIcons
                          name="chevron-down"
                          size={20}
                          color={palette.labelSecondary}
                        />
                      </ScalePressable>
                      <GlassToggle
                        value={visible}
                        onValueChange={(v) => toggleHomeModule(def.key, !!v)}
                        accessibilityLabel={t(def.titleKey)}
                      />
                    </View>
                  </View>
                );
              })}
              <TouchableOpacity
                onPress={() => update('home_modules_order', [] as any)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('恢复默认顺序')}
                style={{ marginTop: 10, alignSelf: 'flex-start', paddingVertical: 4 }}
              >
                <Text
                  style={{
                    color: palette.tint,
                    fontSize: 12,
                    fontFamily: fontFamily.system,
                    fontWeight: '600',
                  }}
                >
                  {t('恢复默认顺序')}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.settingsDivider, { backgroundColor: palette.innerStroke }]} />
            <View style={styles.innerPad}>
              <Text style={[styles.rowLabel, { color: palette.labelSecondary }]}>
                {t('自动签到')}
              </Text>
              <ChipRow
                options={[
                  { label: t('关'), value: false as any },
                  { label: t('开'), value: true as any },
                ]}
                value={settings.yaya_auto_checkin_enabled}
                onChange={(v) => update('yaya_auto_checkin_enabled', v)}
              />
              {settings.yaya_auto_checkin_enabled ? (
                <Text style={[styles.rowLabel, { color: palette.labelSecondary, marginTop: 10 }]}>
                  {t('上次签到：{date}', {
                    date: settings.yaya_auto_checkin_last_date || t('尚未执行'),
                  })}
                </Text>
              ) : null}
            </View>
          </Section>

          <Section title={t('音乐')} icon="music-note-outline">
            <View style={styles.innerPad}>
              <Text style={[styles.rowLabel, { color: palette.labelSecondary }]}>
                {t('底部迷你播放栏')}
              </Text>
              <ChipRow
                options={[
                  { label: t('关'), value: false as any },
                  { label: t('开'), value: true as any },
                ]}
                value={settings.yaya_music_minibar_enabled !== false}
                onChange={(v) => {
                  if (v) useMusicPlayerStore.getState().restoreMiniBar();
                  void update('yaya_music_minibar_enabled', v);
                }}
              />
              <Text style={[styles.inlineNote, { color: palette.labelTertiary }]}>
                {t(
                  '开启后在非首页页面底部显示悬浮播放条；关闭后可从首页「最近播放」或通知栏控制播放',
                )}
              </Text>
            </View>
            <View style={[styles.settingsDivider, { backgroundColor: palette.innerStroke }]} />
            <View style={styles.innerPad}>
              <View style={styles.cacheHeaderRow}>
                <Text style={[styles.rowLabel, { color: palette.labelSecondary, marginBottom: 0 }]}>
                  {t('自动缓存上限')}
                </Text>
                <Text style={[styles.cacheUsageText, { color: palette.tint }]}>
                  {t('已用 {used}', { used: formatCacheBytes(cacheUsedBytes) })}
                </Text>
              </View>
              <View style={{ marginTop: 8 }}>
                <ChipRow
                  options={[
                    { label: '100 MB', value: 100 },
                    { label: '300 MB', value: 300 },
                    { label: '500 MB', value: 500 },
                    { label: '1 GB', value: 1024 },
                  ]}
                  value={normalizedCap}
                  onChange={(v) => {
                    exoSetCacheLimitMb(v);
                    void update('yaya_music_cache_limit_mb', v);
                    setTimeout(() => {
                      void refreshCacheStats();
                    }, 450);
                  }}
                />
              </View>
              <Text style={[styles.inlineNote, { color: palette.labelTertiary }]}>
                {t('听歌时自动边播边缓存，超出上限后自动清理最早缓存')}
              </Text>
              <View style={styles.cacheActionRow}>
                <ScalePressable
                  onPress={async () => {
                    if (clearingCache) return;
                    setClearingCache(true);
                    try {
                      const stats = await exoClearCache();
                      setCacheUsedBytes(stats.usedBytes);
                      showToast(t('已清理音乐缓存'));
                    } finally {
                      setClearingCache(false);
                    }
                  }}
                  disabled={clearingCache}
                  pressedScale={0.96}
                  style={[
                    styles.clearCacheBtn,
                    { backgroundColor: palette.fill2, opacity: clearingCache ? 0.6 : 1 },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="trash-can-outline"
                    size={15}
                    color={palette.label}
                  />
                  <Text style={[styles.clearCacheText, { color: palette.label }]}>
                    {clearingCache ? t('清理中…') : t('清理音乐缓存')}
                  </Text>
                </ScalePressable>
              </View>
            </View>
          </Section>
        </ScrollView>
      </View>
      <RuntimeLogViewer visible={logVisible} onClose={() => setLogVisible(false)} />
      <UpdateInstaller
        visible={updateVisible}
        version={latestVersion}
        onClose={() => setUpdateVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 112, paddingHorizontal: 16, paddingTop: 0 },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 20,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionIcon: {
    width: 20,
    height: 20,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: fontFamily.system,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  pageSub: {
    fontSize: 12,
    fontFamily: fontFamily.system,
    marginTop: 2,
    marginBottom: 2,
    paddingHorizontal: 4,
  },

  section: { overflow: 'hidden' },
  innerPad: { padding: 16 },
  rowLabel: {
    fontSize: 13,
    fontFamily: fontFamily.system,
    lineHeight: 19,
    marginBottom: 6,
    fontWeight: '600',
  },
  settingsDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 14 },

  inlineNote: { marginTop: 8, fontSize: 11, fontFamily: fontFamily.system, lineHeight: 16 },

  moduleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  moduleName: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontFamily: fontFamily.system,
    fontWeight: '600',
  },
  moduleCtrl: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cacheHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cacheUsageText: {
    fontSize: 12,
    fontFamily: fontFamily.system,
    fontWeight: '700',
  },
  cacheActionRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  clearCacheBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderCurve: 'continuous',
  },
  clearCacheText: {
    fontSize: 13,
    fontFamily: fontFamily.system,
    fontWeight: '600',
  },
});
