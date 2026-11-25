import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

const POS_STORAGE_KEY = 'yaya_music_pos_v1';
const RECENT_MAX = 80;

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
    timers.forEach((timer) => {
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

let posTimer: ReturnType<typeof setTimeout> | null = null;
let posPendingPayload: string | null = null;
let lastScheduledPos = -1;

function flushPositionStorage() {
  if (posTimer) {
    clearTimeout(posTimer);
    posTimer = null;
  }
  if (posPendingPayload !== null) {
    const payload = posPendingPayload;
    posPendingPayload = null;
    AsyncStorage.setItem(POS_STORAGE_KEY, payload).catch(() => {});
  }
}

function schedulePositionSave(trackId: string, pos: number, dur: number) {
  if (!trackId) return;
  posPendingPayload = JSON.stringify({
    id: trackId,
    pos: Math.max(0, Number(pos) || 0),
    dur: Math.max(0, Number(dur) || 0),
  });
  if (posTimer) return;
  posTimer = setTimeout(() => {
    posTimer = null;
    if (posPendingPayload !== null) {
      const payload = posPendingPayload;
      posPendingPayload = null;
      AsyncStorage.setItem(POS_STORAGE_KEY, payload).catch(() => {});
    }
  }, 3000);
}

export function flushMusicPlayerStorage() {
  throttleFlushRef?.();
  flushPositionStorage();
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
  duration?: number;
  durationSec?: number;
  trackNumber?: number;
  discNumber?: number;
  extra?: Record<string, unknown>;
}

export interface LyricLine {
  time: number;
  text: string;
}

export function trackIdentityKey(t: Track | null | undefined): string {
  if (!t) return '';
  return String(t.musicId || t.id || '').trim();
}

export function resolveTrackDurationSec(t: Track | null | undefined): number {
  if (!t) return 0;
  const ds = Number((t as any).durationSec);
  if (Number.isFinite(ds) && ds > 0) return ds;
  const raw = (t as any).duration;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  const s = String(raw || '').trim();
  if (!s) return 0;
  if (/^\d+(?:\.\d+)?$/.test(s)) return Math.max(0, Number(s) || 0);
  const parts = s.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

export function insertTrackNextInQueue(
  queue: Track[],
  currentIndex: number,
  track: Track,
): { queue: Track[]; currentIndex: number } {
  const key = trackIdentityKey(track);
  if (!key) return { queue, currentIndex };
  if (queue.length === 0 || currentIndex < 0 || currentIndex >= queue.length) {
    if (queue.some((t) => trackIdentityKey(t) === key)) return { queue, currentIndex };
    return { queue: [track, ...queue], currentIndex: queue.length > 0 ? currentIndex : 0 };
  }
  const existingIdx = queue.findIndex((t) => trackIdentityKey(t) === key);
  if (existingIdx === currentIndex) {
    return { queue, currentIndex };
  }
  const nextQueue = [...queue];
  let adjIdx = currentIndex;
  if (existingIdx >= 0) {
    nextQueue.splice(existingIdx, 1);
    if (existingIdx < adjIdx) adjIdx -= 1;
  }
  nextQueue.splice(adjIdx + 1, 0, track);
  return { queue: nextQueue, currentIndex: adjIdx };
}

export function appendRecentTrackId(recentIds: string[], id: string, max = RECENT_MAX): string[] {
  const clean = String(id || '').trim();
  if (!clean) return recentIds;
  return [clean, ...recentIds.filter((x) => x !== clean)].slice(0, max);
}

interface MusicPlayerState {
  queue: Track[];
  currentIndex: number;

  playbackState: PlaybackState;
  playMode: PlayMode;

  url: string;
  duration: number;
  position: number;
  buffered: number;
  buffering: boolean;
  speed: number;

  sleepTimerEndAt: number | null;
  sleepAfterTrack: boolean;

  recentIds: string[];

  miniBarDismissed: boolean;
  sessionActivated: boolean;

  fullScreenOpen: boolean;
  fullScreenInitialSheet: 'none' | 'queue';

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
  insertNextInQueue: (track: Track) => void;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;

  play: (track: Track, queue?: Track[], keepPosition?: boolean) => void;
  setUrl: (url: string) => void;
  setPlaybackState: (state: PlaybackState) => void;
  dismissMiniBar: () => void;
  restoreMiniBar: () => void;
  setMode: (mode: PlayMode) => void;
  setDuration: (d: number) => void;
  setPosition: (p: number) => void;
  setBuffered: (b: number) => void;
  setBuffering: (b: boolean) => void;
  setSpeed: (s: number) => void;
  setSleepTimer: (minutes: number | null) => void;
  setSleepAfterTrack: (v: boolean) => void;
  clearSleepTimer: () => void;
  recordRecent: (track: Track) => void;
  openFullScreen: (sheet?: 'none' | 'queue') => void;
  closeFullScreen: () => void;
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
      buffered: 0,
      buffering: false,
      speed: 1.0,
      sleepTimerEndAt: null,
      sleepAfterTrack: false,
      recentIds: [],
      miniBarDismissed: false,
      sessionActivated: false,
      fullScreenOpen: false,
      fullScreenInitialSheet: 'none',
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
          if (s.queue.find((t) => trackIdentityKey(t) === trackIdentityKey(track))) return s;
          return { queue: [...s.queue, track] };
        }),

      insertNextInQueue: (track) =>
        set((s) => {
          const next = insertTrackNextInQueue(s.queue, s.currentIndex, track);
          return next.queue === s.queue && next.currentIndex === s.currentIndex ? s : next;
        }),

      removeFromQueue: (id) =>
        set((s) => {
          const removedIdx = s.queue.findIndex((t) => trackIdentityKey(t) === String(id));
          const newQueue = s.queue.filter((t) => trackIdentityKey(t) !== String(id));
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
          buffered: 0,
          buffering: false,
          seekTarget: 0,
          seekPending: false,
          seekTargetGuard: 0,
          seekIssuedAt: 0,
          fullScreenOpen: false,
          fullScreenInitialSheet: 'none',
        });
        posPendingPayload = JSON.stringify({ id: '', pos: 0, dur: 0 });
        flushMusicPlayerStorage();
      },

      play: (track, queue, keepPosition = false) => {
        set((s) => {
          const q = queue || s.queue;
          const tKey = trackIdentityKey(track);
          const idx = q.findIndex((t) => trackIdentityKey(t) === tKey);
          const resumePos =
            keepPosition && idx === s.currentIndex && s.position > 0 ? s.position : 0;
          const metaDur = resolveTrackDurationSec(track);
          const seededDur = resumePos > 0 && s.duration > 0 ? s.duration : metaDur;
          lastScheduledPos = resumePos;
          if (tKey) schedulePositionSave(tKey, resumePos, seededDur);
          return {
            queue: q,
            currentIndex: idx >= 0 ? idx : 0,
            playbackState: 'loading',
            sessionActivated: true,
            miniBarDismissed: false,
            url: s.url,
            duration: seededDur,
            position: resumePos,
            buffered: 0,
            buffering: true,
            lyrics: [],
            error: null,
            recentIds: appendRecentTrackId(s.recentIds, tKey),
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
        const s = get();
        set({
          playbackState,
          ...(playbackState === 'playing' || playbackState === 'loading'
            ? { sessionActivated: true }
            : playbackState === 'idle'
              ? { sessionActivated: false }
              : null),
          ...(playbackState !== 'loading' ? { buffering: false } : null),
          ...(playbackState === 'playing' && s.seekPending && s.seekTarget > 0
            ? { seekIssuedAt: Date.now(), seekTargetGuard: s.seekTarget, seekFrom: s.position }
            : null),
        });

        if (playbackState === 'paused' || playbackState === 'idle') {
          const cur = s.queue[s.currentIndex];
          const curKey = trackIdentityKey(cur);
          if (curKey) schedulePositionSave(curKey, s.position, s.duration);
          flushMusicPlayerStorage();
        }
      },

      dismissMiniBar: () => set({ miniBarDismissed: true }),
      restoreMiniBar: () => set({ miniBarDismissed: false }),

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
        const curKey = trackIdentityKey(s.queue[s.currentIndex]);
        if (guardActive) {
          const target = s.seekTargetGuard;
          const dNow = Math.abs(position - target);
          const dFrom = Math.abs(s.seekFrom - target) + 0.3;
          if (dNow > dFrom) return;
          set({
            position,
            ...(!s.seekPending && dNow <= 1.2 ? { seekIssuedAt: 0 } : null),
          });
          if (curKey && Math.abs(position - lastScheduledPos) >= 1) {
            lastScheduledPos = position;
            schedulePositionSave(curKey, position, s.duration);
          }
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
        if (curKey && Math.abs(position - lastScheduledPos) >= 1) {
          lastScheduledPos = position;
          schedulePositionSave(curKey, position, s.duration);
        }
      },

      setBuffered: (buffered) => {
        const s = get();
        const safe = Number.isFinite(buffered) && buffered >= 0 ? buffered : 0;
        if (Math.abs(safe - s.buffered) < 0.5) return;
        set({ buffered: safe });
      },

      setBuffering: (buffering) => {
        if (get().buffering === !!buffering) return;
        set({ buffering: !!buffering });
      },

      setSpeed: (speed) => {
        const clamped = Math.max(0.5, Math.min(2.0, Math.round((Number(speed) || 1) * 100) / 100));
        set({ speed: clamped });
      },

      setSleepTimer: (minutes) =>
        set({
          sleepTimerEndAt: minutes && minutes > 0 ? Date.now() + minutes * 60_000 : null,
          sleepAfterTrack: false,
        }),

      setSleepAfterTrack: (v) =>
        set({
          sleepAfterTrack: !!v,
          ...(v ? { sleepTimerEndAt: null } : null),
        }),

      clearSleepTimer: () => set({ sleepTimerEndAt: null, sleepAfterTrack: false }),

      recordRecent: (track) =>
        set((s) => {
          const key = trackIdentityKey(track);
          if (!key) return s;
          return { recentIds: appendRecentTrackId(s.recentIds, key) };
        }),

      openFullScreen: (sheet = 'none') =>
        set({ fullScreenOpen: true, fullScreenInitialSheet: sheet }),

      closeFullScreen: () => set({ fullScreenOpen: false, fullScreenInitialSheet: 'none' }),

      setLyrics: (lyrics) => set({ lyrics }),

      setError: (error) =>
        set({ error, playbackState: error ? 'error' : 'idle', buffering: false }),

      setSeekTarget: (seekTarget) => {
        const s = get();
        const curKey = trackIdentityKey(s.queue[s.currentIndex]);
        set({
          seekTarget,
          seekPending: true,
          seekTargetGuard: seekTarget,
          seekNonce: s.seekNonce + 1,
          seekFrom: s.position,
          seekIssuedAt: Date.now(),
          position: seekTarget >= 0 ? seekTarget : s.position,
        });
        if (curKey && seekTarget >= 0) {
          lastScheduledPos = seekTarget;
          schedulePositionSave(curKey, seekTarget, s.duration);
        }
        if (s.playbackState !== 'playing') flushMusicPlayerStorage();
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

        const t = track || get().queue.find((x) => trackIdentityKey(x) === String(id));
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
          const t = track || s.queue.find((x) => trackIdentityKey(x) === String(id));
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
        lastScheduledPos = 0;
        const nextTrack = s.queue[idx] || null;
        set({
          currentIndex: idx,
          sessionActivated: true,
          duration: resolveTrackDurationSec(nextTrack),
          position: 0,
          buffered: 0,
          buffering: true,
          lyrics: [],
          error: null,
          seekTarget: 0,
          seekPending: false,
          seekTargetGuard: 0,
          seekIssuedAt: 0,
        });
        flushMusicPlayerStorage();
        return nextTrack;
      },

      prev: () => {
        const s = get();
        if (s.queue.length === 0) return null;
        const idx = s.currentIndex <= 0 ? s.queue.length - 1 : s.currentIndex - 1;
        lastScheduledPos = 0;
        const prevTrack = s.queue[idx] || null;
        set({
          currentIndex: idx,
          sessionActivated: true,
          duration: resolveTrackDurationSec(prevTrack),
          position: 0,
          buffered: 0,
          buffering: true,
          lyrics: [],
          error: null,
          seekTarget: 0,
          seekPending: false,
          seekTargetGuard: 0,
          seekIssuedAt: 0,
        });
        flushMusicPlayerStorage();
        return prevTrack;
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
        playMode: s.playMode,
        favorites: s.favorites,
        speed: s.speed,
        recentIds: s.recentIds,
        duration: s.duration,
      }),
      onRehydrateStorage: () => (state) => {
        if (state && state.currentIndex >= 0 && state.queue.length > 0) {
          const legacyPos = Number(state.position) || 0;
          useMusicPlayerStore.setState({
            playbackState: 'paused',
            miniBarDismissed: false,
            sessionActivated: false,
            buffering: false,
            buffered: 0,
            ...(legacyPos > 0
              ? {
                  position: legacyPos,
                  seekTarget: legacyPos,
                  seekPending: true,
                  seekTargetGuard: legacyPos,
                  seekFrom: legacyPos,
                  seekIssuedAt: Date.now(),
                }
              : {
                  seekTarget: 0,
                  seekPending: false,
                  seekTargetGuard: 0,
                  seekIssuedAt: 0,
                }),
          });
          const curTrack = state.queue[state.currentIndex];
          const curId = trackIdentityKey(curTrack);
          if (curId) {
            AsyncStorage.getItem(POS_STORAGE_KEY)
              .then((raw) => {
                if (!raw) return;
                const saved = JSON.parse(raw);
                if (!saved || String(saved.id || '') !== curId) return;
                const pos = Number(saved.pos) || 0;
                const dur = Number(saved.dur) || 0;
                const curNow = useMusicPlayerStore.getState();
                if (curNow.url && curNow.playbackState === 'playing') return;
                if (trackIdentityKey(curNow.queue[curNow.currentIndex]) !== curId) return;
                if (pos > 0 && curNow.playbackState !== 'playing') {
                  lastScheduledPos = pos;
                  useMusicPlayerStore.setState({
                    position: pos,
                    ...(dur > 0 && curNow.duration <= 0 ? { duration: dur } : null),
                    seekTarget: pos,
                    seekPending: true,
                    seekTargetGuard: pos,
                    seekNonce: curNow.seekNonce + 1,
                    seekFrom: pos,
                    seekIssuedAt: Date.now(),
                  });
                }
              })
              .catch(() => {});
          }
        }
      },
    },
  ),
);
