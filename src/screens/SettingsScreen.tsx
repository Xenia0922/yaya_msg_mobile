import React, { useCallback, useEffect, useRef, useState } from 'react';
import { showDialog } from '../components/AppDialog';
import { LinearGradient } from 'expo-linear-gradient';
import { toMs } from '../utils/format';
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { StackNavigationProp } from '@react-navigation/stack';
import { Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { RootStackParamList, TabParamList } from '../navigation/types';
import { useSettingsStore, useUiStore, useMemberStore, useUpdateStore } from '../store';
import { saveSettings } from '../services/settings';
import {
  FloatingHeaderAction,
  FloatingTabHeader,
  getFloatingHeaderOffset,
} from '../components/FloatingTabHeader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePocketAccountSummary } from '../hooks/usePocketAccountSummary';
import { ScalePressable } from '../components/Motion';
import RuntimeLogViewer from '../components/RuntimeLogViewer';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { APP_VERSION } from '../constants';
import { getMemberDataMeta, MemberDataMeta, updateMemberData } from '../services/memberData';
import { fontFamily, usePalette, getPageBackground } from '../theme';
import { useI18n, LANGUAGE_OPTIONS } from '../i18n';
import { GlassSurface } from '../components/GlassSurface';
import { SquircleView } from '../components/SquircleView';
import { GlassSegmented, GlassSegmentedScroll } from '../components/GlassSegmented';
import { sniffImageBase64Mime } from '../utils/dataUri';
import { ListBottomSpacer } from '../components/ListBottomSpacer';

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
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !onPress }}
    >
      <View
        style={[
          styles.rowIcon,
          { backgroundColor: danger ? 'rgba(255,59,48,0.12)' : palette.tintSoft },
        ]}
      >
        <MaterialCommunityIcons
          name={icon}
          color={danger ? palette.danger : palette.tint}
          size={16}
        />
      </View>
      <Text
        style={[styles.rowTitle, { color: danger ? palette.danger : palette.label }]}
        numberOfLines={1}
      >
        {title}
      </Text>
      {value ? (
        wrapValue ? (
          <Text style={[styles.rowValue, styles.rowValueWrap, { color: palette.labelTertiary }]}>
            {value}
          </Text>
        ) : (
          <Text style={[styles.rowValue, { color: palette.labelTertiary }]} numberOfLines={1}>
            {value}
          </Text>
        )
      ) : null}
      {withChevron ? (
        <MaterialCommunityIcons name="chevron-right" color={palette.labelTertiary} size={20} />
      ) : null}
    </ScalePressable>
  );
}

function ChipRow<T>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
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

function formatTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(toMs(ts));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SettingsScreen() {
  const navigation = useNavigation<SettingsNavProp>();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const headerOffset = getFloatingHeaderOffset(insets.top);
  const settings = useSettingsStore((state) => state.settings);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const showToast = useUiStore((state) => state.showToast);
  const memberCount = useMemberStore((state) => state.members.length);
  const { t } = useI18n();
  const hasUpdate = useUpdateStore((s) => s.hasUpdate);
  const [meta, setMeta] = useState<MemberDataMeta | null>(null);
  const [logVisible, setLogVisible] = useState(false);
  const [memberSyncing, setMemberSyncing] = useState(false);
  const account = usePocketAccountSummary(settings.p48Token);
  const [langVisible, setLangVisible] = useState(false);

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    getMemberDataMeta()
      .then(setMeta)
      .catch(() => {});
  }, []);

  const manualSyncMembers = useCallback(async () => {
    if (memberSyncing || !mountedRef.current) return;
    setMemberSyncing(true);
    try {
      const res = await updateMemberData();
      if (!mountedRef.current) return;
      const fresh = await getMemberDataMeta();
      if (!mountedRef.current) return;
      setMeta(fresh);
      showToast(
        res?.detail ? t('更新成功：{detail}', { detail: res.detail }) : t('成员数据已更新'),
      );
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
    if (backgroundValue.startsWith('data:'))
      return t('本地图片已保存，约 {size}KB', { size: Math.round(backgroundValue.length / 1024) });
    return backgroundValue.length > 60 ? `${backgroundValue.slice(0, 60)}...` : backgroundValue;
  })();

  const THEME_OPTIONS = [
    { label: t('跟随系统'), value: 'system' },
    { label: t('浅色'), value: 'light' },
    { label: t('深色'), value: 'dark' },
  ];

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

  const pickBg = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showDialog(t('需要相册权限'));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        quality: 0.8,
        base64: true,
      } as any);
      if (result.canceled) return;
      const base64 = result.assets?.[0]?.base64;
      if (!base64) {
        showDialog(t('未获取到图片数据'));
        return;
      }

      const mime = sniffImageBase64Mime(base64) || result.assets?.[0]?.mimeType || 'image/jpeg';
      await update('customBackgroundFile', `data:${mime};base64,${base64}`, {
        customBackgroundUpdatedAt: Date.now(),
      });
    } catch (error: any) {
      showDialog(t('背景图失败'), error?.message || String(error));
    }
  };

  const languageLabel = (() => {
    const cur = settings.language || 'system';
    const item = LANGUAGE_OPTIONS.find((o) => o.value === cur);
    return item ? (cur === 'system' ? t(item.label) : item.label) : t('跟随系统');
  })();

  return (
    <>
      <View style={[styles.container, { backgroundColor: getPageBackground() }]}>
        <FloatingTabHeader
          left={
            <Text style={[styles.headerTitle, { color: palette.label }]} numberOfLines={1}>
              {t('设置')}
            </Text>
          }
          right={
            <>
              <FloatingHeaderAction
                icon={palette.name === 'dark' ? 'white-balance-sunny' : 'weather-night'}
                accessibilityLabel={t('切换主题')}
                onPress={() => update('theme', palette.name === 'dark' ? 'light' : 'dark')}
              />
              <FloatingHeaderAction
                icon="tune-variant"
                accessibilityLabel={t('使用偏好')}
                onPress={() => navigation.navigate('UsagePreferences' as never)}
              />
            </>
          }
        />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.content, { paddingTop: headerOffset }]}
          showsVerticalScrollIndicator={false}
        >
          <Section title={t('账号与资料')} icon="account-circle-outline">
            <TouchableOpacity
              style={styles.accountCard}
              activeOpacity={0.9}
              onPress={() => navigation.navigate('LoginScreen')}
              accessibilityRole="button"
              accessibilityLabel={t('账号与资料')}
            >
              <LinearGradient
                colors={[palette.tintSoft, 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
                pointerEvents="none"
              />
              <SquircleView
                radius={16}
                style={[
                  styles.accountAvatar,
                  { backgroundColor: palette.tintSoft, borderColor: palette.tint },
                ]}
              >
                {account?.avatar ? (
                  <Image source={{ uri: account.avatar }} style={styles.accountAvatarImg} />
                ) : (
                  <MaterialCommunityIcons name="account" size={24} color={palette.tint} />
                )}
              </SquircleView>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.accountName, { color: palette.label }]} numberOfLines={1}>
                  {account?.name || (settings.p48Token ? t('口袋48 账号') : t('点击登录'))}
                </Text>
                <Text
                  style={[styles.accountSub, { color: palette.labelSecondary }]}
                  numberOfLines={1}
                >
                  {settings.p48Token ? t('点击管理账号') : t('点击登录 / 注册')}
                </Text>
              </View>
              <View style={[styles.accountStatus, { backgroundColor: palette.tintSoft }]}>
                <Text style={[styles.accountStatusText, { color: palette.tint }]}>
                  {settings.p48Token ? t('已登录') : t('未登录')}
                </Text>
              </View>
              <MaterialCommunityIcons
                name="chevron-right"
                size={20}
                color={palette.labelTertiary}
              />
            </TouchableOpacity>
          </Section>

          <Section title={t('外观与显示')} icon="palette-outline">
            <View style={styles.innerPad}>
              <Text style={[styles.rowLabel, { color: palette.labelSecondary }]}>{t('主题')}</Text>
              <ChipRow
                options={THEME_OPTIONS}
                value={settings.theme}
                onChange={(v) => update('theme', v)}
              />
            </View>
            <View style={[styles.divider, { backgroundColor: palette.innerStroke }]} />
            <Row icon="image" title={t('背景图')} value={backgroundInfo} onPress={pickBg} />
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
                      {
                        text: t('恢复默认'),
                        style: 'destructive',
                        onPress: () =>
                          update('customBackgroundFile', '', {
                            customBackgroundUpdatedAt: Date.now(),
                          }),
                      },
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
            <View style={[styles.divider, { backgroundColor: palette.innerStroke }]} />
            <Row
              icon="tune-variant"
              title={t('使用偏好')}
              value={t('小窗 / 首页模块 / 签到')}
              onPress={() => navigation.navigate('UsagePreferences' as never)}
            />
          </Section>

          <Section title={t('数据与工具')} icon="database-outline">
            <TouchableOpacity
              style={styles.memberCompact}
              activeOpacity={0.9}
              onPress={manualSyncMembers}
              accessibilityRole="button"
              accessibilityLabel={t('成员数据')}
              accessibilityState={{ busy: memberSyncing }}
            >
              <View style={[styles.rowIcon, { backgroundColor: palette.tintSoft }]}>
                <MaterialCommunityIcons name="database-sync" size={16} color={palette.tint} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.rowTitle, { color: palette.label }]} numberOfLines={1}>
                  {t('成员数据')}
                </Text>
                <Text
                  style={[styles.memberSub, { color: palette.labelSecondary }]}
                  numberOfLines={1}
                >
                  {t('{count} 位 · {time} 更新', {
                    count: memberCount,
                    time: meta ? formatTime(meta.savedAt).slice(5, 16) : t('尚未同步'),
                  })}
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
            <Row
              icon="text-box-search-outline"
              title={t('运行日志')}
              onPress={() => setLogVisible(true)}
            />
            <Text style={[styles.note, { color: palette.labelTertiary }]}>
              {t('进入软件时自动同步成员数据 · 数据来源于 yk1z 数据库')}
            </Text>
          </Section>

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

          <Text style={[styles.footer, { color: palette.labelTertiary }]}>
            Version {APP_VERSION}
          </Text>
          <ListBottomSpacer base={16} />
        </ScrollView>
      </View>

      <Modal
        visible={langVisible}
        transparent
        animationType="slide"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setLangVisible(false)}
      >
        <TouchableOpacity
          style={styles.langShade}
          activeOpacity={1}
          onPress={() => setLangVisible(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={[
              styles.langSheet,
              {
                backgroundColor: palette.surface,
                paddingBottom: Math.max(20, insets.bottom + 12),
              },
            ]}
            onPress={() => {}}
          >
            <View
              style={{
                width: 38,
                height: 4,
                borderRadius: 2,
                backgroundColor: palette.fill3,
                alignSelf: 'center',
                marginBottom: 10,
              }}
            />
            <Text style={[styles.langTitle, { color: palette.label }]}>{t('语言')}</Text>
            {LANGUAGE_OPTIONS.map((o) => {
              const selected = (settings.language || 'system') === o.value;
              const label = o.value === 'system' ? t(o.label) : o.label;
              return (
                <TouchableOpacity
                  key={o.value}
                  style={styles.langItem}
                  activeOpacity={0.8}
                  onPress={() => {
                    setLangVisible(false);
                    void update('language', o.value);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityState={{ selected }}
                >
                  <Text
                    style={[styles.langLabel, { color: selected ? palette.tint : palette.label }]}
                  >
                    {label}
                  </Text>
                  {selected ? (
                    <MaterialCommunityIcons name="check" size={20} color={palette.tint} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <RuntimeLogViewer visible={logVisible} onClose={() => setLogVisible(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 112, paddingHorizontal: 16 },
  headerTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontFamily: fontFamily.system,
    fontWeight: '700',
    letterSpacing: -0.2,
    includeFontPadding: false,
    textAlignVertical: 'center',
    ...Platform.select({ android: { paddingTop: 1 }, default: null }),
  },
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
  footer: {
    fontSize: 11,
    fontFamily: fontFamily.system,
    textAlign: 'center',
    marginTop: 18,
    marginBottom: 4,
  },

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
  rowTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontFamily: fontFamily.system,
    fontWeight: '600',
  },
  rowValueWrap: { flex: 1, textAlign: 'right', flexWrap: 'wrap' },
  rowValue: {
    flexShrink: 1,
    fontSize: 12,
    fontFamily: fontFamily.system,
    marginRight: 6,
    maxWidth: '48%',
    textAlign: 'right',
  },
  rowLabel: { fontSize: 12, fontFamily: fontFamily.system, lineHeight: 18, marginBottom: 6 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 54 },

  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
    overflow: 'hidden',
  },
  accountAvatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1.5,
  },
  accountAvatarImg: { width: 48, height: 48 },
  accountName: { fontSize: 16, fontFamily: fontFamily.system, fontWeight: '600' },
  accountSub: { fontSize: 12, fontFamily: fontFamily.system, marginTop: 3 },
  accountStatus: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginRight: 2 },
  accountStatusText: { fontSize: 11, fontFamily: fontFamily.system, fontWeight: '600' },

  memberCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  memberSub: { fontSize: 11, fontFamily: fontFamily.system, marginTop: 3 },
  syncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  syncPillText: { fontSize: 11, fontFamily: fontFamily.system, fontWeight: '600' },
  note: {
    marginHorizontal: 14,
    marginTop: 8,
    marginBottom: 14,
    fontSize: 11,
    fontFamily: fontFamily.system,
    lineHeight: 16,
  },

  langShade: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  langSheet: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 28,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  langTitle: { fontSize: 16, fontFamily: fontFamily.system, fontWeight: '700', marginBottom: 6 },
  langItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  langLabel: { fontSize: 15, fontFamily: fontFamily.system, fontWeight: '600' },
});
