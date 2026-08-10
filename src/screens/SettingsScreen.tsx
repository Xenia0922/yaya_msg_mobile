import React, { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
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
import ScreenHeader from '../components/ScreenHeader';
import RuntimeLogViewer from '../components/RuntimeLogViewer';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { APP_VERSION } from '../constants';
import { getMemberDataMeta, MemberDataMeta } from '../services/memberData';
import { useAppTheme } from '../hooks/useAppTheme';
import { useI18n, LANGUAGE_OPTIONS } from '../i18n';

type SettingsNavProp = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'Settings'>,
  StackNavigationProp<RootStackParamList>
>;

function Section({ title, children, isDark }: { title: string; children: React.ReactNode; isDark: boolean }) {
  return (
    <View style={[styles.section, isDark && styles.sectionDark]}>
      <Text style={[styles.sectionTitle, isDark && styles.textLight]}>{title}</Text>
      {children}
    </View>
  );
}

function ChipRow<T>({ options, value, isDark, onChange }: { options: { label: string; value: T }[]; value: T; isDark: boolean; onChange: (value: T) => void }) {
  return (
    <View style={styles.chipRow}>
      {options.map((opt) => (
        <TouchableOpacity
          key={String(opt.value)}
          style={[styles.chip, isDark && styles.chipDark, value === opt.value && styles.chipActive]}
          onPress={() => onChange(opt.value)}
        >
          <Text style={[styles.chipText, isDark && styles.textSubLight, value === opt.value && styles.chipTextActive]}>
            {opt.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function formatTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SettingsScreen() {
  const navigation = useNavigation<SettingsNavProp>();
  const settings = useSettingsStore((state) => state.settings);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const showToast = useUiStore((state) => state.showToast);
  const memberCount = useMemberStore((state) => state.members.length);
  const isDark = useAppTheme();
  const { t } = useI18n();
  const hasUpdate = useUpdateStore((s) => s.hasUpdate);
  const [meta, setMeta] = useState<MemberDataMeta | null>(null);
  const [logVisible, setLogVisible] = useState(false);

  useEffect(() => {
    getMemberDataMeta().then(setMeta).catch(() => {});
  }, []);

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
    await saveSettings(patch);
    showToast(t('设置已保存'));
  };

  const pickBg = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert(t('需要相册权限')); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, base64: true } as any);
      if (result.canceled) return;
      const base64 = result.assets?.[0]?.base64;
      if (!base64) { Alert.alert(t('未获取到图片数据')); return; }
      const mime = result.assets?.[0]?.mimeType || 'image/jpeg';
      await update('customBackgroundFile', `data:${mime};base64,${base64}`, { customBackgroundUpdatedAt: Date.now() });
    } catch (error: any) {
      Alert.alert(t('背景图失败'), error?.message || String(error));
    }
  };

  return (
    <>
      <ScrollView style={[styles.container, isDark && styles.containerDark]} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <ScreenHeader title={t('设置')} />

      <Section title={t('关于牙牙消息')} isDark={isDark}>
        <View style={[styles.aboutHero, isDark && styles.aboutHeroDark]}>
          <Image source={require('../../assets/logo.jpg')} style={styles.aboutLogoImg} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.aboutName, isDark && styles.textLight]}>{t('牙牙消息')}</Text>
            <Text style={[styles.aboutSub, isDark && styles.textSubLight]}>{t('Yaya Message · 口袋48 第三方客户端')}</Text>
          </View>
          <View style={styles.verChipWrap}>
            <TouchableOpacity
              style={styles.verChip}
              onPress={() => {
                const { hasUpdate, latestUrl } = useUpdateStore.getState();
                if (hasUpdate && latestUrl) {
                  Linking.openURL(latestUrl).catch(() => {});
                }
              }}
            >
              <Text style={styles.verChipText}>v{APP_VERSION}</Text>
            </TouchableOpacity>
            {hasUpdate ? <View style={styles.verDot} /> : null}
          </View>
        </View>

        <Text style={[styles.blockTitle, isDark && styles.textLight]}>{t('致谢')}</Text>
        <Text style={[styles.ackText, isDark && styles.textSubLight]}>
          {t('基于')}{' '}
          <Text style={styles.ackLink} onPress={() => Linking.openURL('https://github.com/yk1z/yaya_msg')}>yk1z/yaya_msg</Text>
          {' '}{t('二次开发的移动端版本，感谢原作者的开源贡献。')}
        </Text>

        <TouchableOpacity style={[styles.linkCard, isDark && styles.linkCardDark]} onPress={() => Linking.openURL('https://github.com/Xenia0922/yaya_msg_mobile')}>
          <MaterialCommunityIcons name="github" size={20} color="#ff6f91" />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={[styles.linkCardLabel, isDark && styles.textLight]}>{t('本项目仓库')}</Text>
            <Text style={[styles.linkCardValue, isDark && styles.textSubLight]}>Xenia0922/yaya_msg_mobile</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={isDark ? '#888' : '#ccc'} />
        </TouchableOpacity>

        <View style={styles.divider} />

        <Text style={[styles.blockTitle, isDark && styles.textLight]}>{t('开源协议')}</Text>
        <Text style={[styles.ackText, isDark && styles.textSubLight]}>
          {t('基于 GPL-3.0 协议开源，仅供学习交流。软件不上传任何数据到云端，仅在本地缓存以维持功能可用。完整许可证见仓库 LICENSE 文件。')}
        </Text>
      </Section>

      <Section title={t('账号')} isDark={isDark}>
        <Text style={[styles.sub, isDark && styles.textSubLight]}>{t('口袋登录、大小号切换、B站登录、修改昵称和头像')}</Text>
        <TouchableOpacity style={styles.linkBtn} onPress={() => navigation.navigate('LoginScreen')}>
          <Text style={styles.linkText}>{t('进入账号管理')}</Text>
        </TouchableOpacity>
      </Section>

      <Section title={t('外观')} isDark={isDark}>
        <ChipRow options={THEME_OPTIONS} value={settings.theme} isDark={isDark} onChange={(v) => update('theme', v)} />
        <View style={styles.divider} />
        <Text style={[styles.sub, isDark && styles.textSubLight]}>{t('背景图：{info}', { info: backgroundInfo })}</Text>
        <View style={styles.chipRow}>
          <TouchableOpacity style={styles.linkBtn} onPress={pickBg}>
            <Text style={styles.linkText}>{t('选择本地图片')}</Text>
          </TouchableOpacity>
        </View>
        {backgroundValue ? (
          <TouchableOpacity style={styles.clearBtn} onPress={() => { update('customBackgroundFile', '', { customBackgroundUpdatedAt: Date.now() }); }}>
            <Text style={styles.clearText}>{t('恢复默认背景')}</Text>
          </TouchableOpacity>
        ) : null}
      </Section>

      <Section title={t('语言')} isDark={isDark}>
        <ChipRow options={LANGUAGE_OPTIONS.map((o) => ({ ...o, label: o.value === 'system' ? t(o.label) : o.label }))} value={settings.language || 'system'} isDark={isDark} onChange={(v) => update('language', v)} />
      </Section>

      <Section title={t('自动签到')} isDark={isDark}>
        <ChipRow options={[{ label: t('关闭'), value: false as any }, { label: t('开启'), value: true as any }]} value={settings.yaya_auto_checkin_enabled} isDark={isDark} onChange={(v) => update('yaya_auto_checkin_enabled', v)} />
        {settings.yaya_auto_checkin_enabled ? (
          <Text style={[styles.sub, isDark && styles.textSubLight]}>
            {t('上次签到：{date}', { date: settings.yaya_auto_checkin_last_date || t('尚未执行') })}
          </Text>
        ) : null}
      </Section>

      <Section title={t('工具')} isDark={isDark}>
        <View style={styles.toolRow}>
          <TouchableOpacity style={[styles.linkBtn, { marginRight: 8 }]} onPress={() => navigation.navigate('DownloadScreen')}>
            <Text style={styles.linkText}>{t('下载管理')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkBtn} onPress={() => setLogVisible(true)}>
            <Text style={styles.linkText}>{t('运行日志')}</Text>
          </TouchableOpacity>
        </View>
      </Section>

      <Section title={t('成员数据')} isDark={isDark}>
        <View style={styles.memberStatRow}>
          <View style={styles.memberStat}>
            <Text style={[styles.memberStatNum, isDark && styles.textLight]}>{memberCount}</Text>
            <Text style={[styles.memberStatLabel, isDark && styles.textSubLight]}>{t('位成员')}</Text>
          </View>
          <View style={styles.memberStatDivider} />
          <View style={styles.memberStat}>
            <Text style={[styles.memberStatNum, isDark && styles.textLight]}>{meta ? formatTime(meta.savedAt) : t('尚未同步')}</Text>
            <Text style={[styles.memberStatLabel, isDark && styles.textSubLight]}>{t('最近更新')}</Text>
          </View>
        </View>
        <View style={[styles.autoSyncRow, isDark && styles.autoSyncRowDark]}>
          <MaterialCommunityIcons name="sync" size={16} color="#ff6f91" />
          <Text style={[styles.autoSyncText, isDark && styles.textSubLight]}>{t('进入软件时自动同步成员数据')}</Text>
        </View>
        <Text style={[styles.note, isDark && styles.textSubLight]}>
          {t('成员数据共 {count} 位，数据来源于 yk1z 数据库（yk1z/yaya_msg），进入软件时自动同步最新。', { count: memberCount })}
        </Text>
      </Section>

      <Text style={[styles.footer, isDark && styles.textSubLight]}>{t('Version {v}', { v: APP_VERSION })}</Text>
    </ScrollView>
      <RuntimeLogViewer visible={logVisible} onClose={() => setLogVisible(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  content: { paddingBottom: 112 },
  section: { marginHorizontal: 12, marginTop: 8, padding: 14, backgroundColor: 'rgba(255,255,255,0.72)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.66)' },
  sectionDark: { backgroundColor: 'rgba(20,20,20,0.62)', borderColor: 'rgba(255,255,255,0.10)' },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#222', marginBottom: 8 },
  sub: { fontSize: 12, color: '#555', marginBottom: 6, lineHeight: 18 },
  divider: { height: 1, backgroundColor: 'rgba(0,0,0,0.06)', marginVertical: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.05)' },
  chipDark: { backgroundColor: 'rgba(255,255,255,0.08)' },
  chipActive: { backgroundColor: '#ff6f91' },
  chipText: { fontSize: 13, color: '#444', fontWeight: '700' },
  chipTextActive: { color: '#fff' },
  linkBtn: { flex: 1, minHeight: 40, borderRadius: 18, backgroundColor: '#ff6f91', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  linkText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  clearBtn: { marginTop: 8, minHeight: 36, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,0,0,0.08)' },
  clearText: { color: '#e74c3c', fontWeight: '800', fontSize: 12 },
  note: { marginTop: 8, fontSize: 11, color: '#888', lineHeight: 16 },
  aboutHero: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderRadius: 12, overflow: 'hidden' },
  toolRow: { flexDirection: 'row' },
  aboutName: { fontSize: 22, fontWeight: '900', color: '#222' },
  aboutSub: { fontSize: 12, color: '#666', marginTop: 4 },
  blockTitle: { fontSize: 13, fontWeight: '800', color: '#333', marginTop: 12, marginBottom: 4 },
  ackText: { fontSize: 12, color: '#666', lineHeight: 18 },
  ackLink: { color: '#ff6f91', fontWeight: '700' },
  footer: { textAlign: 'center', color: '#999', fontSize: 12, marginTop: 16 },
  textLight: { color: '#fff' },
  textSubLight: { color: '#ddd' },
  aboutHeroDark: { backgroundColor: 'rgba(255,111,145,0.10)' },
  aboutLogoImg: { width: 52, height: 52, borderRadius: 16, marginRight: 12, backgroundColor: '#f0f0f0' },
  verChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16, backgroundColor: 'rgba(255,111,145,0.14)' },
  verChipWrap: { alignItems: 'flex-end' },
  verDot: { position: 'absolute', top: -2, right: -2, width: 9, height: 9, borderRadius: 5, backgroundColor: '#ff3b30', borderWidth: 1.5, borderColor: '#fff' },
  verChipText: { color: '#ff6f91', fontSize: 12, fontWeight: '800' },
  linkCard: { flexDirection: 'row', alignItems: 'center', marginTop: 12, padding: 12, borderRadius: 16, backgroundColor: 'rgba(255,111,145,0.08)' },
  linkCardDark: { backgroundColor: 'rgba(255,111,145,0.12)' },
  linkCardLabel: { fontSize: 13, fontWeight: '700', color: '#333' },
  linkCardValue: { fontSize: 11, color: '#888', marginTop: 2 },
  memberStatRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  memberStat: { flex: 1, alignItems: 'center' },
  memberStatNum: { fontSize: 18, fontWeight: '900', color: '#222' },
  memberStatLabel: { fontSize: 11, color: '#888', marginTop: 2 },
  memberStatDivider: { width: 1, height: 32, backgroundColor: 'rgba(0,0,0,0.08)' },
  autoSyncRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16, backgroundColor: 'rgba(255,111,145,0.08)' },
  autoSyncRowDark: { backgroundColor: 'rgba(255,111,145,0.12)' },
  autoSyncText: { fontSize: 12, color: '#666', marginLeft: 8, fontWeight: '600' },
});
