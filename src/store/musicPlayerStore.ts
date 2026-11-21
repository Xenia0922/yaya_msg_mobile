import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

function createThrottleStorage(
  storage: {
    getItem: (name: string) => Promise<string | null>;
    setItem: (name: string, value: string) => Promise<void>;
    removeItem: (name: string) => Promise<void>;
  },
  ms = 2500,
) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, string>();
  const flushAll = () => {
    timers.forEach((timer, _name) => {
      clearTimeout(timer);
    });
    timers.clear();
    pending.forEach((v, name) => {
      pending.delete(name);
      storage.setItem(name, v).catch(() => {});
    });
  };
  return {
    getItem: (name: string) => storage.getItem(name),
    setItem: (name: string, value: string) => {
      pending.set(name, value);
      if (!timers.has(name)) {
        timers.set(
          name,
          setTimeout(() => {
            timers.delete(name);
            const v = pending.get(name);
            pending.delete(name);
            if (v !== undefined) storage.setItem(name, v).catch(() => {});
          }, ms),
        );
      }
    },
    removeItem: (name: string) => {
      pending.delete(name);
      const timer = timers.get(name);
      if (timer) {
        clearTimeout(timer);
        timers.delete(name);
      }
      return storage.removeItem(name);
    },

    flushAll,
  };
}

export function flushMusicPlayerStorage() {
  throttleFlushRef?.();
}
let throttleFlushRef: (() => void) | null = null;

export type PlayMode = 'sequential' | 'random' | 'single';
export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

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

  extra?: Record<string, unknown>;
}

export interface LyricLine {
  time: number;
  text: string;
}

interface MusicPlayerState {
  queue: Track[];
  currentIndex: number;

  playbackState: PlaybackState;
  playMode: PlayMode;

  url: string;
  duration: number;
  position: number;

  lyrics: LyricLine[];

  error: string | null;

  favorites: string[];

  seekTarget: number;
  seekPending: boolean;
  seekTargetGuard: number;
  seekNonce: number;

  seekFrom: number;
  seekIssuedAt: number;

  setQueue: (tracks: Track[]) => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;

  play: (track: Track, queue?: Track[], keepPosition?: boolean) => void;
  setUrl: (url: string) => void;
  setPlaybackState: (state: PlaybackState) => void;
  setMode: (mode: PlayMode) => void;
  setDuration: (d: number) => void;
  setPosition: (p: number) => void;
  setLyrics: (lines: LyricLine[]) => void;
  setError: (e: string | null) => void;
  setSeekTarget: (t: number) => void;
  consumeSeekTarget: () => void;
  refreshSeekGuard: () => void;
  isFavorite: (id: string, track?: any) => boolean;
  toggleFavorite: (id: string, track?: any) => void;
  next: () => Track | null;
  prev: () => Track | null;
}

function nextIndex(current: number, length: number, mode: PlayMode): number {
  if (length === 0) return -1;
  if (mode === 'single') return current;
  if (mode === 'random') {
    if (length <= 1) return current;
    let n = Math.floor(Math.random() * (length - 1));
    if (n >= current) n += 1;
    return n;
  }
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
      seekPending: false,
      seekTargetGuard: 0,
      seekNonce: 0,
      seekFrom: 0,
      seekIssuedAt: 0,

      setQueue: (tracks) => set({ queue: tracks, currentIndex: tracks.length > 0 ? 0 : -1 }),

      addToQueue: (track) =>
        set((s) => {
          if (s.queue.find((t) => String(t.musicId || t.id) === String(track.musicId || track.id)))
            return s;
          return { queue: [...s.queue, track] };
        }),

      removeFromQueue: (id) =>
        set((s) => {
          const removedIdx = s.queue.findIndex((t) => String(t.musicId || t.id) === String(id));
          const newQueue = s.queue.filter((t) => String(t.musicId || t.id) !== String(id));
          let newIdx = s.currentIndex;
          if (removedIdx >= 0 && removedIdx < s.currentIndex) newIdx = s.currentIndex - 1;
          else if (removedIdx === s.currentIndex)
            newIdx = newQueue.length > 0 ? Math.min(s.currentIndex, newQueue.length - 1) : -1;
          return { queue: newQueue, currentIndex: newIdx };
        }),

      clearQueue: () => {
        set({
          queue: [],
          currentIndex: -1,
          position: 0,
          duration: 0,
          seekTarget: 0,
          seekPending: false,
          seekTargetGuard: 0,
          seekIssuedAt: 0,
        });
        flushMusicPlayerStorage();
      },

      play: (track, queue, keepPosition = false) => {
        set((s) => {
          const q = queue || s.queue;
          const idx = q.findIndex(
            (t) => String(t.musicId || t.id) === String(track.musicId || track.id),
          );
          const resumePos =
            keepPosition && idx === s.currentIndex && s.position > 0 ? s.position : 0;
          return {
            queue: q,
            currentIndex: idx >= 0 ? idx : 0,
            playbackState: 'loading',
            url: s.url,
            duration: resumePos > 0 ? s.duration : 0,
            position: resumePos,
            lyrics: [],
            error: null,
            seekTarget: resumePos,
            seekPending: resumePos > 0,
            seekTargetGuard: resumePos,
            seekNonce: resumePos > 0 ? s.seekNonce + 1 : s.seekNonce,
            seekFrom: s.position,
            seekIssuedAt: resumePos > 0 ? Date.now() : 0,
          };
        });
        flushMusicPlayerStorage();
      },

      setUrl: (url) =>
        set((s) => ({
          url,
          ...(s.seekPending && s.seekTarget > 0
            ? { seekIssuedAt: Date.now(), seekTargetGuard: s.seekTarget, seekFrom: s.position }
            : null),
        })),

      setPlaybackState: (playbackState) => {
        set((s) => ({
          playbackState,
          ...(playbackState === 'playing' && s.seekPending && s.seekTarget > 0
            ? { seekIssuedAt: Date.now(), seekTargetGuard: s.seekTarget, seekFrom: s.position }
            : null),
        }));

        if (playbackState === 'paused' || playbackState === 'idle') flushMusicPlayerStorage();
      },

      setMode: (playMode) => set({ playMode }),

      setDuration: (duration) => {
        if (Math.abs(Number(get().duration) - Number(duration)) < 0.5) return;
        set({ duration });
      },

      setPosition: (position) => {
        const s = get();
        if (!Number.isFinite(position) || position < 0 || position === s.position) return;
        const GUARD_MS = 3000;
        const guardActive =
          s.seekPending || (s.seekIssuedAt > 0 && Date.now() - s.seekIssuedAt < GUARD_MS);
        if (guardActive) {
          const target = s.seekTargetGuard;
          const dNow = Math.abs(position - target);
          const dFrom = Math.abs(s.seekFrom - target) + 0.3;
          if (dNow > dFrom) return;
          set({
            position,
            ...(!s.seekPending && dNow <= 1.2 ? { seekIssuedAt: 0 } : null),
          });
          return;
        }

        const naturalSingleLoop =
          s.playMode === 'single' &&
          s.duration > 0 &&
          s.position >= s.duration - 3 &&
          position <= 2;
        if (
          Number.isFinite(position) &&
          s.position - position > 0.5 &&
          s.playbackState !== 'idle' &&
          !naturalSingleLoop
        )
          return;
        set({ position });
      },

      setLyrics: (lyrics) => set({ lyrics }),

      setError: (error) => set({ error, playbackState: error ? 'error' : 'idle' }),

      setSeekTarget: (seekTarget) => {
        const prevState = get().playbackState;
        set((s) => ({
          seekTarget,
          seekPending: true,
          seekTargetGuard: seekTarget,
          seekNonce: s.seekNonce + 1,
          seekFrom: s.position,
          seekIssuedAt: Date.now(),

          position: seekTarget >= 0 ? seekTarget : s.position,
        }));
        if (prevState !== 'playing') flushMusicPlayerStorage();
      },

      consumeSeekTarget: () => set({ seekTarget: 0, seekPending: false }),
      refreshSeekGuard: () =>
        set((s) =>
          s.seekPending && s.seekTarget > 0
            ? { seekIssuedAt: Date.now(), seekTargetGuard: s.seekTarget, seekFrom: s.position }
            : s,
        ),

      isFavorite: (id, track) => {
        const f = get().favorites;
        if (f.includes(id)) return true;

        const t = track || get().queue.find((x) => String(x.musicId || x.id) === String(id));
        if (t) {
          const k2 = `${String(t.title || '').trim()}|${String(t.artist || '').trim()}`.trim();
          const k3 = `${k2}|${String(t.album || '').trim()}`.trim();
          if (k3 !== '||' && f.includes(k3)) return true;
          if (k2 !== '|' && f.includes(k2)) return true;
        }
        return false;
      },

      toggleFavorite: (id, track) =>
        set((s) => {
          if (!id) return s;
          const t = track || s.queue.find((x) => String(x.musicId || x.id) === String(id));
          if (t) {
            const k2 = `${String(t.title || '').trim()}|${String(t.artist || '').trim()}`.trim();
            const k3 = `${k2}|${String(t.album || '').trim()}`.trim();
            const hasK3 = k3 !== '||' && s.favorites.includes(k3);
            const hasK2 = k2 !== '|' && s.favorites.includes(k2);
            const hasId = s.favorites.includes(id);
            if (hasK3) {
              return { favorites: s.favorites.filter((f) => f !== k3) };
            }
            if (hasId || hasK2) {
              const rest = s.favorites.filter((f) => f !== id && f !== k2);
              return { favorites: [...rest, k3 !== '||' ? k3 : id] };
            }

            return { favorites: [...s.favorites, k3 !== '||' ? k3 : k2 !== '|' ? k2 : id] };
          }

          if (s.favorites.includes(id)) return { favorites: s.favorites.filter((f) => f !== id) };
          return { favorites: [...s.favorites, id] };
        }),

      next: () => {
        const s = get();
        if (s.queue.length === 0) return null;
        const idx = nextIndex(s.currentIndex, s.queue.length, s.playMode);
        set({
          currentIndex: idx,
          duration: 0,
          position: 0,
          lyrics: [],
          error: null,
          seekTarget: 0,
          seekPending: false,
          seekTargetGuard: 0,
          seekIssuedAt: 0,
        });
        flushMusicPlayerStorage();
        return s.queue[idx] || null;
      },

      prev: () => {
        const s = get();
        if (s.queue.length === 0) return null;
        const idx = s.currentIndex <= 0 ? s.queue.length - 1 : s.currentIndex - 1;
        set({
          currentIndex: idx,
          duration: 0,
          position: 0,
          lyrics: [],
          error: null,
          seekTarget: 0,
          seekPending: false,
          seekTargetGuard: 0,
          seekIssuedAt: 0,
        });
        flushMusicPlayerStorage();
        return s.queue[idx] || null;
      },
    }),
    {
      name: 'yaya_music_player_v2',
      storage: createJSONStorage(() => {
        const store = createThrottleStorage(AsyncStorage);
        throttleFlushRef = store.flushAll;
        return store;
      }),
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
          const pos = Number(state.position) || 0;
          useMusicPlayerStore.setState({
            playbackState: 'paused',
            ...(pos > 0
              ? {
                  position: pos,
                  seekTarget: pos,
                  seekPending: true,
                  seekTargetGuard: pos,
                  seekNonce: 1,
                  seekFrom: pos,
                  seekIssuedAt: Date.now(),
                }
              : {
                  seekTarget: 0,
                  seekPending: false,
                  seekTargetGuard: 0,
                  seekIssuedAt: 0,
                }),
          });
        }
      },
    },
  ),
);
