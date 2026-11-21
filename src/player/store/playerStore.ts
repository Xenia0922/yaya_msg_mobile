import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PlayerSource, PlayerMeta, DanmakuSource } from '../types';
import { isRtmpUrl } from '../resolve/streamResolver';

import { useMusicPlayerStore } from '../../store/musicPlayerStore';

export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

interface PlayerState {
  source: PlayerSource | null;
  meta: PlayerMeta;
  danmaku: DanmakuSource;

  candidateUrls: string[];
  candidateIndex: number;

  state: PlaybackState;
  position: number;
  duration: number;
  error: string;

  controlsVisible: boolean;
  cleanScreen: boolean;
  fullscreen: boolean;
  useWebKernel: boolean;

  forceWebOnce: boolean;

  activeKernel: 'native' | 'exo' | 'web';

  qualityQn: number | null;

  rate: number;

  rotateDeg: number;

  mirrorMode: 'none' | 'horizontal' | 'vertical';

  detectedLandscape: boolean;
  detectedAspect: { w: number; h: number } | null;

  seekTarget: number;

  seekNonce: number;

  openToken: number;

  stickyTarget: number;
  stickyFrom: number;
  stickyUntil: number;

  rebuildNonce: number;

  danmakuOn: boolean;
  hideEnter: boolean;
  hideEffects: boolean;

  open: (source: PlayerSource, meta?: PlayerMeta, danmaku?: DanmakuSource) => void;
  close: () => void;
  setState: (state: PlaybackState) => void;
  setPosition: (p: number) => void;
  setDuration: (d: number) => void;
  setError: (e: string) => void;
  clearError: () => void;
  toggleControls: (visible?: boolean) => void;
  setCleanScreen: (value: boolean) => void;
  setFullscreen: (v: boolean) => void;
  setUseWebKernel: (v: boolean) => void;
  setForceWebOnce: (v: boolean) => void;
  setActiveKernel: (k: PlayerState['activeKernel']) => void;
  setQualityQn: (qn: number | null) => void;
  setRate: (r: number) => void;
  setRotateDeg: (deg: number) => void;
  setMirrorMode: (m: 'none' | 'horizontal' | 'vertical') => void;
  setVideoMeta: (aspect: { w: number; h: number } | null, isLandscape: boolean) => void;
  setSeekTarget: (t: number) => void;

  clearSeekTarget: () => void;

  markSeekIssued: (target: number) => void;

  requestKernelRebuild: () => void;
  toggleDanmaku: () => void;
  toggleEnter: () => void;
  toggleEffects: () => void;

  nextCandidate: () => boolean;

  onClose: (() => void) | null;
  setOnClose: (fn: (() => void) | null) => void;
}

export function kernelForSource(source: PlayerSource): 'exo' | 'native' {
  const u = String((source && source.url) || '').toLowerCase();
  if (source?.needsNativeExo) return 'exo';
  if (isRtmpUrl(u)) return 'exo';
  if (u.includes('.flv')) return 'exo';
  return 'native';
}

export const usePlayerStore = create<PlayerState>((set) => ({
  onClose: null,
  setOnClose: (fn) => set({ onClose: fn }),
  source: null,
  meta: { title: '' },
  danmaku: { type: 'none' },
  candidateUrls: [],
  candidateIndex: 0,
  state: 'idle',
  position: 0,
  duration: 0,
  error: '',
  controlsVisible: true,
  cleanScreen: false,
  fullscreen: false,
  useWebKernel: false,
  forceWebOnce: false,
  activeKernel: 'native',
  qualityQn: null,
  rate: 1,
  rotateDeg: 0,
  mirrorMode: 'none' as const,
  detectedLandscape: false,
  detectedAspect: null,
  seekTarget: 0,
  seekNonce: 0,
  openToken: 0,
  stickyTarget: 0,
  stickyFrom: 0,
  stickyUntil: 0,
  rebuildNonce: 0,
  danmakuOn: true,
  hideEnter: false,
  hideEffects: false,

  open: (source, meta = { title: '' }, danmaku = { type: 'none' }) => {
    try {
      const mst = useMusicPlayerStore.getState();
      if (
        mst.queue.length &&
        (mst.playbackState === 'playing' ||
          mst.playbackState === 'paused' ||
          mst.playbackState === 'loading')
      ) {
        mst.setPlaybackState(mst.playbackState === 'loading' ? 'idle' : 'paused');
      }
    } catch {}
    return set((s) => {
      const urls = (source.urls && source.urls.length ? source.urls : [source.url]).filter(Boolean);
      return {
        source,
        meta,
        danmaku,
        state: source.url ? 'loading' : 'idle',
        position: 0,
        duration: 0,
        error: '',
        controlsVisible: true,
        cleanScreen: false,
        fullscreen: false,
        useWebKernel: false,
        forceWebOnce: false,
        activeKernel: kernelForSource(source),
        qualityQn: null,
        rate: 1,
        rotateDeg: 0,
        mirrorMode: 'none' as const,
        detectedLandscape: false,
        detectedAspect: null,
        seekTarget: 0,
        danmakuOn: true,
        openToken: s.openToken + 1,
        candidateUrls: urls,
        candidateIndex: 0,
        ...(urls[0] && urls[0] !== source.url ? { source: { ...source, url: urls[0] } } : {}),
      };
    });
  },

  close: () =>
    set({
      source: null,
      meta: { title: '' },
      danmaku: { type: 'none' },
      state: 'idle',
      position: 0,
      duration: 0,
      error: '',
      cleanScreen: false,
      fullscreen: false,
      detectedLandscape: false,
      detectedAspect: null,
    }),

  setState: (state) => set({ state }),
  setPosition: (position) =>
    set((s) => {
      if (s.stickyUntil > Date.now()) {
        const dNow = Math.abs(position - s.stickyTarget);
        const dFrom = Math.abs(s.stickyFrom - s.stickyTarget) + 0.3;
        if (dNow > dFrom) return {};
      }
      return { position };
    }),
  setDuration: (duration) => set({ duration }),
  setError: (error) => set({ error, state: 'error' }),
  clearError: () => set({ error: '', state: 'loading' }),
  toggleControls: (visible) =>
    set((s) => ({ controlsVisible: visible === undefined ? !s.controlsVisible : visible })),
  setCleanScreen: (cleanScreen) => set({ cleanScreen }),
  setFullscreen: (fullscreen) => set({ fullscreen }),
  setUseWebKernel: (useWebKernel) => set({ useWebKernel }),
  setForceWebOnce: (forceWebOnce) => set({ forceWebOnce }),
  setActiveKernel: (activeKernel) => set({ activeKernel }),
  setQualityQn: (qualityQn) => set({ qualityQn }),
  setRate: (rate) => set({ rate }),
  setRotateDeg: (rotateDeg) => set({ rotateDeg: ((rotateDeg % 360) + 360) % 360 }),
  setMirrorMode: (mirrorMode) => set({ mirrorMode }),
  setVideoMeta: (detectedAspect, detectedLandscape) => set({ detectedAspect, detectedLandscape }),

  setSeekTarget: (seekTarget) =>
    set((s) => ({
      seekTarget,
      seekNonce: s.seekNonce + 1,
      stickyFrom: s.position,
      stickyTarget: seekTarget,
      stickyUntil: Date.now() + 1500,
    })),

  clearSeekTarget: () => set({ seekTarget: 0 }),
  markSeekIssued: (target) =>
    set((s) => ({
      position: target,
      seekTarget: 0,
      stickyTarget: target,
      stickyFrom: s.position,
      stickyUntil: Date.now() + 1500,
    })),
  requestKernelRebuild: () => set((s) => ({ rebuildNonce: s.rebuildNonce + 1 })),
  toggleDanmaku: () => set((s) => ({ danmakuOn: !s.danmakuOn })),
  toggleEnter: () =>
    set((s) => {
      const hideEnter = !s.hideEnter;
      persistPrefs(hideEnter, s.hideEffects);
      return { hideEnter };
    }),
  toggleEffects: () =>
    set((s) => {
      const hideEffects = !s.hideEffects;
      persistPrefs(s.hideEnter, hideEffects);
      return { hideEffects };
    }),
  nextCandidate: () => {
    let switched = false;
    set((s) => {
      if (!s.source || s.candidateIndex + 1 >= s.candidateUrls.length) return {};
      const nextIdx = s.candidateIndex + 1;
      switched = true;
      return {
        candidateIndex: nextIdx,
        source: { ...s.source, url: s.candidateUrls[nextIdx] },
        state: 'loading',
        error: '',
        position: 0,
        duration: 0,
      };
    });
    return switched;
  },
}));

const PREFS_KEY = 'yaya_player_prefs_v1';
let prefsHydrated = false;

function persistPrefs(hideEnter: boolean, hideEffects: boolean) {
  AsyncStorage.setItem(PREFS_KEY, JSON.stringify({ hideEnter, hideEffects })).catch(() => {});
}

export async function loadPlayerPrefs() {
  if (prefsHydrated) return;
  prefsHydrated = true;
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    usePlayerStore.setState({
      ...(typeof p?.hideEnter === 'boolean' ? { hideEnter: p.hideEnter } : null),
      ...(typeof p?.hideEffects === 'boolean' ? { hideEffects: p.hideEffects } : null),
    });
  } catch {}
}

export default usePlayerStore;
