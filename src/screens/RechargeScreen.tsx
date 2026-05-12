import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useNavigation } from '@react-navigation/native';
import pocketApi from '../api/pocket48';
import { useSettingsStore } from '../store';
import { FadeInView } from '../components/Motion';
import { errorMessage } from '../utils/data';

const RECHARGE_URL = 'https://live.48.cn/Recharge/';

export default function RechargeScreen() {
  const navigation = useNavigation();
  const isDark = useSettingsStore((state) => state.settings.theme === 'dark');
  const [balance, setBalance] = useState('');
  const [status, setStatus] = useState('暂无数据');
  const [loading, setLoading] = useState(false);

  useEffect(() => { refreshBalance(); }, []);

  const refreshBalance = async () => {
    setLoading(true);
    setStatus('正在刷新余额...');
    try {
      const res = await pocketApi.getUserMoney();
      const money = res?.content?.moneyTotal ?? res?.data?.moneyTotal ?? res?.content?.money ?? res?.data?.money ?? '';
      setBalance(String(money));
      setStatus(money !== '' ? '余额已刷新' : '接口未返回余额');
    } catch (error) {
      setStatus(`余额刷新失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={[styles.header, isDark && styles.headerDark]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>返回</Text>
        </TouchableOpacity>
        <Text style={[styles.title, isDark && styles.textLight]}>鸡腿充值</Text>
        <TouchableOpacity onPress={refreshBalance}>
          <Text style={styles.actionText}>刷新余额</Text>
        </TouchableOpacity>
      </View>

      <FadeInView delay={80} duration={300}>
        <View style={[styles.statusBar, isDark && styles.statusBarDark]}>
          <Text style={[styles.statusText, isDark && styles.statusTextDark]}>
            {balance ? `当前余额：${balance} 口袋币 · ` : ''}{status}
          </Text>
          {loading ? <ActivityIndicator color="#ff6f91" style={styles.loading} /> : null}
        </View>

        <WebView
        source={{ uri: RECHARGE_URL }}
        style={[styles.web, isDark && styles.webDark]}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        originWhitelist={['*']}
        mixedContentMode="always"
        startInLoadingState
        renderLoading={() => (
          <View style={[styles.webLoading, isDark && styles.webLoadingDark]}>
            <ActivityIndicator color="#ff6f91" />
            <Text style={[styles.webLoadingText, isDark && styles.textLight]}>正在打开官方充值页...</Text>
          </View>
        )}
        onError={(event) => setStatus(`充值页加载失败：${event.nativeEvent.description}`)}
      />
      </FadeInView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerDark: { backgroundColor: 'transparent' },
  header: {
    paddingTop: 54,
    paddingHorizontal: 20,
    paddingBottom: 14,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerDark: {},
  backBtn: { color: '#ff6f91', fontSize: 14 },
  title: { color: '#ff6f91', fontSize: 20, fontWeight: '800' },
  actionText: { color: '#ff6f91', fontSize: 13, fontWeight: '800' },
  statusBar: { padding: 10, backgroundColor: '#fff3cd', borderBottomWidth: 1, borderBottomColor: '#f3df9a' },
  statusBarDark: { backgroundColor: '#2b2616', borderBottomColor: '#473b18' },
  statusText: { color: '#8a5a00', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  statusTextDark: { color: '#ccbb80' },
  loading: { marginTop: 6 },
  web: { flex: 1, backgroundColor: 'rgba(255,255,255,0.46)' },
  webDark: { backgroundColor: 'rgba(20,20,20,0.58)' },
  webLoading: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.46)' },
  webLoadingDark: { backgroundColor: 'rgba(20,20,20,0.58)' },
  webLoadingText: { marginTop: 8, color: '#333333', fontSize: 12 },
  textLight: { color: '#ff6f91' },
});
