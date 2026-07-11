import { create } from 'zustand';

export type PlayMode = 'sequential' | 'random' | 'single';
export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface Track {
  musicId?: string;
  id?: string;
  title: string;
  subTitle?: string;
  albumName?: string;
  joinMemberNames?: string;
  ctime?: number;
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

  // Actions
  setQueue: (tracks: Track[]) => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;
  play: (track: Track, queue?: Track[]) => void;
  setUrl: (url: string) => void;
  setPlaybackState: (state: PlaybackState) => void;
  setPlayMode: (mode: PlayMode) => void;
  setDuration: (d: number) => void;
  setPosition: (p: number) => void;
  setLyrics: (lines: LyricLine[]) => void;
  setError: (e: string | null) => void;
  next: () => Track | null;
  prev: () => Track | null;
}

function nextIndex(current: number, length: number, mode: PlayMode): number {
  if (length === 0) return -1;
  if (mode === 'single') return current;
  if (mode === 'random') return Math.floor(Math.random() * length);
  return (current + 1) % length;
}

export const useMusicPlayerStore = create<MusicPlayerState>((set, get) => ({
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
    const raw = track.thumbPath || track.cover || '';
    const cover = raw ? (raw.startsWith('http') ? raw : `https://source.48.cn${raw.startsWith('/') ? raw : '/' + raw}`) : '';
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

  setPlayMode: (playMode) => set({ playMode }),

  setDuration: (duration) => set({ duration }),

  setPosition: (position) => set({ position }),

  setLyrics: (lyrics) => set({ lyrics }),

  setError: (error) => set({ error, playbackState: error ? 'error' : 'idle' }),

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
}));
