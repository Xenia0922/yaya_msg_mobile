import { create } from 'zustand';
import { useMusicPlayerStore } from './musicPlayerStore';

export interface MiniPlayerInfo {
  url: string;
  title: string;
  cover?: string;
  isLive: boolean;

  audioOnly?: boolean;

  position?: number;

  aspectW?: number;
  aspectH?: number;

  isLandscape?: boolean;

  web?: { headers?: Record<string, string>; volumeBoost?: number };

  backTo: {
    mode: 'live' | 'vod';
    playUrl: string;
    playLiveId?: string;
    playTitle?: string;
    playCover?: string;

    playPosition?: number;
  };
}

interface MiniPlayerState {
  info: MiniPlayerInfo | null;
  visible: boolean;
  playing: boolean;

  currentPos: number;

  sysToggleSeq: number;
  open: (info: MiniPlayerInfo) => void;
  close: () => void;
  setPlaying: (p: boolean) => void;
  setCurrentPos: (p: number) => void;
  requestSysToggle: () => void;
}

export const useMiniPlayerStore = create<MiniPlayerState>((set) => ({
  info: null,
  visible: false,
  playing: true,
  currentPos: 0,
  sysToggleSeq: 0,
  open: (info) => {
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
    const position = info.position;
    set({
      info,
      visible: true,
      playing: true,
      currentPos:
        !info.isLive && position != null && Number.isFinite(position) ? Math.max(0, position) : 0,
    });
  },
  close: () => set({ visible: false, info: null, currentPos: 0 }),
  setPlaying: (playing) => set({ playing }),
  setCurrentPos: (currentPos) => set({ currentPos }),
  requestSysToggle: () => set((s) => ({ sysToggleSeq: s.sysToggleSeq + 1 })),
}));
