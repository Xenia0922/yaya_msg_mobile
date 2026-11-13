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

/**
 * 鸡腿充值：直接全屏打开官方充值页。
 *
 * 历史包袱（2026-10-25 删除）：原实现顶部挂了一张「余额卡」——
 *   - 调 /user/api/v1/user/money 拉余额，但该接口在 token 过期时恒返回 401003，
 *     卡片退化成「一个图标 + 刷新」的空壳，还占掉近 1/4 屏幕把充值页挤成一条；
 *   - 官方充值页本身就有账户/余额/套餐的完整界面，重复展示没有意义。
 * 现在只保留「全屏官方页 + 预填口袋ID + 15s 加载兜底」，导航栏刷新 = 重载充值页。
 */
export default function RechargeScreen() {
  const palette = usePalette();
  const { t } = useI18n();
  const [webError, setWebError] = useState('');
  /** 官方充值页（live.48.cn/Recharge/）本身无自动登录态：它要用户手输「口袋ID」。
   *  App 已持有登录态，这里把自身 id 取出来预填，省一步。 */
  const [selfPocketId, setSelfPocketId] = useState('');
  const [webSlow, setWebSlow] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armSlowTimer = useCallback(() => {
    if (slowTimer.current) clearTimeout(slowTimer.current);
    slowTimer.current = setTimeout(() => setWebSlow(true), 15000);
  }, []);

  useEffect(() => {
    // 自身口袋 id（充值页要手输，预填）
    void (async () => {
      try {
        const res: any = await pocketApi.loginCheckToken();
        const id = res?.content?.userInfo?.userId ?? res?.content?.userId ?? '';
        if (id) setSelfPocketId(String(id));
      } catch {
        /* 拿不到就不预填，不影响充值页本身 */
      }
    })();
    armSlowTimer();
    return () => { if (slowTimer.current) clearTimeout(slowTimer.current); };
  }, []);

  const reloadWeb = () => {
    setWebError('');
    setWebSlow(false);
    armSlowTimer();
    webViewRef.current?.reload();
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title={t('鸡腿充值')} right={
        <HeaderAction label={t('刷新')} onPress={reloadWeb} />
      } />

      {/* 官方充值页全屏（原先顶部还有一张余额卡，见文件头注释） */}
      <View style={[styles.webCard, { borderColor: palette.hairline, overflow: 'hidden' }]}>
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
          /* 页面内容加载前把自身口袋 id 塞进 window，页面就绪后填入 #pocket_id */
          injectedJavaScriptBeforeContentLoaded={selfPocketId
            ? `window.__POCKET_ID__ = ${JSON.stringify(selfPocketId)}; true;`
            : undefined}
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
            setWebError(t('充值页加载失败：{msg}', { msg: String(event.nativeEvent.description).slice(0, 160) }));
          }}
          onLoadEnd={() => { if (slowTimer.current) clearTimeout(slowTimer.current); setWebSlow(false); }}
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
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  webErrorWrap: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    padding: 32,
  },
});
