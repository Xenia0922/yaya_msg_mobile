import { NativeModules, Platform, DeviceEventEmitter } from 'react-native';

const Pip = (NativeModules as any)?.PipController;

const pipSources = new Map<string, boolean>();

let falseTimer: ReturnType<typeof setTimeout> | null = null;
const FALSE_SETTLE_MS = 800;

function syncPipPlaying() {
  if (Platform.OS !== 'android' || !Pip?.setVideoPlaying) return;
  const any = Array.from(pipSources.values()).some(Boolean);
  if (any) {
    if (falseTimer) {
      clearTimeout(falseTimer);
      falseTimer = null;
    }
    try {
      Pip.setVideoPlaying(true);
    } catch {}
    return;
  }

  if (falseTimer) return;
  falseTimer = setTimeout(() => {
    falseTimer = null;

    if (!Array.from(pipSources.values()).some(Boolean)) {
      try {
        Pip.setVideoPlaying(false);
      } catch {}
    }
  }, FALSE_SETTLE_MS);
}

export function setPipPlaying(playing: boolean, source = 'default') {
  if (playing) pipSources.set(source, true);
  else pipSources.delete(source);
  syncPipPlaying();
}

export function setPipEnabled(enabled: boolean) {
  if (Platform.OS !== 'android' || !Pip?.setPipEnabled) return;
  try {
    Pip.setPipEnabled(!!enabled);
  } catch {}
}

export function enterPipMode() {
  if (Platform.OS !== 'android' || !Pip?.enterPip) return;
  try {
    Pip.enterPip();
  } catch {}
}

export function listenPipDenied(cb: (reason: string) => void): () => void {
  if (Platform.OS !== 'android') return () => {};
  const sub = DeviceEventEmitter.addListener('PipDenied', (e: any) => {
    try {
      cb(String(e?.reason || 'unknown'));
    } catch {}
  });
  return () => sub.remove();
}

export function listenPipToggle(cb: (payload: { playing?: boolean }) => void): () => void {
  if (Platform.OS !== 'android') return () => {};
  const sub = DeviceEventEmitter.addListener('PipToggleCmd', (e: any) => {
    try {
      cb(e && typeof e === 'object' ? e : {});
    } catch {}
  });
  return () => sub.remove();
}

export function setPipAspect(w: number | string, h: number | string) {
  if (Platform.OS !== 'android' || !Pip?.setAspectRatio) return;
  const nw = Number(w) || 0;
  const nh = Number(h) || 0;
  if (nw > 0 && nh > 0) {
    try {
      Pip.setAspectRatio(nw, nh);
    } catch {}
  }
}

export function setPipAspectLive(landscape: boolean) {
  if (landscape) setPipAspect(16, 9);
  else setPipAspect(9, 16);
}
