import { create } from 'zustand';

/** 应用内悬浮小窗播放信息 */
export interface MiniPlayerInfo {
  url: string;
  title: string;
  cover?: string;
  isLive: boolean;
  /** 交棒给小窗时的播放位置（秒），小窗 onLoad 后 seek 续播 */
  position?: number;
  /** 点击小窗回放（全屏）参数：直接传回 MediaScreen 路由参数 */
  backTo: {
    mode: 'live' | 'vod';
    playUrl: string;
    playTitle?: string;
    playCover?: string;
  };
}

interface MiniPlayerState {
  info: MiniPlayerInfo | null;
  visible: boolean;
  playing: boolean;
  open: (info: MiniPlayerInfo) => void;
  close: () => void;
  setPlaying: (p: boolean) => void;
}

export const useMiniPlayerStore = create<MiniPlayerState>((set) => ({
  info: null,
  visible: false,
  playing: true,
  open: (info) => set({ info, visible: true, playing: true }),
  close: () => set({ visible: false, info: null }),
  setPlaying: (playing) => set({ playing }),
}));
