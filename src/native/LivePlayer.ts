import {
  DeviceEventEmitter,
  NativeModules,
  Platform,
  requireNativeComponent,
  ViewProps,
} from 'react-native';
import { isNativeExoDisabled } from './RadioExo';

const { LivePlayerModule, RadioServiceModule } = NativeModules;

export function setLiveImmersiveMode(enabled: boolean) {
  if (Platform.OS === 'android' && LivePlayerModule?.setImmersive) {
    LivePlayerModule.setImmersive(enabled);
  }
}

export interface LiveSizeEventData {
  width: number;
  height: number;
  visualWidth?: number;
  visualHeight?: number;
  isLandscape?: boolean;
  isPillarboxed?: boolean;
}

export const LiveExoView =
  Platform.OS === 'android'
    ? requireNativeComponent<
        ViewProps & {
          url: string;

          audioOnly?: boolean;
          coverPortrait?: boolean;

          paused?: boolean;
          onSize?: (e: { nativeEvent: LiveSizeEventData }) => void;

          onError?: (e: { nativeEvent: { message: string } }) => void;
        }
      >('LiveExoView')
    : null;

export function onLiveFirstFrame(
  cb: (payload: {
    url: string;
    width: number;
    height: number;
    visualWidth?: number;
    visualHeight?: number;
    isLandscape?: boolean;
    isPillarboxed?: boolean;
  }) => void,
): () => void {
  if (Platform.OS !== 'android') return () => {};
  const sub = DeviceEventEmitter.addListener('LivePlayer:size', (e: any) => {
    cb({
      url: String(e?.url || ''),
      width: Number(e?.width) || 0,
      height: Number(e?.height) || 0,
      visualWidth: Number(e?.visualWidth) || 0,
      visualHeight: Number(e?.visualHeight) || 0,
      isLandscape: typeof e?.isLandscape === 'boolean' ? e.isLandscape : undefined,
      isPillarboxed: typeof e?.isPillarboxed === 'boolean' ? e.isPillarboxed : undefined,
    });
  });
  return () => sub.remove();
}

export function onLiveNativeError(
  cb: (payload: { url: string; message: string }) => void,
): () => void {
  if (Platform.OS !== 'android') return () => {};
  const sub = DeviceEventEmitter.addListener('LivePlayer:error', (e: any) => {
    cb({ url: String(e?.url || ''), message: String(e?.message || '') });
  });
  return () => sub.remove();
}

export interface RadioMediaInfo {
  title: string;
  cover?: string;

  artist?: string;

  album?: string;

  lyric?: string;
  isPlaying: boolean;
  position?: number;
  duration?: number;
}

export function syncRadioPosition(positionSec: number) {
  if (!isNativeExoDisabled()) return;
  if (Platform.OS !== 'android') return;
  try {
    (RadioServiceModule as any).syncPosition(Number(positionSec) || 0);
  } catch {}
}

export function startRadioForeground(info: string | RadioMediaInfo, force = false) {
  if (Platform.OS !== 'android' || !RadioServiceModule?.updateMedia) return;

  if (!force && !isNativeExoDisabled()) return;
  if (typeof info === 'string') {
    RadioServiceModule.updateMedia(info, '', false, 0, 0);
    return;
  }
  const fn = RadioServiceModule.updateMediaEx || RadioServiceModule.updateMedia;
  fn(
    info.title || '',
    info.cover || '',
    info.artist || '',
    info.album || '',
    !!info.isPlaying,
    Number(info.position) || 0,
    Number(info.duration) || 0,
  );
}

export function updateRadioLyric(text: string) {
  if (!isNativeExoDisabled()) return;
  if (Platform.OS !== 'android' || !RadioServiceModule?.updateLyric) return;
  RadioServiceModule.updateLyric(String(text || ''));
}

export function stopRadioForeground() {
  if (Platform.OS === 'android' && RadioServiceModule?.end) {
    RadioServiceModule.end();
  }
}

export function onRadioStopRequested(cb: () => void): () => void {
  if (Platform.OS !== 'android') return () => {};
  const sub = DeviceEventEmitter.addListener('RadioStopRequested', cb);
  return () => sub.remove();
}

export function onRadioControlRequested(
  cb: (
    action:
      'play' | 'pause' | 'play_pause' | 'prev' | 'next' | 'stop' | 'seek' | 'favorite' | 'playlist',
    value?: number,
  ) => void,
): () => void {
  if (Platform.OS !== 'android') return () => {};
  const sub = DeviceEventEmitter.addListener('RadioControlRequested', (e: any) => {
    const a = String(e?.action || '');

    if (
      a === 'play' ||
      a === 'pause' ||
      a === 'play_pause' ||
      a === 'prev' ||
      a === 'next' ||
      a === 'stop' ||
      a === 'seek' ||
      a === 'favorite' ||
      a === 'playlist'
    ) {
      cb(a as any, Number(e?.value) || 0);
    }
  });
  return () => sub.remove();
}
