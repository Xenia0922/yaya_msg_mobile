import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useNavigation } from '@react-navigation/native';
import ScreenHeader from '../components/ScreenHeader';
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
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle');
  const [syncError, setSyncError] = useState('');
  const webViewRef = useRef<WebView>(null);

  const reloadWebView = useCallback(() => {
    setWebError('');
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
        <TouchableOpacity onPress={() => { reloadWebView(); syncMembers(); }}>
          <Text style={[styles.headerAction, { color: palette.tint }]}>{t('刷新')}</Text>
        </TouchableOpacity>
        } />

      <View
        style={[
          styles.summaryRow,
          {
            backgroundColor: palette.surface,
            borderColor: palette.hairline,
          },
        ]}
      >
        <View style={[styles.summaryIcon, { backgroundColor: palette.tintSoft }]}>
          <MaterialCommunityIcons name="database-outline" size={20} color={palette.tint} />
        </View>
        <View style={styles.summaryInfo}>
          <Text style={[styles.summaryTitle, { color: palette.label }]}>{t('成员数据库')}</Text>
          <Text style={[styles.summarySub, { color: palette.labelSecondary }]}>
            {t('当前 {count} 位成员', { count: memberCount })}
          </Text>
          <View style={styles.syncRow}>
            {syncState === 'syncing' ? (
              <>
                <ActivityIndicator size="small" color={palette.tint} style={{ marginRight: 6 }} />
                <Text style={[styles.syncText, { color: palette.labelSecondary }]}>{t('正在同步成员库…')}</Text>
              </>
            ) : syncState === 'done' ? (
              <Text style={[styles.syncText, { color: palette.labelTertiary }]}>{t('成员库已同步')}</Text>
            ) : syncState === 'error' ? (
              <TouchableOpacity onPress={() => syncMembers()} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Text style={[styles.syncError, { color: palette.tint }]} numberOfLines={1}>
                  {t('同步失败：{msg} · 点此重试', { msg: syncError || t('网络错误') })}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={palette.labelTertiary} />
      </View>

      {webError ? (
        <View style={styles.errorWrap}>
          <Text style={[styles.errorText, { color: palette.tint }]}>{webError}</Text>
          <TouchableOpacity style={[styles.webRetryBtn, { backgroundColor: palette.tint }]} onPress={reloadWebView}>
            <Text style={styles.webRetryText}>{t('重试')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <WebView
        ref={webViewRef}
        source={{ uri: 'https://gnz.hk/database' }}
        style={styles.webview}
        onError={(e) => setWebError(e.nativeEvent.description || t('加载失败'))}
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  headerAction: { color: '#ff6f91', fontSize: 14, fontWeight: '800' },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  summaryIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryInfo: { flex: 1, marginLeft: 12, minWidth: 0 },
  summaryTitle: { fontSize: 15, fontWeight: '700' },
  summarySub: { fontSize: 12, marginTop: 3 },
  syncRow: { flexDirection: 'row', alignItems: 'center', marginTop: 5, minHeight: 16 },
  syncText: { fontSize: 11 },
  syncError: { fontSize: 11, fontWeight: '700' },
  webview: { flex: 1 },
  errorWrap: { padding: 30, alignItems: 'center' },
  errorText: { color: '#ff6f91', fontSize: 14, textAlign: 'center' },
  webRetryBtn: {
    marginTop: 14,
    paddingHorizontal: 22,
    paddingVertical: 8,
    borderRadius: 16,
  },
  webRetryText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
