import React, { useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { StackNavigationProp } from '@react-navigation/stack';
import * as ImagePicker from 'expo-image-picker';
import { RootStackParamList, TabParamList } from '../navigation/types';
import { useSettingsStore, useUiStore } from '../store';
import { saveSettings } from '../services/settings';
import { getWasmError, isWasmReady } from '../auth';
import { checkNetworkStatus } from '../utils/network';

type SettingsNavProp = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'Settings'>,
  StackNavigationProp<RootStackParamList>
>;

const THEME_OPTIONS = [
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
];

const MUSIC_MODES = [
  { label: '顺序', value: 'sequential' },
  { label: '随机', value: 'random' },
  { label: '单曲循环', value: 'single' },
];

const AUDIO_MODES = [
  { label: '顺序', value: 'sequential' },
  { label: '随机', value: 'random' },
  { label: '单集循环', value: 'single' },
];

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

export default function SettingsScreen() {
  const navigation = useNavigation<SettingsNavProp>();
  const settings = useSettingsStore((state) => state.settings);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const showToast = useUiStore((state) => state.showToast);
  const isDark = settings.theme === 'dark';
  const [networkStatus, setNetworkStatus] = useState('');
  const [manualBgUrl, setManualBgUrl] = useState('');
  const [bgStatus, setBgStatus] = useState('');

  const backgroundValue = settings.customBackgroundFile?.trim() || '';
  const backgroundInfo = useMemo(() => {
    if (!backgroundValue) return '未设置';
    if (backgroundValue.startsWith('data:')) return `本地图片已保存，约 ${Math.round(backgroundValue.length / 1024)}KB`;
    return backgroundValue.length > 60 ? `${backgroundValue.slice(0, 60)}...` : backgroundValue;
  }, [backgroundValue]);

  const update = async (key: string, value: any, extra: any = {}) => {
    const patch = { [key]: value, ...extra };
    setSettings(patch);
    await saveSettings(patch);
    showToast('设置已保存');
  };

  const handleNetworkCheck = async () => {
    setNetworkStatus('检测中...');
    try {
      const report = await checkNetworkStatus();
      setNetworkStatus(report.results.map((item) => `${item.ok ? '✓' : '✗'} ${item.name}: ${item.message}`).join('\n'));
    } catch (error: any) {
      setNetworkStatus(error?.message || '联网自检失败');
    }
  };

  const pickBg = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('需要相册权限'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, base64: true } as any);
      if (result.canceled) return;
      const base64 = result.assets?.[0]?.base64;
      if (!base64) { Alert.alert('未获取到图片数据'); return; }
      const mime = result.assets?.[0]?.mimeType || 'image/jpeg';
      await update('customBackgroundFile', `data:${mime};base64,${base64}`, { customBackgroundUpdatedAt: Date.now() });
    } catch (error: any) {
      Alert.alert('背景图失败', error?.message || String(error));
    }
  };

  const applyBgUrl = () => {
    const url = manualBgUrl.trim();
    if (!url) return;
    update('customBackgroundFile', url, { customBackgroundUpdatedAt: Date.now() });
  };

  return (
    <ScrollView style={[styles.container, isDark && styles.containerDark]} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.pageTitle}>设置</Text>
      </View>

      <Section title="账号" isDark={isDark}>
        <Text style={[styles.sub, isDark && styles.textSubLight]}>口袋登录、大小号切换、B站登录、修改昵称和头像</Text>
        <TouchableOpacity style={styles.linkBtn} onPress={() => navigation.navigate('LoginScreen')}>
          <Text style={styles.linkText}>进入账号管理</Text>
        </TouchableOpacity>
      </Section>

      <Section title="外观" isDark={isDark}>
        <ChipRow options={THEME_OPTIONS} value={settings.theme} isDark={isDark} onChange={(v) => update('theme', v)} />
        <View style={styles.divider} />
        <Text style={[styles.sub, isDark && styles.textSubLight]}>背景图：{backgroundInfo}</Text>
        <TextInput
          style={[styles.input, isDark && styles.inputDark]}
          placeholder="粘贴背景图 URL"
          placeholderTextColor={isDark ? '#aaa' : '#666'}
          value={manualBgUrl}
          onChangeText={setManualBgUrl}
          autoCapitalize="none"
        />
        <View style={styles.chipRow}>
          <TouchableOpacity style={styles.linkBtn} onPress={applyBgUrl}>
            <Text style={styles.linkText}>应用 URL</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.subBtn} onPress={pickBg}>
            <Text style={styles.subBtnText}>本地图片</Text>
          </TouchableOpacity>
        </View>
        {backgroundValue ? (
          <TouchableOpacity style={styles.clearBtn} onPress={() => { update('customBackgroundFile', '', { customBackgroundUpdatedAt: Date.now() }); setManualBgUrl(''); }}>
            <Text style={styles.clearText}>恢复默认背景</Text>
          </TouchableOpacity>
        ) : null}
      </Section>

      <Section title="音乐播放" isDark={isDark}>
        <ChipRow options={MUSIC_MODES} value={settings.yaya_music_play_mode} isDark={isDark} onChange={(v) => update('yaya_music_play_mode', v)} />
      </Section>

      <Section title="电台播放" isDark={isDark}>
        <ChipRow options={AUDIO_MODES} value={settings.yaya_audio_program_play_mode} isDark={isDark} onChange={(v) => update('yaya_audio_program_play_mode', v)} />
      </Section>

      <Section title="自动签到" isDark={isDark}>
        <ChipRow options={[{ label: '关闭', value: false as any }, { label: '开启', value: true as any }]} value={settings.yaya_auto_checkin_enabled} isDark={isDark} onChange={(v) => update('yaya_auto_checkin_enabled', v)} />
        {settings.yaya_auto_checkin_enabled ? (
          <Text style={[styles.sub, isDark && styles.textSubLight]}>
            上次签到：{settings.yaya_auto_checkin_last_date || '尚未执行'}
          </Text>
        ) : null}
      </Section>

      <Section title="工具" isDark={isDark}>
        <View style={styles.chipRow}>
          <TouchableOpacity style={styles.linkBtn} onPress={() => navigation.navigate('DownloadScreen')}>
            <Text style={styles.linkText}>下载管理</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkBtn} onPress={() => navigation.navigate('ApiDiagnosticsScreen')}>
            <Text style={styles.linkText}>接口自检</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.subBtn} onPress={handleNetworkCheck}>
          <Text style={styles.subBtnText}>联网自检</Text>
        </TouchableOpacity>
        {networkStatus ? <Text style={[styles.networkText, isDark && styles.textSubLight]}>{networkStatus}</Text> : null}
      </Section>

      <Section title="运行状态" isDark={isDark}>
        <Text style={[styles.sub, isDark && styles.textSubLight]}>
          签名模块：{isWasmReady() ? '已就绪' : '未就绪'}
        </Text>
        <Text style={[styles.sub, isDark && styles.textSubLight]}>
          成员库：{useSettingsStore.getState().settings.p48Token ? '已加载' : '待加载'}
        </Text>
      </Section>

      <Text style={[styles.footer, isDark && styles.textSubLight]}>Yaya Message v2.2.8</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  content: { paddingBottom: 112 },
  header: { paddingTop: 54, paddingHorizontal: 20, paddingBottom: 8 },
  pageTitle: { fontSize: 22, fontWeight: '800', color: '#ff6f91' },
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
  input: { minHeight: 42, padding: 10, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.04)', color: '#222', fontSize: 13, marginTop: 6 },
  inputDark: { backgroundColor: 'rgba(255,255,255,0.06)', color: '#fff' },
  linkBtn: { flex: 1, minHeight: 40, borderRadius: 14, backgroundColor: '#ff6f91', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  linkText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  subBtn: { minHeight: 40, borderRadius: 14, backgroundColor: '#4f4f4f', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, marginTop: 8 },
  subBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  clearBtn: { marginTop: 8, minHeight: 36, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,0,0,0.08)' },
  clearText: { color: '#e74c3c', fontWeight: '800', fontSize: 12 },
  networkText: { marginTop: 8, fontSize: 11, color: '#555', lineHeight: 16 },
  footer: { textAlign: 'center', color: '#999', fontSize: 12, marginTop: 16 },
  textLight: { color: '#fff' },
  textSubLight: { color: '#ddd' },
});
