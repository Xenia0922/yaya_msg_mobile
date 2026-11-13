/**
 * SettingsScreen · 设置 v2.6 布局重做
 * - 全页 inset 分组：每个 Section 圆角 16 卡片，Section 内行式条目（28 圆角图标底 + 标题 15/600 + 右侧 chevron/状态文字）
 * - 关于区 hero 卡（logo 52 圆角 16 + 名称 + 版本 chip + 红点）
 * - 成员数据统计 2 列卡
 * - 区块直接显示，避免频繁切换时闪烁
 * 业务逻辑 / API / 数据流 / 路由 / i18n 原文一律不动，仅重组布局。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { showDialog } from '../components/AppDialog';
import { toMs } from '../utils/format';
import {Linking, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View} from 'react-native';
import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { StackNavigationProp } from '@react-navigation/stack';
import {Image} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { RootStackParamList, TabParamList } from '../navigation/types';
import { useSettingsStore, useUiStore, useMemberStore, useUpdateStore } from '../store';
import { saveSettings } from '../services/settings';
import { setPipEnabled } from '../utils/pip';
import ScreenHeader from '../components/ScreenHeader';
import { Button } from '../components/Button';
import { ScalePressable } from '../components/Motion';
import RuntimeLogViewer from '../components/RuntimeLogViewer';
import UpdateInstaller from '../components/UpdateInstaller';
import { isApkUpdaterAvailable } from '../native/ApkUpdater';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { APP_VERSION } from '../constants';
import { IS_PLUS_BUILD } from '../constants/channel';
import { getMemberDataMeta, MemberDataMeta, updateMemberData } from '../services/memberData';
import { usePalette, radii, radiiAlias, usePageBackground } from '../theme';
import { typography } from '../theme/typography';
import { useI18n, LANGUAGE_OPTIONS } from '../i18n';
import { GlassSurface } from '../components/GlassSurface';
import { GlassSegmented, GlassSegmentedScroll } from '../components/GlassSegmented';
import { sniffImageBase64Mime } from '../utils/dataUri';
import { ListBottomSpacer } from '../components/ListBottomSpacer';
import { orderHomeModules, type HomeModuleKey } from './home/modules';

type SettingsNavProp = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'Settings'>,
  StackNavigationProp<RootStackParamList>
>;

function Section({ title, icon, children }: { title: string; icon?: string; children: React.ReactNode }) {
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

/** Section 内行式条目：28 圆角图标底 + 标题 15/600 + 右侧 chevron/状态文字 */
function Row({
  icon,
  title,
  value,
  onPress,
  danger,
  withChevron = true,
  wrapValue = false,
}: {
  icon: string;
  title: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  withChevron?: boolean;
  /** value 完整显示（允许换行）——仓库地址等长文本用，默认仍单行截断 */
  wrapValue?: boolean;
}) {
  const palette = usePalette();
  return (
    <ScalePressable
      style={styles.row}
      onPress={onPress}
      pressedScale={0.98}
      activeOpacity={0.9}
      disabled={!onPress}
    >
      <View style={[styles.rowIcon, { backgroundColor: danger ? 'rgba(255,59,48,0.12)' : palette.tintSoft }]}>
        <MaterialCommunityIcons name={icon} color={danger ? palette.danger : palette.tint} size={16} />
      </View>
      <Text style={[styles.rowTitle, { color: danger ? palette.danger : palette.label }]} numberOfLines={1}>{title}</Text>
      {value ? (
        wrapValue ? (
          <Text style={[styles.rowValue, styles.rowValueWrap, { color: palette.labelTertiary }]}>{value}</Text>
        ) : (
          <Text style={[styles.rowValue, { color: palette.labelTertiary }]} numberOfLines={1}>{value}</Text>
        )
      ) : null}
      {withChevron ? (
        <MaterialCommunityIcons name="chevron-right" color={palette.labelTertiary} size={20} />
      ) : null}
    </ScalePressable>
  );
}

function ChipRow<T>({ options, value, onChange }: { options: { label: string; value: T }[]; value: T; onChange: (value: T) => void }) {
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

function formatTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(toMs(ts));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function UsagePreferencesScreen() {
  const navigation = useNavigation<SettingsNavProp>();
  const palette = usePalette();
  const settings = useSettingsStore((state) => state.settings);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const showToast = useUiStore((state) => state.showToast);
  const memberCount = useMemberStore((state) => state.members.length);
  const { t } = useI18n();
  const hasUpdate = useUpdateStore((s) => s.hasUpdate);
  const [meta, setMeta] = useState<MemberDataMeta | null>(null);
  const [logVisible, setLogVisible] = useState(false);
  const [updateVisible, setUpdateVisible] = useState(false);
  const latestVersion = useUpdateStore((s) => s.latestVersion);
  const [memberSyncing, setMemberSyncing] = useState(false);
  // 卸载守卫：手动同步耗时较长，期间用户可能退出设置页 → 避免卸载后 setState / 弹 toast
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    getMemberDataMeta().then(setMeta).catch(() => {});
  }, []);

  /** 手动更新成员数据库（双源: yk1z 库 + 官方接口） */
  const manualSyncMembers = useCallback(async () => {
    if (memberSyncing || !mountedRef.current) return;
    setMemberSyncing(true);
    try {
      const res = await updateMemberData();
      if (!mountedRef.current) return;
      const fresh = await getMemberDataMeta();
      if (!mountedRef.current) return;
      setMeta(fresh);
      showToast(res?.detail ? t('更新成功：{detail}', { detail: res.detail }) : t('成员数据已更新'));
    } catch (e: any) {
      if (!mountedRef.current) return;
      showToast(t('更新失败：{msg}（已保留本地数据）', { msg: e?.message || String(e) }));
    } finally {
      if (mountedRef.current) setMemberSyncing(false);
    }
  }, [memberSyncing, t, showToast]);

  const backgroundValue = settings.customBackgroundFile?.trim() || '';
  const backgroundInfo = (() => {
    if (!backgroundValue) return t('未设置');
    if (backgroundValue.startsWith('data:')) return t('本地图片已保存，约 {size}KB', { size: Math.round(backgroundValue.length / 1024) });
    return backgroundValue.length > 60 ? `${backgroundValue.slice(0, 60)}...` : backgroundValue;
  })();

  const THEME_OPTIONS = [
    { label: t('跟随系统'), value: 'system' },
    { label: t('浅色'), value: 'light' },
    { label: t('深色'), value: 'dark' },
  ];


  const update = async (key: string, value: any, extra: any = {}) => {
    const patch = { [key]: value, ...extra };
    setSettings(patch);
    try {
      await saveSettings(patch);
      showToast(t('设置已保存'));
    } catch (error: any) {
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

  const pickBg = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { showDialog(t('需要相册权限')); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, base64: true } as any);
      if (result.canceled) return;
      const base64 = result.assets?.[0]?.base64;
      if (!base64) { showDialog(t('未获取到图片数据')); return; }
      /**
       * ⚠️ MIME 必须按**真实字节**判定，不能信 picker 给的 `mimeType`。
       * 实测踩坑：用户存的背景图是 `data:image/png;base64,/9j/4AAQSkZJRgAB…`
       * —— 声明 PNG，实际是 JPEG（FFD8FFE0）。部分解码路径会信这个声明，
       * 直接解码失败 → 背景层什么都没画出来，透出下层黑底
       * （用户反馈的「背景图没加载」）。
       * 这里嗅探 base64 头部魔数，写对真实类型。
       */
      const mime = sniffImageBase64Mime(base64) || result.assets?.[0]?.mimeType || 'image/jpeg';
      await update('customBackgroundFile', `data:${mime};base64,${base64}`, { customBackgroundUpdatedAt: Date.now() });
    } catch (error: any) {
      showDialog(t('背景图失败'), error?.message || String(error));
    }
  };

  // 有更新时优先走应用内下载安装（下载对应 ABI 分包 → 系统安装器）；
  // 原生桥不可用（如 iOS / 旧包）才退回打开下载页。
  const openUpdate = (url: string) => {
    // 自用权限版：绝不走应用内更新（更新源是公版，装上去会把权限版覆盖掉）
    if (IS_PLUS_BUILD) {
      showToast(t('自用版不提供在线更新，请用本地构建包覆盖安装'));
      return;
    }
    if (isApkUpdaterAvailable) setUpdateVisible(true);
    else if (url) Linking.openURL(url).catch(() => {});
  };

  const checkVersion = () => {
    const { hasUpdate: up, latestUrl } = useUpdateStore.getState();
    if (up && latestUrl) {
      openUpdate(latestUrl);
    } else {
      // force=true：绕过 24h 限流立即请求（否则冷启静默检查后 24h 内手动检查会直接跳过）；
      // 检查不到更新（含网络失败，视为无更新）统一提示「已是最新版本」
      useUpdateStore.getState().checkUpdate(true).then((has) => {
        const next = useUpdateStore.getState();
        if (has && next.hasUpdate && next.latestUrl) openUpdate(next.latestUrl);
        else showToast(t('已是最新版本'));
      }).catch(() => showToast(t('已是最新版本')));
    }
  };

  return (
    <>
      <View style={[styles.container, { backgroundColor: usePageBackground() }]}>
        <ScreenHeader title={t('使用偏好')} onBack={() => navigation.goBack()} />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.pageSub, { color: palette.labelSecondary }]}>{t('小窗、通知与首页模块')}</Text>
        <Section title={t('个性化设置')} icon="tune-variant">
          <View style={styles.innerPad}>
            <Text style={[styles.rowLabel, { color: palette.labelSecondary }]}>{t('切到后台自动弹出系统小窗')}</Text>
            <ChipRow
              options={[{ label: t('关闭'), value: false as any }, { label: t('开启'), value: true as any }]}
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
            <Text style={[styles.rowLabel, { color: palette.labelSecondary }]}>{t('首页「私信」入口显示未读红点')}</Text>
            <ChipRow
              options={[{ label: t('关闭'), value: false as any }, { label: t('开启'), value: true as any }]}
              value={settings.yaya_pm_unread_badge}
              onChange={(v) => update('yaya_pm_unread_badge', v)}
            />
            <Text style={[styles.inlineNote, { color: palette.labelTertiary }]}>
              {t('关闭后首页不再拉取私信未读数，也不显示红点角标')}
            </Text>
          </View>
          <View style={[styles.settingsDivider, { backgroundColor: palette.innerStroke }]} />
          <View style={styles.innerPad}>
            <Text style={[styles.rowLabel, { color: palette.labelSecondary }]}>{t('首页模块')}</Text>
            <Text style={[styles.inlineNote, { color: palette.labelTertiary, marginTop: 0, marginBottom: 2 }]}>
              {t('开关控制显示；↑↓ 调整顺序（立即生效）')}
            </Text>
            {orderedHomeModules.map((def, idx) => {
              const visible = !((settings.home_modules_hidden || []) as string[]).includes(def.key);
              return (
                <View
                  key={def.key}
                  style={[styles.moduleRow, idx > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.innerStroke } : null]}
                >
                  <Text style={[styles.moduleName, { color: palette.label }]} numberOfLines={1}>{t(def.titleKey)}</Text>
                  <View style={styles.moduleCtrl}>
                    <ScalePressable
                      onPress={() => moveHomeModule(def.key, -1)}
                      pressedScale={0.9}
                      disabled={idx === 0}
                      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                      style={{ opacity: idx === 0 ? 0.25 : 1, padding: 4 }}
                    >
                      <MaterialCommunityIcons name="chevron-up" size={20} color={palette.labelSecondary} />
                    </ScalePressable>
                    <ScalePressable
                      onPress={() => moveHomeModule(def.key, 1)}
                      pressedScale={0.9}
                      disabled={idx === orderedHomeModules.length - 1}
                      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                      style={{ opacity: idx === orderedHomeModules.length - 1 ? 0.25 : 1, padding: 4 }}
                    >
                      <MaterialCommunityIcons name="chevron-down" size={20} color={palette.labelSecondary} />
                    </ScalePressable>
                    <Switch
                      value={visible}
                      onValueChange={(v) => toggleHomeModule(def.key, !!v)}
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
              style={{ marginTop: 10, alignSelf: 'flex-start', paddingVertical: 4 }}
            >
              <Text style={{ color: palette.tint, fontSize: 12, fontWeight: '600' }}>{t('恢复默认顺序')}</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.settingsDivider, { backgroundColor: palette.innerStroke }]} />
          <View style={styles.innerPad}>
            <Text style={[styles.rowLabel, { color: palette.labelSecondary }]}>{t('自动签到')}</Text>
            <ChipRow options={[{ label: t('关闭'), value: false as any }, { label: t('开启'), value: true as any }]} value={settings.yaya_auto_checkin_enabled} onChange={(v) => update('yaya_auto_checkin_enabled', v)} />
            {settings.yaya_auto_checkin_enabled ? (
              <Text style={[styles.rowLabel, { color: palette.labelSecondary, marginTop: 10 }]}>
                {t('上次签到：{date}', { date: settings.yaya_auto_checkin_last_date || t('尚未执行') })}
              </Text>
            ) : null}
          </View>
        </Section>
      </ScrollView>
      </View>
      <RuntimeLogViewer visible={logVisible} onClose={() => setLogVisible(false)} />
      <UpdateInstaller visible={updateVisible} version={latestVersion} onClose={() => setUpdateVisible(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 112, paddingHorizontal: 16, paddingTop: 0 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 20, marginBottom: 8, paddingHorizontal: 4 },
  sectionIcon: { width: 20, height: 20, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.3 },
  pageSub: { fontSize: 12, marginTop: 2, marginBottom: 2, paddingHorizontal: 4 },
  // 描边由 GlassSurface 内部统一出（见 Section 注释），此处不再叠 borderWidth/borderColor
  section: { overflow: 'hidden' },
  innerPad: { padding: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowTitle: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '600' },
  rowValueWrap: { flex: 1, textAlign: 'right', flexWrap: 'wrap' },
  rowValue: { flexShrink: 1, fontSize: 12, marginRight: 6, maxWidth: '48%', textAlign: 'right' },
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
