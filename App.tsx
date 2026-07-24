import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, ImageBackground, Modal, Image, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './src/navigation';
import { loadSettings } from './src/services/settings';
import { useSettingsStore, useMemberStore, useAnnouncementStore } from './src/store';
import { loadMembers } from './src/utils/members';
import { fetchJson } from './src/utils/network';
import { loadCachedMemberData } from './src/services/memberData';
import { initWasm, WebViewSigner } from './src/auth';
import { FadeInView } from './src/components/Motion';
import { runAutoCheckinIfNeeded } from './src/services/autoCheckin';
import { NOTICE_URL } from './src/constants';
import { initRuntimeLog, logCrash } from './src/utils/runtimeLog';

// 全局 JS 闪退捕获：生产环境红盒不可见，写入本地日志便于排查。
// 同时保留原有 handler（开发环境红盒 / 默认崩溃行为）。
function installGlobalErrorHandler() {
  const g = global as unknown as { ErrorUtils?: { setGlobalHandler?: (h: (e: unknown, isFatal?: boolean) => void) => void; getGlobalHandler?: () => ((e: unknown, isFatal?: boolean) => void) | undefined } };
  const eu = g.ErrorUtils;
  if (!eu || typeof eu.setGlobalHandler !== 'function') return;
  const prev = eu.getGlobalHandler ? eu.getGlobalHandler() : undefined;
  eu.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    logCrash(error, isFatal ? 'global:fatal' : 'global');
    if (prev) {
      try {
        prev(error, isFatal);
      } catch {
        /* ignore */
      }
    }
  });
}

installGlobalErrorHandler();
initRuntimeLog().catch(() => {});

export default function App() {
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('正在初始化...');
  const appTheme = useSettingsStore((state) => state.settings.theme);
  const customBackgroundFile = useSettingsStore((state) => state.settings.customBackgroundFile);
  const customBackgroundUpdatedAt = useSettingsStore((state) => state.settings.customBackgroundUpdatedAt);
  const [backgroundLoadError, setBackgroundLoadError] = useState('');
  const splashBg = appTheme === 'dark' ? '#1c1c1e' : '#fff7fb';

  // v2.6: Announcement modal
  const { seenIds, markSeen, lastFetched, hydrated } = useAnnouncementStore();
  const [announceModal, setAnnounceModal] = useState<{ title: string; header: string; content: string; imageUrl: string; link: string } | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    let mounted = true;
    (async () => {
      try {
        const notice = await fetchJson<any>(`${NOTICE_URL}?t=${Date.now()}`);
        if (!mounted || !notice?.show) return;
        const id = String(notice.id || notice.noticeId || notice.version || '');
        if (!id || seenIds.includes(id)) return;
        markSeen(id);
        setAnnounceModal({
          title: notice.title || '',
          header: notice.header || '公告',
          content: (notice.fullContent || '').replace(/\\n/g, '\n'),
          imageUrl: notice.imageUrl || '',
          link: notice.link || '',
        });
      } catch {}
    })();
    return () => { mounted = false; };
  }, [hydrated]);

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

        // Prefer a previously downloaded update if it is at least as complete.
        const cached = await loadCachedMemberData();
        if (cached && cached.length >= localMembers.length) {
          useMemberStore.getState().setMembers(cached);
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
    // 原生开屏已展示 app 图标（与开屏同色纯背景，避免黑屏闪烁）；不再叠加 JS 加载 UI
    return <View style={{ flex: 1, backgroundColor: splashBg }} />;
  }

  const backgroundUri = customBackgroundFile?.trim();
  const backgroundSource = backgroundUri
    ? { uri: backgroundUri.match(/^[a-z][a-z0-9+.-]*:/i) ? backgroundUri : `file://${backgroundUri}` }
    : null;

  const content = (
    <View style={{ flex: 1, backgroundColor: backgroundSource ? 'transparent' : (appTheme === 'dark' ? '#1c1c1e' : '#fff7fb') }}>
      <StatusBar style={appTheme === 'dark' ? 'light' : 'dark'} />
      {backgroundLoadError ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 10, right: 10, top: 36, zIndex: 9999, padding: 8, borderRadius: 8, backgroundColor: 'rgba(180,0,0,0.82)' }}>
          <Text style={{ color: '#fff', fontSize: 11 }} numberOfLines={2}>{backgroundLoadError}</Text>
        </View>
      ) : null}
      <AppNavigator />
      <WebViewSigner />
      {/* v2.6: Global announcement modal */}
      <Modal visible={!!announceModal} transparent animationType="fade" onRequestClose={() => setAnnounceModal(null)}>
        <View style={anStyles.overlay}>
          <View style={[anStyles.card, appTheme === 'dark' && { backgroundColor: '#1e1e1e' }]}>
            {announceModal?.header ? (
              <Text style={[anStyles.header, { color: '#ff6f91' }]}>{announceModal.header}</Text>
            ) : null}
            {announceModal?.title ? (
              <Text style={[anStyles.title, appTheme === 'dark' && { color: '#eee' }]}>{announceModal.title}</Text>
            ) : null}
            {announceModal?.imageUrl ? (
              <Image source={{ uri: announceModal.imageUrl }} style={anStyles.image} resizeMode="contain" />
            ) : null}
            {announceModal?.content ? (
              <Text style={[anStyles.content, appTheme === 'dark' && { color: '#ccc' }]}>{announceModal.content}</Text>
            ) : null}
            <View style={anStyles.btnRow}>
              {announceModal?.link ? (
                <TouchableOpacity style={[anStyles.btn, { backgroundColor: '#ff6f91' }]} onPress={() => { if (announceModal?.link) Linking.openURL(announceModal.link); }}>
                  <Text style={anStyles.btnText}>查看详情</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={[anStyles.btn, { backgroundColor: 'rgba(128,128,128,0.2)' }]} onPress={() => setAnnounceModal(null)}>
                <Text style={[anStyles.btnText, appTheme === 'dark' && { color: '#eee' }]}>关闭</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: appTheme === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.42)' }} />
      {content}
    </ImageBackground>
  ) : content;
}

// v2.6: Announcement modal styles
const anStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 20, maxWidth: 400, width: '100%', maxHeight: '80%' },
  header: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  title: { fontSize: 15, fontWeight: '600', marginBottom: 10, color: '#333' },
  image: { width: '100%', height: 160, borderRadius: 10, marginBottom: 10 },
  content: { fontSize: 14, lineHeight: 22, color: '#555', marginBottom: 16 },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  btn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
