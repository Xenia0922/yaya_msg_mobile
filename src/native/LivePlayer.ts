import { NativeModules, Platform, requireNativeComponent, ViewProps } from 'react-native';
import { t } from '../i18n';

const { LivePlayerModule } = NativeModules;

export interface LivePlayerOptions {
  liveId?: string;
  acceptUserId?: string;
  urls?: string[];
}

export function openNativeLivePlayer(url: string, title: string, options: LivePlayerOptions = {}) {
  if (Platform.OS !== 'android' || !LivePlayerModule?.open) {
    throw new Error('Android native live player is not available');
  }
  LivePlayerModule.open(url.trim(), title || 'Pocket48 Live', {
    ...options,
    labels: {
      back: t('返回'),
      rotate: t('横屏'),
      refresh: t('刷新'),
      gift: t('礼物'),
      failTitle: t('直播播放失败'),
      retry: t('重试'),
      close: t('关闭'),
      giftHintTitle: t('提示'),
      giftHintMsg: t('缺少 liveId，无法打开礼物面板'),
      giftOk: t('确定'),
    },
  });
}

export function setLiveImmersiveMode(enabled: boolean) {
  if (Platform.OS === 'android' && LivePlayerModule?.setImmersive) {
    LivePlayerModule.setImmersive(enabled);
  }
}

export const LiveExoView = Platform.OS === 'android'
  ? requireNativeComponent<ViewProps & { url: string }>('LiveExoView')
  : null;