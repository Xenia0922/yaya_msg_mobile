import { NativeModules, Platform, requireNativeComponent, ViewProps } from 'react-native';

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
  LivePlayerModule.open(url.trim(), title || 'Pocket48 Live', options);
}

export function setLiveImmersiveMode(enabled: boolean) {
  if (Platform.OS === 'android' && LivePlayerModule?.setImmersive) {
    LivePlayerModule.setImmersive(enabled);
  }
}

export const LiveExoView = Platform.OS === 'android'
  ? requireNativeComponent<ViewProps & { url: string }>('LiveExoView')
  : null;
