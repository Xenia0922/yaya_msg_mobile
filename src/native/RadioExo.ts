import { logWarn } from '../utils/runtimeLog';

import { NativeModules, DeviceEventEmitter, Platform } from 'react-native';

type RadioExoNativeModule = {
  getPlaybackSnapshot?: () => Promise<Record<string, unknown>>;
  playQueue?: (...args: [string, number, number, boolean, string, number, number]) => void;
  control?: (...args: [string, number]) => void;
  setSkipHints?: (...args: [string, string]) => void;
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
}

export interface ExoPlaybackSnapshot {
  active: boolean;
  url: string;
  trackId: string;
  title: string;
  artist: string;
  album: string;
  position: number;
  duration: number;
  playing: boolean;
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
    duration: 0,
    playing: false,
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
      duration: Math.max(0, Number(value.duration) || 0),
      playing: !!value.playing,
    };
  } catch {
    return empty;
  }
}

export function exoPlayTrack(
  item: ExoTrackItem,
  positionSec: number,
  playing: boolean,
  headers?: Record<string, string>,
  volume = 1.0,
  repeat = 0,
) {
  const mod = getModule();
  if (Platform.OS !== 'android' || !mod?.playQueue) return;
  try {
    mod.playQueue(
      JSON.stringify([item]),
      0,
      Number(positionSec) || 0,
      !!playing,
      JSON.stringify(headers || {}),
      Number(volume) || 0,
      repeat ? 1 : 0,
    );
  } catch {}
}

export function exoControl(
  cmd: 'pause' | 'resume' | 'seek' | 'stop' | 'next' | 'prev' | 'repeat',
  positionSec = 0,
) {
  if (Platform.OS !== 'android') return;

  const mod = getModule();
  if (!mod?.control) {
    logWarn(`[exo] control unavailable: ${cmd}`, 'radio');
    return;
  }
  try {
    mod.control(cmd, Number(positionSec) || 0);
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
