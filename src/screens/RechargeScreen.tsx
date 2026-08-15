import React, { useState, useEffect, useRef } from 'react';
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
import { errorMessage } from '../utils/data';
import ScreenHeader from '../components/ScreenHeader';
import { usePalette } from '../theme';
import { useI18n } from '../i18n';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

const RECHARGE_URL = 'https://live.48.cn/Recharge/';

export default function RechargeScreen() {
  const palette = usePalette();
  const { t } = useI18n();
  const [balance, setBalance] = useState('');
  const [status, setStatus] = useState(t('暂无数据'));
  const [webError, setWebError] = useState('');
  const [loading, setLoading] = useState(false);
  const webViewRef = useRef<WebView>(null);

  useEffect(() => { refreshBalance(); }, []);

  const refreshBalance = async () => {
    if (loading) return;
    setLoading(true);
    setStatus(t('正在刷新余额...'));
    try {
      const res = await pocketApi.getUserMoney();
      const money = res?.content?.moneyTotal ?? res?.data?.moneyTotal ?? res?.content?.money ?? res?.data?.money ?? '';
      setBalance(String(money));
      setStatus(money !== '' ? t('余额已刷新') : t('接口未返回余额'));
    } catch (error) {
      setStatus(t('余额刷新失败：{msg}', { msg: errorMessage(error) }));
    } finally {
      setLoading(false);
    }
  };

  const reloadWeb = () => {
    setWebError('');
    webViewRef.current?.reload();
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('鸡腿充值')} right={
        <TouchableOpacity onPress={refreshBalance}>
          <Text style={[styles.actionText, { color: palette.tint }]}>{t('刷新余额')}</Text>
        </TouchableOpacity>
      } />

      <View
        style={[
          styles.balanceCard,
          {
            backgroundColor: palette.surface,
            borderColor: palette.hairline,
          },
        ]}
      >
        <View style={[styles.balanceIcon, { backgroundColor: palette.tintSoft }]}>
          <MaterialCommunityIcons name="credit-card-outline" size={20} color={palette.tint} />
        </View>
        <View style={styles.balanceInfo}>
          <Text style={[styles.balanceLabel, { color: palette.labelTertiary }]}>{t('当前余额')}</Text>
          <Text style={[styles.balanceValue, { color: palette.label }]}>
            {balance !== '' ? t('{balance} 鸡腿', { balance }) : t('暂无数据')}
          </Text>
          <View style={styles.statusLine}>
            <Text style={[styles.statusText, { color: palette.labelSecondary }]} numberOfLines={1}>{status}</Text>
            {loading ? <ActivityIndicator color={palette.tint} size="small" style={styles.loading} /> : null}
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.refreshBtn, { backgroundColor: palette.tint }]}
        onPress={refreshBalance}
        disabled={loading}
      >
        <MaterialCommunityIcons name="refresh" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
        <Text style={styles.refreshBtnText}>{t('刷新余额')}</Text>
      </TouchableOpacity>

      <WebView
      ref={webViewRef}
      source={{ uri: RECHARGE_URL }}
      style={styles.web}
      javaScriptEnabled
      domStorageEnabled
      originWhitelist={['*']}
      mixedContentMode="always"
      startInLoadingState
      userAgent="Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 PocketFans201807"
      renderLoading={() => (
        <View style={[styles.webLoading, { backgroundColor: palette.background }]}>
          <ActivityIndicator color={palette.tint} />
          <Text style={[styles.webLoadingText, { color: palette.labelSecondary }]}>{t('正在打开官方充值页...')}</Text>
        </View>
      )}
      onError={(event) => setWebError(t('充值页加载失败：{msg}', { msg: String(event.nativeEvent.description).slice(0, 160) }))}
    />
    {webError ? (
      <View style={[styles.webErrorWrap, { backgroundColor: palette.background }]}>
        <MaterialCommunityIcons name="web-off" size={32} color={palette.labelTertiary} />
        <Text style={[styles.webErrorText, { color: palette.labelSecondary }]}>{webError}</Text>
        <TouchableOpacity style={[styles.webRetryBtn, { backgroundColor: palette.tint }]} onPress={reloadWeb}>
          <Text style={styles.webRetryText}>{t('重新加载')}</Text>
        </TouchableOpacity>
      </View>
    ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  actionText: { color: '#ff6f91', fontSize: 13, fontWeight: '800' },
  balanceCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    padding: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
  },
  balanceIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceInfo: { flex: 1, marginLeft: 12, minWidth: 0 },
  balanceLabel: { fontSize: 11, fontWeight: '600' },
  balanceValue: { fontSize: 20, fontWeight: '800', marginTop: 2 },
  statusLine: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  statusText: { fontSize: 12, flex: 1 },
  loading: { marginLeft: 8 },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginVertical: 12,
    paddingVertical: 12,
    borderRadius: 18,
  },
  refreshBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  web: { flex: 1, backgroundColor: '#FFFFFF' },
  webLoading: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  webLoadingText: { marginTop: 8, fontSize: 12 },
  webErrorWrap: {
    position: 'absolute',
    left: 0, right: 0, top: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  webErrorText: { marginTop: 12, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  webRetryBtn: { marginTop: 16, paddingHorizontal: 24, paddingVertical: 9, borderRadius: 18 },
  webRetryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
});
