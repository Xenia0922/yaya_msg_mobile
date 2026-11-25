import { create } from 'zustand';
import { nextVoiceRate, type VoiceRate } from '../utils/voiceBar';

const MAX_CACHE_URLS = 100;

function trimUrlRecord(record: Record<string, number>): Record<string, number> {
  const keys = Object.keys(record);
  if (keys.length <= MAX_CACHE_URLS) return record;
  const trimmed: Record<string, number> = {};
  const start = keys.length - MAX_CACHE_URLS;
  for (let i = start; i < keys.length; i += 1) {
    trimmed[keys[i]] = record[keys[i]];
  }
  return trimmed;
}

interface VoicePlayerState {
  url: string;
  playing: boolean;
  buffering: boolean;
  ended: boolean;
  position: number;
  duration: number;
  rate: VoiceRate;
  error: string;
  seekSeq: number;
  seekTarget: number;
  retrySeq: number;
  positionsByUrl: Record<string, number>;
  durationsByUrl: Record<string, number>;

  toggle: (url: string, hintDuration?: number) => void;
  seek: (url: string, seconds: number, hintDuration?: number) => void;
  cycleRate: () => void;
  stop: () => void;
  onLoaded: (url: string, dur: number) => void;
  onProgress: (url: string, pos: number) => void;
  onBuffering: (url: string, buffering: boolean) => void;
  onEnded: (url: string) => void;
  onError: (url: string, msg: string) => void;
  rememberDuration: (url: string, dur: number) => void;
}

export const useVoicePlayerStore = create<VoicePlayerState>((set, get) => ({
  url: '',
  playing: false,
  buffering: false,
  ended: false,
  position: 0,
  duration: 0,
  rate: 1,
  error: '',
  seekSeq: 0,
  seekTarget: 0,
  retrySeq: 0,
  positionsByUrl: {},
  durationsByUrl: {},

  toggle: (nextUrl, hintDuration = 0) => {
    const cleanUrl = String(nextUrl || '').trim();
    if (!cleanUrl) return;
    const state = get();
    if (state.url === cleanUrl) {
      if (state.error) {
        const resumePos = state.positionsByUrl[cleanUrl] ?? state.position ?? 0;
        set({
          playing: true,
          buffering: true,
          ended: false,
          error: '',
          seekTarget: resumePos > 0.2 ? resumePos : 0,
          seekSeq: state.seekSeq + 1,
          retrySeq: state.retrySeq + 1,
        });
        return;
      }
      if (!state.playing && state.ended) {
        set({
          playing: true,
          ended: false,
          position: 0,
          seekTarget: 0,
          seekSeq: state.seekSeq + 1,
          error: '',
        });
        return;
      }
      const nextPlaying = !state.playing;
      const nextPositions =
        !nextPlaying && state.position > 0
          ? trimUrlRecord({ ...state.positionsByUrl, [cleanUrl]: state.position })
          : state.positionsByUrl;
      set({
        playing: nextPlaying,
        ended: false,
        error: '',
        positionsByUrl: nextPositions,
      });
      return;
    }

    const nextPositions = { ...state.positionsByUrl };
    if (state.url && state.position > 0) {
      nextPositions[state.url] = state.position;
    }
    const savedPos = nextPositions[cleanUrl] || 0;
    const savedDur = state.durationsByUrl[cleanUrl] || 0;
    const effectiveDur = savedDur > 0 ? savedDur : hintDuration > 0 ? hintDuration : 0;
    const nextDurations =
      effectiveDur > 0
        ? trimUrlRecord({ ...state.durationsByUrl, [cleanUrl]: effectiveDur })
        : state.durationsByUrl;

    set({
      url: cleanUrl,
      playing: true,
      buffering: true,
      ended: false,
      position: savedPos,
      duration: effectiveDur,
      error: '',
      seekTarget: savedPos > 0.2 ? savedPos : 0,
      seekSeq: savedPos > 0.2 ? state.seekSeq + 1 : state.seekSeq,
      retrySeq: 0,
      positionsByUrl: trimUrlRecord(nextPositions),
      durationsByUrl: nextDurations,
    });
  },

  seek: (targetUrl, seconds, hintDuration = 0) => {
    const cleanUrl = String(targetUrl || '').trim();
    if (!cleanUrl) return;
    const state = get();
    const isSwitching = state.url !== cleanUrl;
    const wasError = !isSwitching && !!state.error;
    const knownDur =
      (!isSwitching ? state.duration : 0) || state.durationsByUrl[cleanUrl] || hintDuration || 0;
    const clamped =
      knownDur > 0
        ? Math.max(0, Math.min(knownDur - 0.05, Number(seconds) || 0))
        : Math.max(0, Number(seconds) || 0);

    const nextPositions = { ...state.positionsByUrl };
    if (state.url && isSwitching && state.position > 0) {
      nextPositions[state.url] = state.position;
    }
    nextPositions[cleanUrl] = clamped;

    const nextDurations =
      knownDur > 0
        ? trimUrlRecord({ ...state.durationsByUrl, [cleanUrl]: knownDur })
        : state.durationsByUrl;

    set({
      url: cleanUrl,
      playing: true,
      buffering: isSwitching || wasError,
      ended: false,
      position: clamped,
      duration: knownDur,
      error: '',
      seekTarget: clamped,
      seekSeq: state.seekSeq + 1,
      retrySeq: isSwitching ? 0 : wasError ? state.retrySeq + 1 : state.retrySeq,
      positionsByUrl: trimUrlRecord(nextPositions),
      durationsByUrl: nextDurations,
    });
  },

  cycleRate: () => {
    set((state) => ({ rate: nextVoiceRate(state.rate) }));
  },

  stop: () => {
    const state = get();
    const nextPositions = { ...state.positionsByUrl };
    if (state.url && state.position > 0) {
      nextPositions[state.url] = state.position;
    }
    set({
      playing: false,
      buffering: false,
      ended: false,
      error: '',
      positionsByUrl: trimUrlRecord(nextPositions),
    });
  },

  onLoaded: (loadedUrl, dur) => {
    const cleanUrl = String(loadedUrl || '').trim();
    if (!cleanUrl) return;
    const state = get();
    const validDur = Number.isFinite(dur) && dur > 0 ? dur : state.duration;
    const nextDurations =
      validDur > 0
        ? trimUrlRecord({ ...state.durationsByUrl, [cleanUrl]: validDur })
        : state.durationsByUrl;
    if (state.url === cleanUrl) {
      set({
        buffering: false,
        ended: false,
        duration: validDur,
        error: '',
        durationsByUrl: nextDurations,
      });
    } else if (validDur > 0) {
      set({ durationsByUrl: nextDurations });
    }
  },

  onProgress: (progUrl, pos) => {
    const state = get();
    if (state.url !== progUrl) return;
    const safePos = Number.isFinite(pos) && pos >= 0 ? pos : 0;
    set({
      position: safePos,
      buffering: false,
      ended: false,
    });
  },

  onBuffering: (bufUrl, buffering) => {
    const state = get();
    if (state.url !== bufUrl) return;
    set({ buffering: !!buffering });
  },

  onEnded: (endedUrl) => {
    const state = get();
    if (state.url !== endedUrl) return;
    const nextPositions = trimUrlRecord({
      ...state.positionsByUrl,
      [endedUrl]: 0,
    });
    set({
      playing: false,
      buffering: false,
      ended: true,
      position: 0,
      seekTarget: 0,
      positionsByUrl: nextPositions,
    });
  },

  onError: (errUrl, msg) => {
    const state = get();
    if (state.url !== errUrl) return;
    set({
      playing: false,
      buffering: false,
      error: msg || 'error',
    });
  },

  rememberDuration: (targetUrl, dur) => {
    const cleanUrl = String(targetUrl || '').trim();
    if (!cleanUrl || !Number.isFinite(dur) || dur <= 0) return;
    const state = get();
    if (state.durationsByUrl[cleanUrl] === dur) return;
    const nextDurations = trimUrlRecord({
      ...state.durationsByUrl,
      [cleanUrl]: dur,
    });
    set({
      durationsByUrl: nextDurations,
      ...(state.url === cleanUrl && state.duration <= 0 ? { duration: dur } : null),
    });
  },
}));
