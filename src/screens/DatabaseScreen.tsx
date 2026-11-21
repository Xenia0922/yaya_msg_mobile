import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import ScreenHeader from '../components/ScreenHeader';
import { useI18n } from '../i18n';
import { usePalette, fontFamily } from '../theme';

const DB_URL = 'https://gnz.hk/database';

export default function DatabaseScreen() {
  const { t } = useI18n();
  const palette = usePalette();
  const [, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('数据库')} />
      <View style={styles.body}>
        <WebView
          key={reloadKey}
          source={{ uri: DB_URL }}
          style={styles.web}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          originWhitelist={['*']}
          mixedContentMode="always"
          onLoadStart={() => {
            setLoading(true);
            setFailed(false);
          }}
          onLoadEnd={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setFailed(true);
          }}
          renderLoading={() => (
            <View style={styles.center} pointerEvents="none">
              <ActivityIndicator size="large" color={palette.tint} />
            </View>
          )}
        />
        {failed ? (
          <View style={styles.failWrap}>
            <Text style={[styles.failText, { color: palette.labelSecondary }]}>
              {t('页面加载失败，请检查网络')}
            </Text>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: palette.tint }]}
              activeOpacity={0.85}
              onPress={() => {
                setFailed(false);
                setLoading(true);
                setReloadKey((k) => k + 1);
              }}
            >
              <Text style={[styles.retryText, { color: palette.onTint }]}>{t('重试')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flex: 1 },
  web: { flex: 1, backgroundColor: 'transparent' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  failWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  failText: { fontSize: 13, fontFamily: fontFamily.system },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20 },
  retryText: { fontSize: 13, fontWeight: '700' },
});
