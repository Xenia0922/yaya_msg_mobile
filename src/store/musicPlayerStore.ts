import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type PlayMode = 'sequential' | 'random' | 'single';
export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface Track {
  musicId?: string;
  id?: string;
  title: string;
  subTitle?: string;
  albumName?: string;
  joinMemberNames?: string;
  coverUrl?: string;
  cover?: string;
  thumbPath?: string;
  [key: string]: any;
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
  coverUrl: string;
  duration: number;
  position: number;
  // Lyrics
  lyrics: LyricLine[];
  // Error
  error: string | null;
  // 已下架/无效（服务端删除）的歌曲 id，用于列表中标注，避免用户以为「音乐不见了」
  failedIds: string[];
  // 收藏歌曲的 musicId 列表（持久化）
  favorites: string[];
  // 续播：记忆恢复后首次播放要跳到的进度（不持久化）
  pendingSeek: number | null;

  // Actions
  setQueue: (tracks: Track[]) => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;
  play: (track: Track, queue?: Track[]) => void;
  setUrl: (url: string) => void;
  setPlaybackState: (state: PlaybackState) => void;
  setMode: (mode: PlayMode) => void;
  setDuration: (d: number) => void;
  setPosition: (p: number) => void;
  setLyrics: (lines: LyricLine[]) => void;
  setError: (e: string | null) => void;
  addFailedId: (id: string) => void;
  setPendingSeek: (p: number | null) => void;
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

function coverFrom(track: Track): string {
  const raw = track.coverUrl || track.cover || track.thumbPath || '';
  if (!raw) return '';
  return raw.startsWith('http') ? raw : `https://source.48.cn${raw.startsWith('/') ? raw : '/' + raw}`;
}

export const useMusicPlayerStore = create<MusicPlayerState>()(
  persist(
    (set, get) => ({
      queue: [],
      currentIndex: -1,
      playbackState: 'idle',
      playMode: 'sequential',
      url: '',
      coverUrl: '',
      duration: 0,
      position: 0,
      lyrics: [],
      error: null,
      failedIds: [],
      favorites: [],
      pendingSeek: null,

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

      play: (track, queue) => set((s) => {
        const q = queue || s.queue;
        const idx = q.findIndex((t) => (t.musicId || t.id) === (track.musicId || track.id));
        const sameTrack = idx >= 0 && idx === s.currentIndex;
        const cover = coverFrom(track);
        return {
          queue: q,
          currentIndex: idx >= 0 ? idx : 0,
          playbackState: 'loading',
          url: '',
          coverUrl: cover || s.coverUrl,
          duration: sameTrack ? s.duration : 0,
          position: sameTrack ? s.position : 0,
          lyrics: s.lyrics,
          error: null,
        };
      }),

      setUrl: (url) => set({ url }),

      setPlaybackState: (playbackState) => set({ playbackState }),

      setMode: (playMode) => set({ playMode }),

      setDuration: (duration) => set({ duration }),

      setPosition: (position) => set({ position }),

      setLyrics: (lyrics) => set({ lyrics }),

      setError: (error) => set({ error, playbackState: error ? 'error' : 'idle' }),

      addFailedId: (id) => set((s) => (s.failedIds.includes(id) ? s : { failedIds: [...s.failedIds, id] })),

      setPendingSeek: (pendingSeek) => set({ pendingSeek }),

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
        set({ currentIndex: idx, duration: 0, position: 0, lyrics: [], error: null });
        return s.queue[idx] || null;
      },

      prev: () => {
        const s = get();
        if (s.queue.length === 0) return null;
        const idx = s.currentIndex <= 0 ? s.queue.length - 1 : s.currentIndex - 1;
        set({ currentIndex: idx, duration: 0, position: 0, lyrics: [], error: null });
        return s.queue[idx] || null;
      },
    }),
    {
      name: 'yaya_music_player_v1',
      storage: createJSONStorage(() => AsyncStorage),
      // 只持久化「记忆」所需的字段；url 是瞬时的不存，playbackState 由 onRehydrate 重设
      partialize: (s) => ({
        queue: s.queue,
        currentIndex: s.currentIndex,
        position: s.position,
        coverUrl: s.coverUrl,
        playMode: s.playMode,
        failedIds: s.failedIds,
        favorites: s.favorites,
        lyrics: s.lyrics,
        duration: s.duration,
      }),
      onRehydrateStorage: () => (state) => {
        // 记忆恢复后，若有当前曲目则显示迷你栏为「已暂停」态，等用户点播放续播
        if (state && state.currentIndex >= 0 && state.queue.length > 0) {
          useMusicPlayerStore.setState({ playbackState: 'paused' });
        }
      },
    },
  ),
);
