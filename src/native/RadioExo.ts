import { logWarn } from '../utils/runtimeLog';
import { NativeModules, DeviceEventEmitter, Platform } from 'react-native';

type RadioExoNativeModule = {
  getPlaybackSnapshot?: () => Promise<Record<string, unknown>>;
  playQueue?: (...args: [string, number, number, boolean, string, number, number, number]) => void;
  control?: (...args: [string, number]) => void;
  setSkipHints?: (...args: [string, string]) => void;
  updateArt?: (trackId: string, artPath: string) => void;
  getMusicCacheStats?: () => Promise<Record<string, unknown>>;
  setMusicCacheLimitMb?: (mb: number) => void;
  clearMusicCache?: () => Promise<Record<string, unknown>>;
  consumePendingOpenFullScreen?: () => Promise<boolean>;
};

const M = NativeModules.RadioExoModule as RadioExoNativeModule | undefined;

function getModule(): RadioExoNativeModule | undefined {
  return (NativeModules.RadioExoModule as RadioExoNativeModule | undefined) || M;
}

export interface ExoTrackItem {
  url: string;
  title: string;
  artist: string;
  album: string;
  trackId?: string;
  art?: string;
  queueIndex?: number;
  volume?: number;
}

export interface ExoPlaybackSnapshot {
  active: boolean;
  url: string;
  trackId: string;
  title: string;
  artist: string;
  album: string;
  position: number;
  buffered: number;
  buffering: boolean;
  duration: number;
  playing: boolean;
  speed: number;
  queueIndex?: number;
}

export interface MusicCacheStats {
  usedBytes: number;
  limitMb: number;
}

export async function exoGetPlaybackSnapshot(): Promise<ExoPlaybackSnapshot> {
  const empty: ExoPlaybackSnapshot = {
    active: false,
    url: '',
    trackId: '',
    title: '',
    artist: '',
    album: '',
    position: 0,
    buffered: 0,
    buffering: false,
    duration: 0,
    playing: false,
    speed: 1.0,
    queueIndex: -1,
  };
  const mod = getModule();
  if (Platform.OS !== 'android' || !mod?.getPlaybackSnapshot) return empty;
  try {
    const value = await mod.getPlaybackSnapshot();
    return {
      active: !!value.active,
      url: String(value.url || ''),
      trackId: String(value.trackId || ''),
      title: String(value.title || ''),
      artist: String(value.artist || ''),
      album: String(value.album || ''),
      position: Math.max(0, Number(value.position) || 0),
      buffered: Math.max(0, Number(value.buffered) || 0),
      buffering: !!value.buffering,
      duration: Math.max(0, Number(value.duration) || 0),
      playing: !!value.playing,
      speed: Number(value.speed) > 0 ? Number(value.speed) : 1.0,
      queueIndex: typeof value.queueIndex === 'number' ? value.queueIndex : -1,
    };
  } catch {
    return empty;
  }
}

export function exoPlayQueue(
  items: ExoTrackItem[],
  index: number,
  positionSec: number,
  playing: boolean,
  headers?: Record<string, string>,
  volume = 1.0,
  repeat = 0,
  speed = 1.0,
) {
  const mod = getModule();
  if (Platform.OS !== 'android' || !mod?.playQueue || !items.length) return;
  try {
    mod.playQueue(
      JSON.stringify(items),
      Math.max(0, Math.min(index, items.length - 1)),
      Number(positionSec) || 0,
      !!playing,
      JSON.stringify(headers || {}),
      Number(volume) || 1.0,
      Number(repeat) || 0,
      Number(speed) > 0 ? Number(speed) : 1.0,
    );
  } catch {}
}

export function exoPlayTrack(
  item: ExoTrackItem,
  positionSec: number,
  playing: boolean,
  headers?: Record<string, string>,
  volume = 1.0,
  repeat = 0,
  speed = 1.0,
) {
  exoPlayQueue([item], 0, positionSec, playing, headers, volume, repeat, speed);
}

export function exoControl(
  cmd: 'pause' | 'resume' | 'seek' | 'stop' | 'next' | 'prev' | 'repeat' | 'speed' | 'volume',
  value = 0,
) {
  if (Platform.OS !== 'android') return;

  const mod = getModule();
  if (!mod?.control) {
    logWarn(`[exo] control unavailable: ${cmd}`, 'radio');
    return;
  }
  try {
    mod.control(cmd, Number(value) || 0);
  } catch (e) {
    logWarn(`[exo] control failed: ${cmd} ${String(e)}`, 'radio');
  }
}

export function exoSetSkipHints(next: ExoTrackItem | null, prev: ExoTrackItem | null) {
  const mod = getModule();
  if (Platform.OS !== 'android' || !mod?.setSkipHints) return;
  try {
    mod.setSkipHints(JSON.stringify(next), JSON.stringify(prev));
  } catch {}
}

export function exoUpdateArt(trackId: string, artPath: string): void {
  const mod = getModule();
  if (Platform.OS !== 'android' || !mod?.updateArt || !artPath) return;
  try {
    mod.updateArt(String(trackId || ''), String(artPath));
  } catch {}
}

export async function exoGetCacheStats(): Promise<MusicCacheStats> {
  const fallback: MusicCacheStats = { usedBytes: 0, limitMb: 300 };
  const mod = getModule();
  if (Platform.OS !== 'android' || !mod?.getMusicCacheStats) return fallback;
  try {
    const res = await mod.getMusicCacheStats();
    return {
      usedBytes: Math.max(0, Number(res?.usedBytes) || 0),
      limitMb: Math.max(100, Number(res?.limitMb) || 300),
    };
  } catch {
    return fallback;
  }
}

export function exoSetCacheLimitMb(mb: number): void {
  const mod = getModule();
  if (Platform.OS !== 'android' || !mod?.setMusicCacheLimitMb) return;
  try {
    mod.setMusicCacheLimitMb(Math.max(100, Math.min(1024, Math.round(mb))));
  } catch {}
}

export async function exoClearCache(): Promise<MusicCacheStats> {
  const fallback: MusicCacheStats = { usedBytes: 0, limitMb: 300 };
  const mod = getModule();
  if (Platform.OS !== 'android' || !mod?.clearMusicCache) return fallback;
  try {
    const res = await mod.clearMusicCache();
    return {
      usedBytes: Math.max(0, Number(res?.usedBytes) || 0),
      limitMb: Math.max(100, Number(res?.limitMb) || 300),
    };
  } catch {
    return fallback;
  }
}

export async function exoConsumePendingOpenFullScreen(): Promise<boolean> {
  const mod = getModule();
  if (Platform.OS !== 'android' || !mod?.consumePendingOpenFullScreen) return false;
  try {
    return !!(await mod.consumePendingOpenFullScreen());
  } catch {
    return false;
  }
}

let nativeExoActive = false;
let nativeExoDisabled = false;
const nativeExoDisabledListeners = new Set<(disabled: boolean) => void>();
export const setNativeExoActive = (v: boolean) => {
  nativeExoActive = v;
};
export const isNativeExoActive = () => nativeExoActive;
export const setNativeExoDisabled = (v: boolean) => {
  const next = !!v;
  if (nativeExoDisabled === next) {
    if (next) nativeExoActive = false;
    return;
  }
  nativeExoDisabled = next;
  if (next) nativeExoActive = false;
  nativeExoDisabledListeners.forEach((fn) => {
    try {
      fn(next);
    } catch {}
  });
};
export const isNativeExoDisabled = () => nativeExoDisabled;
export const subscribeNativeExoDisabled = (cb: (disabled: boolean) => void): (() => void) => {
  nativeExoDisabledListeners.add(cb);
  return () => {
    nativeExoDisabledListeners.delete(cb);
  };
};

export function subscribeExo(
  cb: (_type: string, _payload: Record<string, unknown>) => void,
): () => void {
  if (Platform.OS !== 'android') return () => {};
  const sub = DeviceEventEmitter.addListener('YayaExoEvent', (e: unknown) => {
    try {
      const payload = e as Record<string, unknown>;
      const type = String(payload?.type || '');
      if (type) cb(type, payload);
    } catch {}
  });
  return () => sub.remove();
}
