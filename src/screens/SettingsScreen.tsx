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
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { RootStackParamList, TabParamList } from '../navigation/types';
import { useSettingsStore, useUiStore } from '../store';
import { saveSettings } from '../services/settings';
import { getWasmError, isWasmReady } from '../auth';
import { checkNetworkStatus } from '../utils/network';
import pocketApi from '../api/pocket48';
import { errorMessage } from '../utils/data';

type SettingsNavProp = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'Settings'>,
  StackNavigationProp<RootStackParamList>
>;

const SETTING_ITEMS = [
  {
    title: '主题',
    key: 'theme' as const,
    options: [
      { label: '浅色', value: 'light' },
      { label: '深色', value: 'dark' },
    ],
  },
  {
    title: '音乐播放',
    key: 'yaya_music_play_mode' as const,
    options: [
      { label: '顺序', value: 'sequential' },
      { label: '随机', value: 'random' },
      { label: '单曲循环', value: 'single' },
    ],
  },
  {
    title: '电台播放',
    key: 'yaya_audio_program_play_mode' as const,
    options: [
      { label: '顺序', value: 'sequential' },
      { label: '随机', value: 'random' },
      { label: '单集循环', value: 'single' },
    ],
  },
  {
    title: '自动签到',
    key: 'yaya_auto_checkin_enabled' as const,
    options: [
      { label: '关闭', value: false },
      { label: '开启', value: true },
    ],
  },
];

function Section({ title, children, isDark }: { title: string; children: React.ReactNode; isDark: boolean }) {
  return (
    <View style={[styles.section, isDark && styles.sectionDark]}>
      <Text style={[styles.sectionTitle, isDark && styles.textLight]}>{title}</Text>
      {children}
    </View>
  );
}

export default function SettingsScreen() {
  const navigation = useNavigation<SettingsNavProp>();
  const settings = useSettingsStore((state) => state.settings);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const showToast = useUiStore((state) => state.showToast);
  const isDark = settings.theme === 'dark';
  const [status, setStatus] = useState('');
  const [networkStatus, setNetworkStatus] = useState('');
  const [manualBackgroundUrl, setManualBackgroundUrl] = useState('');
  const [smallAccountId, setSmallAccountId] = useState('');

  const backgroundValue = settings.customBackgroundFile?.trim() || '';
  const backgroundInfo = useMemo(() => {
    if (!backgroundValue) return '未设置';
    if (backgroundValue.startsWith('data:')) return `本地图片已保存，约 ${Math.round(backgroundValue.length / 1024)}KB`;
    return backgroundValue.length > 90 ? `${backgroundValue.slice(0, 90)}...` : backgroundValue;
  }, [backgroundValue]);

  const updateSetting = async (key: string, value: any, extra: any = {}) => {
    const patch: any = { [key]: value, ...extra };
    setSettings(patch);
    await saveSettings(patch);
    showToast('设置已保存');
  };

  const handleLogout = async () => {
    setSettings({ p48Token: '' });
    await saveSettings({ p48Token: '' });
    setStatus('已退出口袋账号');
  };

  const switchAccount = async () => {
    const target = smallAccountId.trim();
    if (!target) {
      showToast('请输入要切换的小号 userId');
      return;
    }
    try {
      await pocketApi.switchBigSmall(target);
      showToast('小号切换请求已提交');
      setStatus(`已请求切换到 ${target}，如接口返回新 token 请重新检查账号状态`);
    } catch (error) {
      setStatus(`小号切换失败：${errorMessage(error)}`);
    }
  };

  const handleNetworkCheck = async () => {
    setNetworkStatus('正在检测网络...');
    try {
      const report = await checkNetworkStatus();
      setNetworkStatus(report.results.map((item) => `${item.ok ? '可访问' : '不可访问'} ${item.name}: ${item.message}`).join('\n'));
    } catch (error: any) {
      setNetworkStatus(error?.message || '联网自检失败');
    }
  };

  const pickBackgroundImage = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true, multiple: false });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      const uri = asset?.uri;
      if (!uri) {
        Alert.alert('背景图失败', '图片选择器没有返回 uri。');
        return;
      }
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const mimeType = asset?.mimeType || 'image/jpeg';
      await updateSetting('customBackgroundFile', `data:${mimeType};base64,${base64}`, { customBackgroundUpdatedAt: Date.now() });
    } catch (error: any) {
      Alert.alert('背景图选择失败', error?.message || String(error));
    }
  };

  const applyManualBackgroundUrl = () => {
    const url = manualBackgroundUrl.trim();
    if (!url) return;
    updateSetting('customBackgroundFile', url, { customBackgroundUpdatedAt: Date.now() });
  };

  const clearBackground = () => {
    updateSetting('customBackgroundFile', '', { customBackgroundUpdatedAt: Date.now() });
    setManualBackgroundUrl('');
  };

  return (
    <ScrollView style={[styles.container, isDark && styles.containerDark]} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>软件设置</Text>
        <Text style={[styles.subTitle, isDark && styles.textSubLight]}>账号、主题、下载和接口工具</Text>
      </View>

      <Section title="个人设置" isDark={isDark}>
        <Text style={[styles.stateLine, isDark && styles.textSubLight]}>口袋 Token：{settings.p48Token ? '已保存' : '未登录'}</Text>
        <Text style={[styles.stateLine, isDark && styles.textSubLight]}>B站账号：{settings.bilibiliCookie ? '已登录' : '未登录'}</Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.linkBtn} onPress={() => navigation.navigate('LoginScreen')}>
            <Text style={styles.linkText}>账号资料</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkBtn} onPress={() => navigation.navigate('RechargeScreen')}>
            <Text style={styles.linkText}>鸡腿充值</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={[styles.input, isDark && styles.inputDark]}
          placeholder="小号 userId"
          placeholderTextColor={isDark ? '#aaaaaa' : '#666666'}
          value={smallAccountId}
          onChangeText={setSmallAccountId}
          keyboardType="number-pad"
        />
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={switchAccount}>
            <Text style={styles.linkText}>切换小号</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.linkText}>退出登录</Text>
          </TouchableOpacity>
        </View>
      </Section>

      {SETTING_ITEMS.map((item) => (
        <Section key={item.key} title={item.title} isDark={isDark}>
          <View style={styles.optionRow}>
            {item.options.map((option) => (
              <TouchableOpacity
                key={String(option.value)}
                style={[styles.optionChip, isDark && styles.optionChipDark, settings[item.key] === option.value && styles.optionChipActive]}
                onPress={() => updateSetting(item.key, option.value)}
              >
                <Text style={[styles.optionText, isDark && styles.textSubLight, settings[item.key] === option.value && styles.optionTextActive]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Section>
      ))}

      <Section title="下载与背景" isDark={isDark}>
        <TouchableOpacity style={styles.linkBtn} onPress={() => navigation.navigate('DownloadScreen')}>
          <Text style={styles.linkText}>下载管理</Text>
        </TouchableOpacity>
        <Text style={[styles.backgroundInfo, isDark && styles.textSubLight]}>{backgroundInfo}</Text>
        <TextInput
          style={[styles.input, isDark && styles.inputDark]}
          placeholder="粘贴背景图 URL"
          placeholderTextColor={isDark ? '#aaaaaa' : '#666666'}
          value={manualBackgroundUrl}
          onChangeText={setManualBackgroundUrl}
          autoCapitalize="none"
        />
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={applyManualBackgroundUrl}>
            <Text style={styles.linkText}>应用 URL</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={pickBackgroundImage}>
            <Text style={styles.linkText}>本地图片</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.clearBackgroundBtn} onPress={clearBackground}>
          <Text style={styles.clearBackgroundText}>恢复默认背景</Text>
        </TouchableOpacity>
      </Section>

      <Section title="运行状态" isDark={isDark}>
        <Text style={[styles.stateLine, isDark && styles.textSubLight]}>
          签名模块：{isWasmReady() ? '已就绪' : `未就绪${getWasmError() ? `：${getWasmError()}` : ''}`}
        </Text>
        <Text style={[styles.stateLine, isDark && styles.textSubLight]}>
          自动签到：{settings.yaya_auto_checkin_enabled ? `开启，上次 ${settings.yaya_auto_checkin_last_date || '尚未执行'}` : '关闭'}
        </Text>
        <TouchableOpacity style={styles.secondaryBtn} onPress={handleNetworkCheck}>
          <Text style={styles.linkText}>联网自检</Text>
        </TouchableOpacity>
        {networkStatus ? <Text style={[styles.networkText, isDark && styles.textSubLight]}>{networkStatus}</Text> : null}
      </Section>

      <Section title="接口自检" isDark={isDark}>
        <TouchableOpacity style={styles.linkBtn} onPress={() => navigation.navigate('ApiDiagnosticsScreen')}>
          <Text style={styles.linkText}>打开接口自检</Text>
        </TouchableOpacity>
      </Section>

      {status ? <Text style={[styles.statusText, isDark && styles.textSubLight]}>{status}</Text> : null}
      <Text style={[styles.footer, isDark && styles.textSubLight]}>Yaya Message v2.2.5</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  content: { paddingBottom: 112 },
  header: { paddingTop: 54, paddingHorizontal: 20, paddingBottom: 10 },
  title: { fontSize: 22, fontWeight: '800', color: '#ff6f91' },
  subTitle: { marginTop: 4, color: '#555555', fontSize: 12 },
  section: { marginHorizontal: 12, marginVertical: 6, padding: 16, backgroundColor: 'rgba(255,255,255,0.72)', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.66)' },
  sectionDark: { backgroundColor: 'rgba(20,20,20,0.68)', borderColor: 'rgba(255,255,255,0.14)' },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#222222', marginBottom: 12 },
  stateLine: { color: '#444444', fontSize: 13, lineHeight: 22 },
  networkText: { marginTop: 10, color: '#444444', fontSize: 12, lineHeight: 18 },
  input: { minHeight: 46, padding: 12, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.78)', color: '#222222', fontSize: 13, marginTop: 10 },
  inputDark: { backgroundColor: 'rgba(255,255,255,0.10)', color: '#ffffff' },
  backgroundInfo: { color: '#444444', fontSize: 12, lineHeight: 18, marginVertical: 10 },
  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  linkBtn: { flex: 1, minHeight: 44, borderRadius: 18, backgroundColor: '#ff6f91', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  secondaryBtn: { flex: 1, minHeight: 44, borderRadius: 18, backgroundColor: '#4f4f4f', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  logoutBtn: { flex: 1, minHeight: 44, borderRadius: 18, backgroundColor: '#ff4444', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  linkText: { color: '#ffffff', fontWeight: '800', fontSize: 13 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.68)' },
  optionChipDark: { backgroundColor: 'rgba(255,255,255,0.10)' },
  optionChipActive: { backgroundColor: '#ff6f91' },
  optionText: { fontSize: 13, color: '#444444', fontWeight: '700' },
  optionTextActive: { color: '#ffffff' },
  clearBackgroundBtn: { marginTop: 10, minHeight: 42, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.42)' },
  clearBackgroundText: { color: '#ff6f91', fontWeight: '800' },
  statusText: { textAlign: 'center', color: '#444444', marginTop: 8, paddingHorizontal: 16, lineHeight: 20 },
  footer: { textAlign: 'center', color: '#555555', fontSize: 12, marginTop: 12 },
  textLight: { color: '#ffffff' },
  textSubLight: { color: '#dddddd' },
});
