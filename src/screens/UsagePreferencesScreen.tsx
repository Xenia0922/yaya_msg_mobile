/**
 * SettingsScreen · 设置 v2.6 布局重做
 * - 全页 inset 分组：每个 Section 圆角 16 卡片，Section 内行式条目（28 圆角图标底 + 标题 15/600 + 右侧 chevron/状态文字）
 * - 关于区 hero 卡（logo 52 圆角 16 + 名称 + 版本 chip + 红点）
 * - 成员数据统计 2 列卡
 * - 区块直接显示，避免频繁切换时闪烁
 * 业务逻辑 / API / 数据流 / 路由 / i18n 原文一律不动，仅重组布局。
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList, TabParamList } from '../navigation/types';
import { useSettingsStore, useUiStore, useUpdateStore } from '../store';
import { saveSettings } from '../services/settings';
import { setPipEnabled } from '../utils/pip';
import ScreenHeader from '../components/ScreenHeader';
import { ScalePressable } from '../components/Motion';
import RuntimeLogViewer from '../components/RuntimeLogViewer';
import UpdateInstaller from '../components/UpdateInstaller';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { usePalette, getPageBackground } from '../theme';
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
      {/*
        ⚠️【描边修复】不要在这里再传 borderWidth / borderColor。
        GlassSurface 内部已有一层随主题走的描边（MATERIAL.stroke：浅色 rgba(255,255,255,0.66)
        / 深色 rgba(255,255,255,0.10)），且渲染在 children 之前；
        外层再叠一道 palette.hairline 会形成「双层描边」——两条线错位、颜色互搏，
        观感就是用户反馈的「描边没描好」（深浅色主题下都明显）。
        玻璃的唯一出口是 GlassSurface，描边交给它统一出。
 */}
      <GlassSurface radius={22} role="card" style={styles.section}>
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
  // 选项多或标签长（如语言：跟随系统/简体中文/繁體中文/English/日本語/한국어）用可滚动版，
  // 等分版会把文字压到看不清
  const needScroll = options.length > 4 || options.some((o) => o.label.length > 4);
  if (needScroll) {
    return (
      <GlassSegmentedScroll
        options={segs}
        value={idx}
        onChange={(k) => onChange(options[Number(k)].value)}
        height={34}
      />
    );
  }
  return (
    <GlassSegmented
      options={segs}
      value={idx}
      onChange={(k) => onChange(options[Number(k)].value)}
      height={34}
    />
  );
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

  const update = async (key: string, value: any, extra: any = {}) => {
    const patch: Record<string, any> = { [key]: value, ...extra };
    // 失败回滚：setSettings 是局部覆盖，只需恢复本次 patch 涉及的旧值
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

  /** C4：设置页「首页模块」——按当前顺序列出全部模块（含已关闭项，便于排序） */
  const orderedHomeModules = orderHomeModules(settings.home_modules_order);
  const toggleHomeModule = (key: HomeModuleKey, visible: boolean) => {
    const cur = ((settings.home_modules_hidden || []) as string[]).filter((k) => k !== key);
    update('home_modules_hidden', (visible ? cur : [...cur, key]) as any);
  };
  const moveHomeModule = (key: HomeModuleKey, dir: -1 | 1) => {
    // 先写入「当前 resolve 后的完整顺序」，再交换相邻项，避免空数组=默认顺序的语义歧义
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
                      <Switch
                        value={visible}
                        onValueChange={(v) => toggleHomeModule(def.key, !!v)}
                        accessibilityLabel={t(def.titleKey)}
                        trackColor={{ false: palette.fill3, true: palette.tint }}
                        thumbColor="#FFFFFF"
                        ios_backgroundColor={palette.fill3}
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
                <Text style={{ color: palette.tint, fontSize: 12, fontWeight: '600' }}>
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
  sectionTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.3 },
  pageSub: { fontSize: 12, marginTop: 2, marginBottom: 2, paddingHorizontal: 4 },
  // 描边由 GlassSurface 内部统一出（见 Section 注释），此处不再叠 borderWidth/borderColor
  section: { overflow: 'hidden' },
  innerPad: { padding: 16 },
  rowLabel: { fontSize: 13, lineHeight: 19, marginBottom: 6, fontWeight: '600' },
  settingsDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 14 },
  // 关于 hero
  // 成员数据
  inlineNote: { marginTop: 8, fontSize: 11, lineHeight: 16 },
  // 首页模块（C4 优化）：一行 = 名称 + ↑↓ + Switch
  moduleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  moduleName: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '600' },
  moduleCtrl: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
