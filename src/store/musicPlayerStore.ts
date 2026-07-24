import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type PlayMode = 'sequential' | 'random' | 'single';
export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

/**
 * 精简后的曲目接口：不再包含 [key: string]: any。
 * 封面由 CoverArt 内部自决 raw 字段（coverUrl / cover / thumbPath），store 不参与拼 URL。
 */
export interface Track {
  musicId?: string;
  id?: string;
  title: string;
  subTitle?: string;
  albumName?: string;
  album?: string;
  joinMemberNames?: string;
  artist?: string;
  coverUrl?: string;
  cover?: string;
  thumbPath?: string;
  groupLabel?: string;
  mp3?: string;
  /** 其他字段（音轨/时长等）通过此兜底保留但不用 any 污染索引 */
  extra?: Record<string, unknown>;
}

export interface LyricLine {
  time: number;
  text: string;
}

interface MusicPlayerState {
  // Track list
  queue: Track[];
  currentIndex: number;
  // Playback
  playbackState: PlaybackState;
  playMode: PlayMode;
  // Timing
  url: string;
  duration: number;
  position: number;
  // Lyrics
  lyrics: LyricLine[];
  // Error
  error: string | null;
  // Favorites (persisted)
  favorites: string[];
  /**
   * Seek 指令：组件写，Video onLoad / effect 检测后执行 seek 并清零。
   * 不持久化（持久化 seek 位置通过 position 字段实现）。
   */
  seekTarget: number;

  // Actions
  setQueue: (tracks: Track[]) => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;
  /** 载入曲目到队列并置为 loading 态（不自动播放）。URL 由 MusicEngine 异步解析后 setUrl。 */
  play: (track: Track, queue?: Track[]) => void;
  setUrl: (url: string) => void;
  setPlaybackState: (state: PlaybackState) => void;
  setMode: (mode: PlayMode) => void;
  setDuration: (d: number) => void;
  setPosition: (p: number) => void;
  setLyrics: (lines: LyricLine[]) => void;
  setError: (e: string | null) => void;
  setSeekTarget: (t: number) => void;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  next: () => Track | null;
  prev: () => Track | null;
}

function nextIndex(current: number, length: number, mode: PlayMode): number {
  if (length === 0) return -1;
  if (mode === 'single') return current;
  if (mode === 'random') return Math.floor(Math.random() * length);
  return (current + 1) % length;
}

export const useMusicPlayerStore = create<MusicPlayerState>()(
  persist(
    (set, get) => ({
      queue: [],
      currentIndex: -1,
      playbackState: 'idle',
      playMode: 'sequential',
      url: '',
      duration: 0,
      position: 0,
      lyrics: [],
      error: null,
      favorites: [],
      seekTarget: 0,

      setQueue: (tracks) => set({ queue: tracks, currentIndex: tracks.length > 0 ? 0 : -1 }),

      addToQueue: (track) => set((s) => {
        if (s.queue.find((t) => (t.musicId || t.id) === (track.musicId || track.id))) return s;
        return { queue: [...s.queue, track] };
      }),

      removeFromQueue: (id) => set((s) => {
        const removedIdx = s.queue.findIndex((t) => (t.musicId || t.id) === id);
        const newQueue = s.queue.filter((t) => (t.musicId || t.id) !== id);
        let newIdx = s.currentIndex;
        if (removedIdx >= 0 && removedIdx < s.currentIndex) newIdx = s.currentIndex - 1;
        else if (removedIdx === s.currentIndex) newIdx = newQueue.length > 0 ? Math.min(s.currentIndex, newQueue.length - 1) : -1;
        return { queue: newQueue, currentIndex: newIdx };
      }),

      clearQueue: () => set({ queue: [], currentIndex: -1 }),

      /**
       * 载入曲目到队列并置为 loading 态，但不写 url —— url 由 MusicEngine 异步解析后
       * 通过 setUrl 单独写入，从而避免 Video 经历 url:'' → url:http 的 source 翻转。
       */
      play: (track, queue) => set((s) => {
        const q = queue || s.queue;
        const idx = q.findIndex((t) => (t.musicId || t.id) === (track.musicId || track.id));
        return {
          queue: q,
          currentIndex: idx >= 0 ? idx : 0,
          playbackState: 'loading',
          url: '',            // 暂空，等 setUrl 写入后 Video 挂载一次即稳定
          duration: 0,
          position: 0,
          lyrics: [],
          error: null,
          seekTarget: 0,
        };
      }),

      setUrl: (url) => set({ url }),

      setPlaybackState: (playbackState) => set({ playbackState }),

      setMode: (playMode) => set({ playMode }),

      setDuration: (duration) => set({ duration }),

      setPosition: (position) => set({ position }),

      setLyrics: (lyrics) => set({ lyrics }),

      setError: (error) => set({ error, playbackState: error ? 'error' : 'idle' }),

      setSeekTarget: (seekTarget) => set({ seekTarget }),

      isFavorite: (id) => get().favorites.includes(id),

      toggleFavorite: (id) => set((s) => {
        if (!id) return s;
        if (s.favorites.includes(id)) {
          return { favorites: s.favorites.filter((f) => f !== id) };
        }
        return { favorites: [...s.favorites, id] };
      }),

      next: () => {
        const s = get();
        if (s.queue.length === 0) return null;
        const idx = nextIndex(s.currentIndex, s.queue.length, s.playMode);
        set({ currentIndex: idx, duration: 0, position: 0, lyrics: [], error: null, seekTarget: 0 });
        return s.queue[idx] || null;
      },

      prev: () => {
        const s = get();
        if (s.queue.length === 0) return null;
        const idx = s.currentIndex <= 0 ? s.queue.length - 1 : s.currentIndex - 1;
        set({ currentIndex: idx, duration: 0, position: 0, lyrics: [], error: null, seekTarget: 0 });
        return s.queue[idx] || null;
      },
    }),
    {
      name: 'yaya_music_player_v2',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        queue: s.queue,
        currentIndex: s.currentIndex,
        position: s.position,
        playMode: s.playMode,
        favorites: s.favorites,
        lyrics: s.lyrics,
        duration: s.duration,
      }),
      onRehydrateStorage: () => (state) => {
        if (state && state.currentIndex >= 0 && state.queue.length > 0) {
          useMusicPlayerStore.setState({ playbackState: 'paused' });
        }
      },
    },
  ),
);