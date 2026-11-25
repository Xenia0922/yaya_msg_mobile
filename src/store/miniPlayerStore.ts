import { create } from 'zustand';
import type { Member } from '../types';
import {
  claimAudioFocus,
  registerAudioHandler,
  releaseAudioFocus,
  setRadioForegroundActive,
} from '../services/audioFocus';

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

  radioRefresh?: {
    member: Member;
    mode: 'big' | 'small';
  };

  backTo: {
    screen?: 'Media' | 'RoomRadioScreen' | 'BilibiliLiveScreen';
    mode: 'live' | 'vod';
    playUrl: string;
    playLiveId?: string;
    playTitle?: string;
    playCover?: string;

    playPosition?: number;
    radioMember?: Member;
    radioMode?: 'big' | 'small';
    biliRoomId?: string;
    biliRoomName?: string;
  };
}

interface MiniPlayerState {
  info: MiniPlayerInfo | null;
  visible: boolean;
  playing: boolean;

  currentPos: number;

  sysToggleSeq: number;
  open: (info: MiniPlayerInfo) => void;
  updateUrl: (url: string) => void;
  close: () => void;
  setPlaying: (p: boolean) => void;
  setCurrentPos: (p: number) => void;
  requestSysToggle: () => void;
}

export const useMiniPlayerStore = create<MiniPlayerState>((set, get) => ({
  info: null,
  visible: false,
  playing: true,
  currentPos: 0,
  sysToggleSeq: 0,
  open: (info) => {
    try {
      claimAudioFocus('mini');
      setRadioForegroundActive(Boolean(info.audioOnly && info.radioRefresh));
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
  updateUrl: (url) =>
    set((s) => {
      if (!s.info || !url || s.info.url === url) return s;
      return {
        info: {
          ...s.info,
          url,
          backTo: { ...s.info.backTo, playUrl: url },
        },
      };
    }),
  close: () => {
    const hadRadio = Boolean(get?.()?.info?.audioOnly && get?.()?.info?.radioRefresh);
    try {
      if (hadRadio) setRadioForegroundActive(false);
      releaseAudioFocus('mini');
    } catch {}
    set({ visible: false, info: null, currentPos: 0 });
  },
  setPlaying: (playing) => {
    const cur = get?.();
    if (playing && cur?.visible) {
      try {
        claimAudioFocus('mini');
        if (cur.info?.audioOnly && cur.info?.radioRefresh) {
          setRadioForegroundActive(true);
        }
      } catch {}
    } else if (!playing && cur?.info?.audioOnly && cur?.info?.radioRefresh) {
      try {
        setRadioForegroundActive(false);
      } catch {}
    }
    set({ playing });
  },
  setCurrentPos: (currentPos) => set({ currentPos }),
  requestSysToggle: () => set((s) => ({ sysToggleSeq: s.sysToggleSeq + 1 })),
}));

try {
  registerAudioHandler('mini', (reason) => {
    const st = useMiniPlayerStore.getState();
    if (!st.visible) return;
    if (reason === 'voice') st.setPlaying(false);
    else st.close();
  });
} catch {}
