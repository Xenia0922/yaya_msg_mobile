import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useNavigation } from '@react-navigation/native';
import ScreenHeader from '../components/ScreenHeader';
import { HeaderAction } from '../components/HeaderAction';
import { ScalePressable } from '../components/Motion';
import { ErrorState } from '../components/StateViews';
import { Skeleton } from '../components/Skeleton';
import { useSettingsStore, useMemberStore, useUiStore } from '../store';
import pocketApi from '../api/pocket48';
import { unwrapList } from '../utils/data';
import { loadMembers } from '../utils/members';
import { usePalette } from '../theme';
import { useI18n } from '../i18n';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

export default function DatabaseScreen() {
  const navigation = useNavigation<any>();
  const palette = usePalette();
  const { t } = useI18n();
  const setStoreMembers = useMemberStore((s) => s.setMembers);
  const storeMembers = useMemberStore((s) => s.members);
  const [webError, setWebError] = useState('');
  const [webLoading, setWebLoading] = useState(true);
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle');
  const [syncError, setSyncError] = useState('');
  const webViewRef = useRef<WebView>(null);

  const reloadWebView = useCallback(() => {
    setWebError('');
    setWebLoading(true);
    webViewRef.current?.reload();
  }, []);

  // Keep original functionality: load local + sync from API
  const syncMembers = useCallback(async () => {
    setSyncState('syncing');
    setSyncError('');
    try {
      const backup = require('../../assets/members.json');
      const localMembers = await loadMembers(backup);
      if (localMembers.length > useMemberStore.getState().members.length) {
        setStoreMembers(localMembers);
      }

      const res = await pocketApi.getGroupTeamStar();
      if (res) {
        const list = unwrapList(res, ['content.groupData', 'content.data', 'content.list', 'data', 'groupData', 'list']);
        if (list.length > 0) {
          const normalized = await loadMembers(list);
          if (normalized.length >= useMemberStore.getState().members.length) {
            setStoreMembers(normalized);
          }
        }
      }
      setSyncState('done');
    } catch (e: any) {
      setSyncState('error');
      setSyncError(e?.message || String(e));
    }
  }, [setStoreMembers]);

  useEffect(() => {
    let alive = true;
    (async () => {
      await syncMembers();
      if (!alive) return;
    })();
    return () => { alive = false; };
  }, [syncMembers]);

  const memberCount = storeMembers.length;

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('数据库')} onBack={() => navigation.goBack()} right={
        <HeaderAction label={t('刷新')} onPress={() => { reloadWebView(); syncMembers(); }} />
        } />

      {/* 顶部同步状态条：sync 图标 + 文字 + ActivityIndicator */}
      <View style={[styles.syncBar, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
        <View style={[styles.syncIcon, { backgroundColor: palette.tintSoft }]}>
          <MaterialCommunityIcons name="database-sync-outline" size={18} color={palette.tint} />
        </View>
        <View style={styles.syncInfo}>
          <Text style={[styles.syncTitle, { color: palette.label }]}>{t('成员数据库')}</Text>
          {syncState === 'syncing' ? (
            <View style={styles.syncRow}>
              <ActivityIndicator size="small" color={palette.tint} style={{ marginRight: 6 }} />
              <Text style={[styles.syncText, { color: palette.labelSecondary }]}>{t('正在同步成员库…')}</Text>
            </View>
          ) : syncState === 'error' ? (
            <ScalePressable onPress={() => syncMembers()} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} activeOpacity={0.6}>
              <Text style={[styles.syncError, { color: palette.tint }]} numberOfLines={1}>
                {t('同步失败：{msg} · 点此重试', { msg: syncError || t('网络错误') })}
              </Text>
            </ScalePressable>
          ) : (
            <Text style={[styles.syncText, { color: palette.labelSecondary }]}>
              {syncState === 'done' ? t('成员库已同步 · 当前 {count} 位成员', { count: memberCount }) : t('当前 {count} 位成员', { count: memberCount })}
            </Text>
          )}
        </View>
      </View>

      {/* WebView 容器卡：圆角 16 溢出隐藏；内嵌 Skeleton 加载占位 + 错误覆盖 */}
      <View style={[styles.webCard, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
        {webError ? (
          <ErrorState
            title={t('加载失败')}
            hint={webError}
            onAction={reloadWebView}
            style={styles.webEmpty}
          />
        ) : webLoading ? (
          <View style={styles.webSkeleton}>
            <Skeleton width="45%" height={16} />
            <Skeleton width="100%" height={14} style={{ marginTop: 14 }} />
            <Skeleton width="92%" height={14} style={{ marginTop: 8 }} />
            <Skeleton width="34%" height={14} style={{ marginTop: 8 }} />
            <Skeleton width="100%" height={14} style={{ marginTop: 22 }} />
            <Skeleton width="78%" height={14} style={{ marginTop: 8 }} />
            <Skeleton width="55%" height={14} style={{ marginTop: 8 }} />
            <Skeleton width="88%" height={14} style={{ marginTop: 8 }} />
            <Skeleton width="100%" height={14} style={{ marginTop: 22 }} />
            <Skeleton width="66%" height={14} style={{ marginTop: 8 }} />
            <Skeleton width="40%" height={14} style={{ marginTop: 8 }} />
          </View>
        ) : null}
        <WebView
          ref={webViewRef}
          source={{ uri: 'https://gnz.hk/database' }}
          style={styles.webview}
          onLoadStart={() => { setWebError(''); setWebLoading(true); }}
          onLoadEnd={() => setWebLoading(false)}
          onError={(e) => { setWebLoading(false); setWebError(e.nativeEvent.description || t('加载失败')); }}
          javaScriptEnabled
          domStorageEnabled
          cacheEnabled
          cacheMode="LOAD_CACHE_ELSE_NETWORK"
          thirdPartyCookiesEnabled={false}
          incognito={false}
          allowsInlineMediaPlayback={false}
          mediaPlaybackRequiresUserAction={true}
          androidLayerType="hardware"
          textZoom={100}
          mixedContentMode="always"
          allowFileAccess={false}
          geolocationEnabled={false}
          setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false}
          renderLoading={() => <View />}
          startInLoadingState
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  syncBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    padding: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  syncIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncInfo: { flex: 1, marginLeft: 12, minWidth: 0 },
  syncTitle: { fontSize: 15, fontWeight: '700' },
  syncRow: { flexDirection: 'row', alignItems: 'center', marginTop: 5, minHeight: 16 },
  syncText: { fontSize: 12, marginTop: 3 },
  syncError: { fontSize: 12, fontWeight: '700', marginTop: 3 },
  webCard: {
    flex: 1,
    margin: 16,
    marginTop: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  webview: { flex: 1 },
  webSkeleton: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    padding: 20,
    zIndex: 2,
  },
  webEmpty: { paddingVertical: 60 },
});
