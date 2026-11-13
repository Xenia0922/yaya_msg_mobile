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
import { LinearGradient } from 'expo-linear-gradient';
import Clipboard from '@react-native-clipboard/clipboard';
import { toMs } from '../utils/format';
import {Linking, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { StackNavigationProp } from '@react-navigation/stack';
import {Image, TextInput} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { RootStackParamList, TabParamList } from '../navigation/types';
import { useSettingsStore, useUiStore, useMemberStore, useUpdateStore } from '../store';
import { saveSettings } from '../services/settings';
import pocketApi from '../api/pocket48';
import { setPipEnabled } from '../utils/pip';
import ScreenHeader from '../components/ScreenHeader';
import { Button } from '../components/Button';
import { ScalePressable } from '../components/Motion';
import RuntimeLogViewer from '../components/RuntimeLogViewer';
import UpdateInstaller from '../components/UpdateInstaller';
import { isApkUpdaterAvailable } from '../native/ApkUpdater';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { APP_VERSION } from '../constants';
import { BUILD_TAG } from '../constants/buildChannel';
import { DONATE_QR_URL, DONATE_QR_ASSET } from '../constants/donate';
import { IS_PLUS_BUILD } from '../constants/channel';
import { getMemberDataMeta, MemberDataMeta, updateMemberData } from '../services/memberData';
import { getLiveUserAvatar, normalizeLiveAvatar } from '../services/liveAvatarCache';
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

export default function SettingsScreen() {
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
  const [account, setAccount] = useState<{ name: string; avatar: string } | null>(null);
  const [langVisible, setLangVisible] = useState(false);
  const [donateVisible, setDonateVisible] = useState(false);
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackKind, setFeedbackKind] = useState<'bug' | 'idea'>('bug');
  // 卸载守卫：手动同步耗时较长，期间用户可能退出设置页 → 避免卸载后 setState / 弹 toast
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    getMemberDataMeta().then(setMeta).catch(() => {});
  }, []);

  // 账号卡：有 token 时拉取当前账号昵称/头像；失败只显示「已登录」
  useEffect(() => {
    if (!settings.p48Token) { setAccount(null); return; }
    let alive = true;
    pocketApi.loginCheckToken().then(async (res: any) => {
      if (!alive) return;
      const c: any = res?.content || res?.data || res || {};
      const u: any = c.userInfo || c.user || c.baseUserInfo || c.userList?.[0] || c;
      const userId = String(u.userId || u.id || c.userId || '').trim();
      const rawName = String(u.nickname || u.nickName || u.name || u.userName || c.nickname || c.nickName || '').trim();
      // 有些账号的 name 字段是纯数字账号 ID（如 20261006215238），不作为昵称展示
      const name = rawName;
      let avatar = normalizeLiveAvatar(u.avatar || u.userAvatar || u.headImg || u.avatarUrl || c.avatar || c.userAvatar || '');
      if (!avatar && userId) avatar = await getLiveUserAvatar(userId).catch(() => '');
      if (!alive) return;
      if (name || avatar) setAccount({ name, avatar });
    }).catch(() => {});
    return () => { alive = false; };
  }, [settings.p48Token]);

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

  /** 问题与建议：生成可复制的反馈文本 / 预填 GitHub Issue */
  const feedbackBody = () => {
    const head = feedbackKind === 'bug' ? '[问题]' : '[建议]';
    return `${head} ${feedbackText.trim()}\n\n---\n应用版本：${APP_VERSION}\n平台：${Platform.OS} ${Platform.Version}`;
  };
  const copyFeedback = () => {
    if (!feedbackText.trim()) { showToast(t('请先填写问题或建议')); return; }
    Clipboard.setString(feedbackBody());
    showToast(t('已复制到剪贴板'));
  };
  const openFeedbackIssue = () => {
    if (!feedbackText.trim()) { showToast(t('请先填写问题或建议')); return; }
    const title = encodeURIComponent(`${feedbackKind === 'bug' ? '[Bug]' : '[Feature]'} ${feedbackText.trim().slice(0, 40)}`);
    const body = encodeURIComponent(feedbackBody());
    Linking.openURL(`https://github.com/Xenia0922/yaya_msg_mobile/issues/new?title=${title}&body=${body}`).catch(() => {});
  };

  // 有更新时优先走应用内下载安装（下载对应 ABI 分包 → 系统安装器）；
  // 原生桥不可用（如 iOS / 旧包）才退回打开下载页。
  const openUpdate = (url: string) => {
    // plus 版也走应用内更新，但只下载 plus 资产（yaya-msg-mobile-plus-*），
    // 自建源没有 plus 包时由 UpdateInstaller 报错，绝不回退公版覆盖权限版。
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

  const versionLabel = `v${APP_VERSION}${BUILD_TAG ? ` · ${BUILD_TAG}` : ''}`;

  const languageLabel = (() => {
    const cur = settings.language || 'system';
    const item = LANGUAGE_OPTIONS.find((o) => o.value === cur);
    return item ? (cur === 'system' ? t(item.label) : item.label) : t('跟随系统');
  })();

  return (
    <>
      <View style={[styles.container, { backgroundColor: usePageBackground() }]}>
        <ScreenHeader title={t('设置')} hideBack />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.pageSub, { color: palette.labelSecondary }]}>{t('账号、外观与数据管理')}</Text>

        {/* 账号与资料 */}
        <Section title={t('账号与资料')} icon="account-circle-outline">
          <TouchableOpacity
            style={styles.accountCard}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('LoginScreen')}
          >
            <LinearGradient
              colors={[palette.tintSoft, 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
              pointerEvents="none"
            />
            <View style={[styles.accountAvatar, { backgroundColor: palette.tintSoft, borderColor: palette.tint }]}>
              {account?.avatar ? (
                <Image source={{ uri: account.avatar }} style={styles.accountAvatarImg} />
              ) : (
                <MaterialCommunityIcons name="account" size={24} color={palette.tint} />
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.accountName, { color: palette.label }]} numberOfLines={1}>
                {account?.name || (settings.p48Token ? t('口袋48 账号') : t('点击登录'))}
              </Text>
              <Text style={[styles.accountSub, { color: palette.labelSecondary }]} numberOfLines={1}>
                {settings.p48Token ? t('点击管理账号') : t('点击登录 / 注册')}
              </Text>
            </View>
            <View style={[styles.accountStatus, { backgroundColor: palette.tintSoft }]}>
              <Text style={[styles.accountStatusText, { color: palette.tint }]}>
                {settings.p48Token ? t('已登录') : t('未登录')}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={palette.labelTertiary} />
          </TouchableOpacity>
        </Section>

        {/* 外观与显示 */}
        <Section title={t('外观与显示')} icon="palette-outline">
          <View style={styles.innerPad}>
            <Text style={[styles.rowLabel, { color: palette.labelSecondary }]}>{t('主题')}</Text>
            <ChipRow options={THEME_OPTIONS} value={settings.theme} onChange={(v) => update('theme', v)} />
          </View>
          <View style={[styles.divider, { backgroundColor: palette.innerStroke }]} />
          <Row
            icon="image"
            title={t('背景图')}
            value={backgroundInfo}
            onPress={pickBg}
          />
          {backgroundValue ? (
            <>
              <View style={[styles.divider, { backgroundColor: palette.innerStroke }]} />
              <Row
                icon="restore"
                title={t('恢复默认背景')}
                danger
                withChevron={false}
                onPress={() => {
                  showDialog(t('恢复默认背景'), t('将移除当前背景图，确定？'), [
                    { text: t('取消'), style: 'cancel' },
                    { text: t('恢复默认'), style: 'destructive', onPress: () => update('customBackgroundFile', '', { customBackgroundUpdatedAt: Date.now() }) },
                  ]);
                }}
              />
            </>
          ) : null}
          <View style={[styles.divider, { backgroundColor: palette.innerStroke }]} />
          <Row
            icon="translate"
            title={t('语言')}
            value={languageLabel}
            onPress={() => setLangVisible(true)}
          />
        </Section>

        {/* 使用与偏好 */}
        <Section title={t('使用与偏好')} icon="tune-variant">
          <Row
            icon="tune-variant"
            title={t('使用偏好')}
            value={t('小窗 / 首页模块 / 签到')}
            onPress={() => navigation.navigate('UsagePreferences' as never)}
          />
        </Section>

        {/* 数据与工具 */}
        <Section title={t('数据与工具')} icon="database-outline">
          <TouchableOpacity style={styles.memberCompact} activeOpacity={0.9} onPress={manualSyncMembers}>
            <View style={[styles.rowIcon, { backgroundColor: palette.tintSoft }]}>
              <MaterialCommunityIcons name="database-sync" size={16} color={palette.tint} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.rowTitle, { color: palette.label }]} numberOfLines={1}>{t('成员数据')}</Text>
              <Text style={[styles.memberSub, { color: palette.labelSecondary }]} numberOfLines={1}>
                {t('{count} 位 · {time} 更新', { count: memberCount, time: meta ? formatTime(meta.savedAt).slice(5, 16) : t('尚未同步') })}
              </Text>
            </View>
            <View style={[styles.syncPill, { backgroundColor: palette.tintSoft }]}>
              <MaterialCommunityIcons name="cloud-download" size={14} color={palette.tint} />
              <Text style={[styles.syncPillText, { color: palette.tint }]}>
                {memberSyncing ? t('更新中…') : t('立即同步')}
              </Text>
            </View>
          </TouchableOpacity>
          <View style={[styles.divider, { backgroundColor: palette.innerStroke }]} />
          <Row icon="text-box-search-outline" title={t('运行日志')} onPress={() => setLogVisible(true)} />
          <Text style={[styles.note, { color: palette.labelTertiary }]}>
            {t('进入软件时自动同步成员数据 · 数据来源于 yk1z 数据库')}
          </Text>
        </Section>

        {/* 关于软件：低频信息统一收进独立页面 */}
        <Section title={t('其他')} icon="dots-horizontal">
          <Row
            icon="information-outline"
            title={t('关于软件')}
            value={hasUpdate ? t('有新版本') : undefined}
            onPress={() => navigation.navigate('AboutScreen' as never)}
          />
          <View style={[styles.divider, { backgroundColor: palette.innerStroke }]} />
          <Row
            icon="file-document-outline"
            title={t('免责声明')}
            value={t('查看完整声明')}
            onPress={() => navigation.navigate('DisclaimerScreen' as never)}
          />
        </Section>

        <Text style={[styles.footer, { color: palette.labelTertiary }]}>Version {APP_VERSION}</Text>
        <ListBottomSpacer base={16} />
      </ScrollView>
      </View>

      {/* 语言选择弹层：解决 6 语言单行溢出 */}
      <Modal visible={langVisible} transparent animationType="slide" onRequestClose={() => setLangVisible(false)}>
        <TouchableOpacity style={styles.langShade} activeOpacity={1} onPress={() => setLangVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.langSheet, { backgroundColor: palette.surface }]} onPress={() => {}}>
            <Text style={[styles.langTitle, { color: palette.label }]}>{t('语言')}</Text>
            {LANGUAGE_OPTIONS.map((o) => {
              const selected = (settings.language || 'system') === o.value;
              const label = o.value === 'system' ? t(o.label) : o.label;
              return (
                <TouchableOpacity
                  key={o.value}
                  style={styles.langItem}
                  activeOpacity={0.8}
                  onPress={() => { setLangVisible(false); void update('language', o.value); }}
                >
                  <Text style={[styles.langLabel, { color: selected ? palette.tint : palette.label }]}>{label}</Text>
                  {selected ? <MaterialCommunityIcons name="check" size={20} color={palette.tint} /> : null}
                </TouchableOpacity>
              );
            })}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

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
  footer: { fontSize: 11, textAlign: 'center', marginTop: 18, marginBottom: 4 },
  // 描边由 GlassSurface 内部统一出（见 Section 注释），此处不再叠 borderWidth/borderColor
  section: { overflow: 'hidden' },
  innerPad: { padding: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
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
  rowLabel: { fontSize: 12, lineHeight: 18, marginBottom: 6 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 54 },
  // 关于与支持（紧凑）
  aboutBrief: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  aboutLogoSmall: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  aboutLogoSmallImg: { width: 44, height: 44, borderRadius: 16 },
  aboutNameSmall: { fontSize: 16, fontWeight: '800' },
  aboutVersion: { fontSize: 11, marginTop: 3 },
  checkPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14 },
  checkPillText: { fontSize: 11, fontWeight: '700' },
  // 账号卡
  accountCard: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12, overflow: 'hidden' },
  accountAvatar: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1.5 },
  accountAvatarImg: { width: 48, height: 48 },
  accountName: { fontSize: 16, fontWeight: '700' },
  accountSub: { fontSize: 12, marginTop: 3 },
  accountStatus: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginRight: 2 },
  accountStatusText: { fontSize: 10, fontWeight: '700' },
  // 成员数据（压缩一行）
  memberCompact: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14, gap: 12 },
  memberSub: { fontSize: 11, marginTop: 3 },
  syncPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14 },
  syncPillText: { fontSize: 11, fontWeight: '700' },
  note: { marginHorizontal: 14, marginTop: 8, marginBottom: 14, fontSize: 11, lineHeight: 16 },
  // 语言弹层
  langShade: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  langSheet: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 28, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  langTitle: { fontSize: 16, fontWeight: '800', marginBottom: 6 },
  langItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  langLabel: { fontSize: 15, fontWeight: '600' },
  donateSheet: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 30, borderTopLeftRadius: 24, borderTopRightRadius: 24, alignItems: 'stretch' },
  donateHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  donateQr: { width: 220, height: 220, alignSelf: 'center', borderRadius: 16, backgroundColor: '#fff' },
  donatePlaceholder: { height: 220, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 8 },
  donatePlaceholderText: { fontSize: 14, fontWeight: '700' },
  donateNote: { fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 10 },
  donateActions: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 16 },
  feedbackSheet: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 30, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  feedbackKinds: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  feedbackKindChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 14 },
  feedbackInput: { minHeight: 120, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, lineHeight: 19 },
  // 首页模块（C4）：每块 = 名称 + 上移/下移 + 关闭/开启
});
