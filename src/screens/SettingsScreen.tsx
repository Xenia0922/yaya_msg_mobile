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
import { useSettingsStore } from '../store';
import { saveSettings } from '../services/settings';
import { getWasmError, isWasmReady } from '../auth';
import { checkNetworkStatus } from '../utils/network';

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
    title: '消息排序',
    key: 'msg_sort_order' as const,
    options: [
      { label: '最新在前', value: 'desc' },
      { label: '最早在前', value: 'asc' },
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
    title: '自动签到',
    key: 'yaya_auto_checkin_enabled' as const,
    options: [
      { label: '关闭', value: false },
      { label: '开启', value: true },
    ],
  },
];

function imageSourceFromSetting(value: string) {
  const uri = value?.trim();
  if (!uri) return null;
  return { uri: uri.match(/^[a-z][a-z0-9+.-]*:/i) ? uri : `file://${uri}` };
}

function GlassCard({ children, isDark }: { children: React.ReactNode; isDark: boolean }) {
  return (
    <View style={[styles.section, isDark && styles.sectionDark]}>
      {children}
    </View>
  );
}

export default function SettingsScreen() {
  const navigation = useNavigation<SettingsNavProp>();
  const settings = useSettingsStore((state) => state.settings);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const isDark = settings.theme === 'dark';
  const [status, setStatus] = useState('');
  const [networkStatus, setNetworkStatus] = useState('');
  const [manualBackgroundUrl, setManualBackgroundUrl] = useState('');

  const backgroundValue = settings.customBackgroundFile?.trim() || '';
  const backgroundInfo = useMemo(() => {
    if (!backgroundValue) return '未设置';
    if (backgroundValue.startsWith('data:')) {
      return `本地图片已保存，约 ${Math.round(backgroundValue.length / 1024)}KB`;
    }
    if (backgroundValue.length > 90) return `${backgroundValue.slice(0, 90)}...`;
    return backgroundValue;
  }, [backgroundValue]);

  const updateSetting = async (key: string, value: any, extra: any = {}) => {
    const patch: any = { [key]: value, ...extra };
    setSettings(patch);
    await saveSettings(patch);
    setStatus('设置已保存');
  };

  const handleLogout = async () => {
    setSettings({ p48Token: '' });
    await saveSettings({ p48Token: '' });
    setStatus('已退出口袋账号');
  };

  const handleNetworkCheck = async () => {
    setNetworkStatus('正在检测网络...');
    try {
      const report = await checkNetworkStatus();
      const lines = report.results.map((item) => `${item.ok ? '可访问' : '不可访问'} ${item.name}: ${item.message}`);
      setNetworkStatus(lines.join('\n'));
    } catch (error: any) {
      setNetworkStatus(error?.message || '联网自检失败');
    }
  };

  const pickBackgroundImage = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'image/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;

      const asset = result.assets?.[0];
      const uri = asset?.uri;
      if (!uri) {
        Alert.alert('背景图失败', '图片选择器没有返回 uri。');
        return;
      }

      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (!base64) {
        Alert.alert('背景图失败', '选中了图片，但读取到的数据为空。');
        return;
      }

      const mimeType = asset?.mimeType || 'image/jpeg';
      const dataUri = `data:${mimeType};base64,${base64}`;
      const stamp = Date.now();
      await updateSetting('customBackgroundFile', dataUri, { customBackgroundUpdatedAt: stamp });
      setStatus(`背景图已应用，约 ${Math.round(dataUri.length / 1024)}KB`);
    } catch (error: any) {
      const message = error?.message || String(error);
      Alert.alert('背景图选择失败', message);
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
      <View style={[styles.header, isDark && styles.headerDark]}>
        <Text style={[styles.title, isDark && styles.textDark]}>软件设置</Text>
      </View>

      <GlassCard isDark={isDark}>
        <Text style={[styles.sectionTitle, isDark && styles.textDark]}>运行状态</Text>
        <Text style={[styles.stateLine, isDark && styles.textSubDark]}>口袋 Token：{settings.p48Token ? '已保存' : '未登录'}</Text>
        <Text style={[styles.stateLine, isDark && styles.textSubDark]}>B站账号：{settings.bilibiliCookie ? '已登录' : '未登录'}</Text>
        <Text style={[styles.stateLine, isDark && styles.textSubDark]}>
          签名模块：{isWasmReady() ? '已就绪' : `未就绪${getWasmError() ? `（${getWasmError()}）` : ''}`}
        </Text>
        <Text style={[styles.stateLine, isDark && styles.textSubDark]}>
          自动签到：{settings.yaya_auto_checkin_enabled ? `开启 · 上次 ${settings.yaya_auto_checkin_last_date || '尚未执行'}` : '关闭'}
        </Text>
        <TouchableOpacity style={styles.linkBtn} onPress={handleNetworkCheck}>
          <Text style={styles.linkText}>联网自检</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkBtn} onPress={() => navigation.navigate('ApiDiagnosticsScreen')}>
          <Text style={styles.linkText}>接口自检</Text>
        </TouchableOpacity>
        {networkStatus ? <Text style={[styles.networkText, isDark && styles.textSubDark]}>{networkStatus}</Text> : null}
      </GlassCard>

      {SETTING_ITEMS.map((item) => (
        <GlassCard key={item.key} isDark={isDark}>
          <Text style={[styles.sectionTitle, isDark && styles.textDark]}>{item.title}</Text>
          <View style={styles.optionRow}>
            {item.options.map((option) => (
              <TouchableOpacity
                key={String(option.value)}
                style={[styles.optionChip, settings[item.key] === option.value && styles.optionChipActive]}
                onPress={() => updateSetting(item.key, option.value)}
              >
                <Text style={[styles.optionText, settings[item.key] === option.value && styles.optionTextActive]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </GlassCard>
      ))}

      <GlassCard isDark={isDark}>
        <Text style={[styles.sectionTitle, isDark && styles.textDark]}>全局背景图</Text>
        <Text style={[styles.backgroundInfo, isDark && styles.textSubDark]}>{backgroundInfo}</Text>
        <TextInput
          style={[styles.input, isDark && styles.inputDark]}
          placeholder="也可以粘贴图片 URL"
          placeholderTextColor="#5a5a5a"
          value={manualBackgroundUrl}
          onChangeText={setManualBackgroundUrl}
          autoCapitalize="none"
        />
        <TouchableOpacity style={styles.linkBtn} onPress={applyManualBackgroundUrl}>
          <Text style={styles.linkText}>应用图片 URL</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkBtn} onPress={pickBackgroundImage}>
          <Text style={styles.linkText}>选择本地图片作为全局背景</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkBtn} onPress={clearBackground}>
          <Text style={styles.linkText}>恢复默认背景</Text>
        </TouchableOpacity>
      </GlassCard>

      <GlassCard isDark={isDark}>
        <Text style={[styles.sectionTitle, isDark && styles.textDark]}>账号</Text>
        <TouchableOpacity style={styles.linkBtn} onPress={() => navigation.navigate('LoginScreen')}>
          <Text style={styles.linkText}>账号设置</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkBtn} onPress={() => navigation.navigate('RechargeScreen')}>
          <Text style={styles.linkText}>鸡腿充值</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>退出口袋登录</Text>
        </TouchableOpacity>
      </GlassCard>

      {status ? <Text style={[styles.statusText, isDark && styles.textSubDark]}>{status}</Text> : null}
      <Text style={[styles.footer, isDark && styles.textSubDark]}>Yaya Message v2.2.4 · profile rank album fix</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  content: { paddingBottom: 96 },
  header: { paddingTop: 54, paddingHorizontal: 20, paddingBottom: 14, marginBottom: 4 },
  headerDark: {},
  title: { fontSize: 22, fontWeight: '800', color: '#ff6f91' },
  section: { margin: 12, padding: 16, backgroundColor: 'rgba(255,255,255,0.46)', borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.48)' },
  sectionDark: { backgroundColor: 'rgba(20,20,20,0.58)', borderColor: 'rgba(255,255,255,0.12)' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#333', marginBottom: 12 },
  stateLine: { color: '#444', fontSize: 13, lineHeight: 22 },
  networkText: { marginTop: 10, color: '#444', fontSize: 12, lineHeight: 18 },
  input: { minHeight: 46, padding: 12, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.36)', backgroundColor: 'rgba(255,255,255,0.38)', color: '#333', fontSize: 13 },
  inputDark: { backgroundColor: 'rgba(42,42,42,0.52)', borderColor: 'rgba(255,255,255,0.12)', color: '#ddd' },
  backgroundInfo: { color: '#444', fontSize: 12, lineHeight: 18, marginBottom: 10 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.38)' },
  optionChipActive: { backgroundColor: '#ff6f91' },
  optionText: { fontSize: 13, color: '#444' },
  optionTextActive: { color: '#fff', fontWeight: '700' },
  logoutBtn: { padding: 12, borderRadius: 18, backgroundColor: '#ff4444', alignItems: 'center', marginTop: 10 },
  logoutText: { color: '#fff', fontWeight: '700' },
  linkBtn: { padding: 12, borderRadius: 18, backgroundColor: '#ff6f91', alignItems: 'center', marginTop: 10 },
  linkText: { color: '#fff', fontWeight: '700' },
  statusText: { textAlign: 'center', color: '#444', marginTop: 8 },
  footer: { textAlign: 'center', color: '#333333', fontSize: 12, marginTop: 12 },
  textDark: { color: '#eee' },
  textSubDark: { color: '#eeeeee' },
});
