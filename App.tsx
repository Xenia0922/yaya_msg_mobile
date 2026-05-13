import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, ImageBackground } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './src/navigation';
import { loadSettings } from './src/services/settings';
import { useSettingsStore, useMemberStore } from './src/store';
import { loadMembers } from './src/utils/members';
import { fetchJsonStrict } from './src/utils/network';
import { initWasm, WebViewSigner } from './src/auth';
import { FadeInView, ScalePressable } from './src/components/Motion';
import { runAutoCheckinIfNeeded } from './src/services/autoCheckin';

export default function App() {
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('正在初始化...');
  const appTheme = useSettingsStore((state) => state.settings.theme);
  const customBackgroundFile = useSettingsStore((state) => state.settings.customBackgroundFile);
  const customBackgroundUpdatedAt = useSettingsStore((state) => state.settings.customBackgroundUpdatedAt);
  const [backgroundLoadError, setBackgroundLoadError] = useState('');
  const splashBg = appTheme === 'dark' ? '#111111' : '#fff7fb';
  const splashText = appTheme === 'dark' ? '#eeeeee' : '#555555';

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const settings = await loadSettings();
        useSettingsStore.getState().setSettings(settings);
      } catch (error: any) {
        if (mounted) setMessage(`设置加载失败：${error?.message || String(error)}`);
      }

      initWasm().catch((error: any) => {
        if (!mounted) return;
        setMessage((prev) => `${prev}\n签名模块初始化失败：${error?.message || String(error)}`);
      });

      try {
        const backup = require('./assets/members.json');
        const localMembers = await loadMembers(backup);
        useMemberStore.getState().setMembers(localMembers);
        if (mounted) setMessage(`已加载随包成员库 ${localMembers.length} 位`);

        try {
          const json = await fetchJsonStrict<any[]>('https://yaya-data.pages.dev/members.json');
          const remoteMembers = await loadMembers(json);
          if (remoteMembers.length >= localMembers.length) {
            useMemberStore.getState().setMembers(remoteMembers);
            if (mounted) setMessage(`联网成功，已同步成员库 ${remoteMembers.length} 位`);
          } else if (mounted) {
            setMessage(`线上成员库较旧，继续使用随包成员库 ${localMembers.length} 位`);
          }
        } catch (error: any) {
          if (mounted) setMessage(`联网成员库不可用，继续使用随包成员库 ${localMembers.length} 位：${error?.message || String(error)}`);
        }
      } catch (error: any) {
        if (mounted) setMessage(`成员数据加载失败：${error?.message || String(error)}`);
      }

      if (mounted) setReady(true);
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      runAutoCheckinIfNeeded().catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, [ready]);

  if (!ready) {
    return (
      <FadeInView style={{ flex: 1, backgroundColor: splashBg, alignItems: 'center', justifyContent: 'center', padding: 24 }} distance={8} duration={220}>
        <Text style={{ color: '#ff6f91', fontSize: 28, fontWeight: 'bold', marginBottom: 16 }}>牙牙消息</Text>
        <ActivityIndicator color="#ff6f91" size="large" />
        <Text style={{ color: splashText, marginTop: 12, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>{message}</Text>
        <ScalePressable style={{ marginTop: 20, padding: 16 }} onPress={() => setReady(true)}>
          <Text style={{ color: '#ff6f91', fontSize: 14, fontWeight: '600' }}>跳过等待，进入应用</Text>
        </ScalePressable>
        <WebViewSigner />
      </FadeInView>
    );
  }

  const backgroundUri = customBackgroundFile?.trim();
  const backgroundSource = backgroundUri
    ? { uri: backgroundUri.match(/^[a-z][a-z0-9+.-]*:/i) ? backgroundUri : `file://${backgroundUri}` }
    : null;

  const content = (
    <View style={{ flex: 1, backgroundColor: backgroundSource ? 'transparent' : (appTheme === 'dark' ? '#111111' : '#fff7fb') }}>
      <StatusBar style={appTheme === 'dark' ? 'light' : 'dark'} />
      {backgroundLoadError ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 10, right: 10, top: 36, zIndex: 9999, padding: 8, borderRadius: 8, backgroundColor: 'rgba(180,0,0,0.82)' }}>
          <Text style={{ color: '#fff', fontSize: 11 }} numberOfLines={2}>{backgroundLoadError}</Text>
        </View>
      ) : null}
      <AppNavigator />
      <WebViewSigner />
    </View>
  );

  return backgroundSource ? (
    <ImageBackground
      key={`${backgroundSource.uri}-${customBackgroundUpdatedAt || 0}`}
      source={backgroundSource}
      style={{ flex: 1, backgroundColor: appTheme === 'dark' ? '#111111' : '#fff7fb' }}
      resizeMode="cover"
      onLoad={() => setBackgroundLoadError('')}
      onError={(event) => setBackgroundLoadError(`背景图加载失败：${backgroundSource.uri} ${event.nativeEvent?.error || ''}`)}
    >
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: appTheme === 'dark' ? 'rgba(0,0,0,0.24)' : 'rgba(255,255,255,0.08)' }} />
      {content}
    </ImageBackground>
  ) : content;
}
