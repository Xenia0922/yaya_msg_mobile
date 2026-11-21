import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import pocketApi from '../api/pocket48';
import ScreenHeader from '../components/ScreenHeader';
import { HeaderAction } from '../components/HeaderAction';
import { CenterSpinner } from '../components/Loaders';
import { ErrorState } from '../components/StateViews';
import { usePalette, radii } from '../theme';
import { useI18n } from '../i18n';

const RECHARGE_URL = 'https://live.48.cn/Recharge/';

export default function RechargeScreen() {
  const palette = usePalette();
  const { t } = useI18n();
  const [webError, setWebError] = useState('');

  const [selfPocketId, setSelfPocketId] = useState('');
  const [webSlow, setWebSlow] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armSlowTimer = useCallback(() => {
    if (slowTimer.current) clearTimeout(slowTimer.current);
    slowTimer.current = setTimeout(() => setWebSlow(true), 15000);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res: any = await pocketApi.loginCheckToken();
        const id =
          res?.content?.userInfo?.baseUserInfo?.userId ??
          res?.content?.userInfo?.userId ??
          res?.content?.baseUserInfo?.userId ??
          res?.content?.userId ??
          '';
        if (id && active) setSelfPocketId(String(id));
      } catch {}
    })();
    armSlowTimer();
    return () => {
      active = false;
      if (slowTimer.current) clearTimeout(slowTimer.current);
    };
  }, [armSlowTimer]);

  useEffect(() => {
    if (!selfPocketId) return;
    webViewRef.current?.injectJavaScript(`
      (function () {
        try {
          window.__POCKET_ID__ = ${JSON.stringify(selfPocketId)};
          var el = document.querySelector('#pocket_id');
          if (el && !el.value) el.value = window.__POCKET_ID__;
        } catch (e) {}
      })();
      true;
    `);
  }, [selfPocketId]);

  const reloadWeb = () => {
    setWebError('');
    setWebSlow(false);
    armSlowTimer();
    webViewRef.current?.reload();
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={t('鸡腿充值')}
        right={<HeaderAction label={t('刷新')} onPress={reloadWeb} />}
      />

      <View style={[styles.webCard, { borderColor: palette.hairline, overflow: 'hidden' }]}>
        <WebView
          ref={webViewRef}
          source={{ uri: RECHARGE_URL }}
          style={styles.web}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={['https://*', 'alipays://*', 'weixin://*']}
          mixedContentMode="never"
          startInLoadingState
          userAgent="Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 PocketFans201807"

          injectedJavaScriptBeforeContentLoaded={
            selfPocketId
              ? `window.__POCKET_ID__ = ${JSON.stringify(selfPocketId)}; true;`
              : undefined
          }
          injectedJavaScript={`
            (function () {
              try {
                var el = document.querySelector('#pocket_id');
                if (el && window.__POCKET_ID__ && !el.value) el.value = window.__POCKET_ID__;
              } catch (e) {}
            })();
            true;
          `}
          renderLoading={() => (
            <View style={styles.webLoading}>
              <CenterSpinner text={t('正在打开官方充值页...')} />
            </View>
          )}
          onError={(event) => {
            if (slowTimer.current) clearTimeout(slowTimer.current);
            setWebError(
              t('充值页加载失败：{msg}', {
                msg: String(event.nativeEvent.description).slice(0, 160),
              }),
            );
          }}
          onLoadEnd={() => {
            if (slowTimer.current) clearTimeout(slowTimer.current);
            setWebSlow(false);
          }}
        />
        {webError || webSlow ? (
          <View style={[styles.webErrorWrap, { backgroundColor: palette.background }]}>
            <ErrorState
              icon="web-off"
              title={t('充值页加载失败')}
              hint={webError || t('加载时间过长，请重试')}
              onAction={reloadWeb}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  webCard: {
    flex: 1,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 12,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  web: { flex: 1, backgroundColor: '#FFFFFF' },
  webLoading: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webErrorWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
});
