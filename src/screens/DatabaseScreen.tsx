import React, { useEffect, useState } from 'react';
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
import { useSettingsStore, useMemberStore } from '../store';
import pocketApi from '../api/pocket48';
import { unwrapList } from '../utils/data';
import { loadMembers } from '../utils/members';

export default function DatabaseScreen() {
  const navigation = useNavigation<any>();
  const isDark = useSettingsStore((s) => s.settings.theme === 'dark');
  const setStoreMembers = useMemberStore((s) => s.setMembers);
  const storeMembers = useMemberStore((s) => s.members);
  const [webLoading, setWebLoading] = useState(true);
  const [webError, setWebError] = useState('');
  const [status, setStatus] = useState('');

  // Keep original functionality: load local + sync from API
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const backup = require('../../assets/members.json');
        const localMembers = await loadMembers(backup);
        if (!alive) return;
        if (localMembers.length > storeMembers.length) {
          setStoreMembers(localMembers);
          setStatus(`已加载随包成员库：${localMembers.length} 位`);
        }

        const res = await pocketApi.getGroupTeamStar();
        if (!alive) return;
        if (res) {
          const list = unwrapList(res, ['content.groupData', 'content.data', 'content.list', 'data', 'groupData', 'list']);
          if (list.length > 0) {
            const normalized = await loadMembers(list);
            if (normalized.length >= localMembers.length) {
              setStoreMembers(normalized);
              setStatus(`已同步官方成员库：${normalized.length} 位`);
            } else {
              setStatus(`官方数据较少，保留随包 ${localMembers.length} 位`);
            }
          }
        }
      } catch (e: any) {
        if (!alive) return;
        setStatus(`同步失败：${e?.message || String(e)}`);
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScreenHeader title="数据库" onBack={() => navigation.goBack()} right={
        <TouchableOpacity onPress={() => setWebLoading(true)}>
          <Text style={styles.headerAction}>刷新</Text>
        </TouchableOpacity>
      } />
      {status ? (
        <Text style={[styles.status, isDark && styles.statusDark]}>{status}</Text>
      ) : null}
      {webLoading && (
        <ActivityIndicator color="#ff6f91" size="large" style={styles.loader} />
      )}
      {webError ? (
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{webError}</Text>
        </View>
      ) : null}
      <WebView
        source={{ uri: 'https://gnz.hk/database' }}
        style={styles.webview}
        onLoadEnd={() => setWebLoading(false)}
        onError={(e) => setWebError(e.nativeEvent.description || '加载失败')}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  headerAction: { color: '#ff6f91', fontSize: 14, fontWeight: '800' },
  status: { paddingHorizontal: 14, paddingVertical: 6, fontSize: 12, color: '#555', textAlign: 'center' },
  statusDark: { color: '#aaa' },
  loader: { position: 'absolute', top: '50%', left: '50%', marginLeft: -20, marginTop: -20, zIndex: 10 },
  webview: { flex: 1 },
  errorWrap: { padding: 40, alignItems: 'center' },
  errorText: { color: '#ff6f91', fontSize: 14 },
});
