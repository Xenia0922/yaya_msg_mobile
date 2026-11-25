import { AppState, DeviceEventEmitter, NativeModules, ToastAndroid } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import {
  flushMusicPlayerStorage,
  resolveTrackDurationSec,
  useMusicPlayerStore,
  Track,
  LyricLine,
} from '../store/musicPlayerStore';
import {
  claimAudioFocus,
  isRadioForegroundActive,
  registerAudioHandler,
  releaseAudioFocus,
} from './audioFocus';
import { USER_AGENT } from '../constants';
import { logWarn } from '../utils/runtimeLog';
import { normalizeUrl } from '../utils/data';
import { parseLrc } from '../utils/lyrics';
import { getLyricsMatcher } from '../utils/lyricsIndex';
import { fetchWithTimeout } from '../utils/network';
import { exoGetPlaybackSnapshot, exoControl, ExoPlaybackSnapshot } from '../native/RadioExo';
import { onRadioControlRequested } from '../native/LivePlayer';

const LYRICS_BASE_URL = 'https://yaya-data.pages.dev/lyrics';
const LYRICS_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const LYRICS_MEM_MAX = 40;
const LYRICS_DISK_MAX = 200;

const lyricMemoryCache = new Map<string, LyricLine[]>();
let lyricDirReady: Promise<boolean> | null = null;
let lyricPrunePending = false;

function lyricCacheDir(): string {
  return `${FileSystem.cacheDirectory || ''}lyrics/`;
}

function hashKey(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function lyricFileFor(cacheKey: string): string {
  return `${lyricCacheDir()}lrc_${hashKey(cacheKey)}.lrc`;
}

function ensureLyricDir(): Promise<boolean> {
  if (!lyricDirReady) {
    lyricDirReady = (async () => {
      try {
        await FileSystem.makeDirectoryAsync(lyricCacheDir(), { intermediates: true });
        return true;
      } catch {
        return false;
      }
    })();
  }
  return lyricDirReady;
}

function setLyricMemory(cacheKey: string, lines: LyricLine[]): void {
  lyricMemoryCache.delete(cacheKey);
  lyricMemoryCache.set(cacheKey, lines);
  while (lyricMemoryCache.size > LYRICS_MEM_MAX) {
    const oldest = lyricMemoryCache.keys().next();
    if (!oldest.done) lyricMemoryCache.delete(oldest.value);
    else break;
  }
}

async function readLyricDisk(cacheKey: string): Promise<string | null> {
  try {
    const ok = await ensureLyricDir();
    if (!ok) return null;
    const path = lyricFileFor(cacheKey);
    const info: any = await FileSystem.getInfoAsync(path);
    if (!info?.exists) return null;
    const mtimeMs = info.modificationTime ? info.modificationTime * 1000 : 0;
    if (mtimeMs > 0 && Date.now() - mtimeMs >= LYRICS_CACHE_TTL) return null;
    return await FileSystem.readAsStringAsync(path);
  } catch {
    return null;
  }
}

async function pruneLyricDisk(): Promise<void> {
  if (lyricPrunePending) return;
  lyricPrunePending = true;
  try {
    const dir = lyricCacheDir();
    const names = await FileSystem.readDirectoryAsync(dir);
    if (names.length <= LYRICS_DISK_MAX) return;
    const stats = await Promise.all(
      names.map(async (name) => {
        const p = `${dir}${name}`;
        try {
          const info: any = await FileSystem.getInfoAsync(p);
          return { p, t: info?.modificationTime ? Number(info.modificationTime) : 0 };
        } catch {
          return { p, t: 0 };
        }
      }),
    );
    stats.sort((a, b) => a.t - b.t);
    const toRemove = stats.slice(0, stats.length - LYRICS_DISK_MAX);
    await Promise.all(toRemove.map((x) => FileSystem.deleteAsync(x.p, { idempotent: true })));
  } catch {
  } finally {
    lyricPrunePending = false;
  }
}

function saveLyricDisk(cacheKey: string, text: string): void {
  ensureLyricDir()
    .then(async (ok) => {
      if (!ok) return;
      await FileSystem.writeAsStringAsync(lyricFileFor(cacheKey), text);
      void pruneLyricDisk();
    })
    .catch(() => {});
}

export function isPlayableHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith('.48.cn') || host === 'snh48.com' || host === 'www.snh48.com') return true;
    return host === 'music.gnz.hk';
  } catch {
    return false;
  }
}

export function getTrackVolume(url: string): number {
  const u = String(url || '').toLowerCase();
  return /(gnz\.hk|gnz-music|music\.gnz)/.test(u) || /\.r2\.|r2-music/i.test(u) ? 0.86 : 1.0;
}

export function mediaUrl(path: string): string {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return path.startsWith('/') ? `https://mp4.48.cn${path}` : normalizeUrl(path);
}

type TrackUrlResolver = (track: Track) => Promise<string | null>;

const PLAY_UA = USER_AGENT;
const PLAY_REFERER = 'https://h5.48.cn/';

export function trackKey(track: Track): string {
  return String(
    (track as any).musicId || (track as any).id || `${track.title}|${track.artist || ''}`,
  );
}

function findNativeTrackIndex(
  queue: Track[],
  snapshot: Pick<
    ExoPlaybackSnapshot,
    'trackId' | 'url' | 'title' | 'artist' | 'album' | 'queueIndex'
  >,
  currentIndex: number,
): number {
  if (
    typeof snapshot.queueIndex === 'number' &&
    snapshot.queueIndex >= 0 &&
    snapshot.queueIndex < queue.length
  ) {
    const byQueueIdx = queue[snapshot.queueIndex];
    const idMatches =
      !snapshot.trackId || String(byQueueIdx?.musicId || byQueueIdx?.id || '') === snapshot.trackId;
    if (idMatches) return snapshot.queueIndex;
  }
  if (snapshot.trackId) {
    const byId = queue.findIndex(
      (track) => String(track.musicId || track.id || '') === snapshot.trackId,
    );
    if (byId >= 0) return byId;
  }
  if (snapshot.url) {
    const byUrl = queue.findIndex((track) => String(track.mp3 || '') === snapshot.url);
    if (byUrl >= 0) return byUrl;
  }
  const norm = (value: unknown) =>
    String(value || '')
      .trim()
      .toLocaleLowerCase();
  const title = norm(snapshot.title);
  if (!title) return -1;
  const titleMatches = queue
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => norm(track.title) === title);
  if (!titleMatches.length) return -1;
  const artist = norm(snapshot.artist);
  const artistMatches = artist
    ? titleMatches.filter(({ track }) => norm(track.artist || track.groupLabel) === artist)
    : [];
  const album = norm(snapshot.album);
  const albumMatches = (artistMatches.length ? artistMatches : titleMatches).filter(
    ({ track }) => norm(track.album || track.albumName) === album,
  );
  if (album && albumMatches.length === 1) return albumMatches[0].index;
  if (artistMatches.length === 1) return artistMatches[0].index;
  if (artistMatches.some(({ index }) => index === currentIndex)) return currentIndex;
  if (titleMatches.length === 1) return titleMatches[0].index;
  if (titleMatches.some(({ index }) => index === currentIndex)) return currentIndex;
  return -1;
}

export function applyNativeSnapshot(snapshot: ExoPlaybackSnapshot): {
  active: boolean;
  matched: boolean;
} {
  if (!snapshot.active) return { active: false, matched: false };
  const st = useMusicPlayerStore.getState();
  if (!st.queue.length || !snapshot.url) return { active: true, matched: false };
  const index = findNativeTrackIndex(st.queue, snapshot, st.currentIndex);
  if (index < 0) return { active: true, matched: false };
  const trackChanged = index !== st.currentIndex;
  const preservedPosition =
    !trackChanged && !snapshot.playing && snapshot.position <= 0 && st.position > 0
      ? st.position
      : snapshot.position;
  const preservedDuration =
    snapshot.duration > 0
      ? snapshot.duration
      : trackChanged
        ? resolveTrackDurationSec(st.queue[index])
        : st.duration || resolveTrackDurationSec(st.queue[index]);
  useMusicPlayerStore.setState({
    currentIndex: index,
    url: snapshot.url,
    sessionActivated: true,
    position: preservedPosition,
    buffered: snapshot.buffered > 0 ? snapshot.buffered : trackChanged ? 0 : st.buffered,
    buffering: !!snapshot.buffering,
    duration: preservedDuration,
    playbackState: snapshot.playing ? 'playing' : 'paused',
    ...(snapshot.speed > 0 ? { speed: snapshot.speed } : null),
    seekTarget: 0,
    seekPending: false,
    seekTargetGuard: preservedPosition,
    seekNonce: 0,
    seekFrom: preservedPosition,
    ...(trackChanged ? { lyrics: [] } : null),
    seekIssuedAt: 0,
    error: null,
  });
  if (snapshot.playing) {
    claimAudioFocus('music');
    noteExoArmed(snapshot.url);
    noteExoProgress();
  }
  flushMusicPlayerStorage();
  const tr = useMusicPlayerStore.getState().queue[index];
  if (tr && (trackChanged || !useMusicPlayerStore.getState().lyrics.length)) {
    if (trackChanged) MusicEngine._playSeq += 1;
    void MusicEngine._fetchLyrics(tr);
  }
  return { active: true, matched: true };
}

let _armedExoUrl = '';
let _armedExoAt = 0;
let _lastExoProgressAt = 0;

export function noteExoArmed(url: string): void {
  const next = String(url || '');
  _armedExoUrl = next;
  _armedExoAt = next ? Date.now() : 0;
}

export function noteExoProgress(): void {
  _lastExoProgressAt = Date.now();
}

export function isExoRecentlyArmed(url: string, windowMs = 8000): boolean {
  if (!url || _armedExoUrl !== url) return false;
  const latestActivity = Math.max(_armedExoAt, _lastExoProgressAt);
  return latestActivity > 0 && Date.now() - latestActivity < windowMs;
}

export function resetExoArm(): void {
  _armedExoUrl = '';
  _armedExoAt = 0;
  _lastExoProgressAt = 0;
}

export async function syncNativePlaybackSnapshot(): Promise<{ active: boolean; matched: boolean }> {
  try {
    if (!useMusicPlayerStore.persist.hasHydrated()) {
      await new Promise<void>((resolve) =>
        useMusicPlayerStore.persist.onFinishHydration(() => resolve()),
      );
    }
    const res = await applyNativeSnapshot(await exoGetPlaybackSnapshot());
    const st = useMusicPlayerStore.getState();
    const cur = st.queue[st.currentIndex];
    if (cur && (!st.lyrics || st.lyrics.length === 0)) {
      void MusicEngine._fetchLyrics(cur);
    }
    return res;
  } catch {
    return { active: false, matched: false };
  }
}

export const MusicEngine = {
  get state() {
    return useMusicPlayerStore.getState();
  },
  _urlResolver: null as TrackUrlResolver | null,
  _playSeq: 0,
  _warmUrls: new Map<string, string>(),
  _warmUrlsMax: 60,
  _autoSkipDepth: 0,
  _skipTs: 0,

  getWarmUrl(track: Track): string {
    const hit = this._warmUrls.get(trackKey(track));
    if (hit) return hit;
    const direct = String(track?.mp3 || '').trim();
    if (direct && /^https?:/i.test(direct) && isPlayableHost(direct)) return direct;
    return '';
  },

  syncFromNativeTrack(params: {
    index: number;
    url: string;
    trackId: string;
    title: string;
    artist: string;
    album: string;
    playing: boolean;
  }): boolean {
    const st = useMusicPlayerStore.getState();
    if (!st.queue.length) return false;
    const idx = findNativeTrackIndex(
      st.queue,
      {
        queueIndex: params.index,
        trackId: params.trackId,
        url: params.url,
        title: params.title,
        artist: params.artist,
        album: params.album,
      },
      st.currentIndex,
    );
    if (idx < 0 || !st.queue[idx]) return false;
    const track = st.queue[idx];
    this._playSeq += 1;
    if (params.playing) claimAudioFocus('music');
    if (params.url) {
      this._cacheWarmUrl(trackKey(track), params.url);
      noteExoArmed(params.url);
    }
    useMusicPlayerStore.setState((prev) => ({
      currentIndex: idx,
      url: params.url || prev.url,
      playbackState: params.playing ? 'playing' : 'paused',
      sessionActivated: true,
      position: 0,
      buffered: 0,
      duration: resolveTrackDurationSec(track),
      buffering: params.playing,
      seekTarget: 0,
      seekPending: false,
      seekTargetGuard: 0,
      error: null,
      lyrics: [],
    }));
    st.recordRecent(track);
    this._fetchLyrics(track);
    this._prewarmNextTrack();
    return true;
  },

  async _warmUrl(url: string): Promise<void> {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 6000);
      try {
        await fetch(url, {
          headers: { Range: 'bytes=0-4095', 'User-Agent': PLAY_UA, Referer: PLAY_REFERER },
          signal: ctl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch {}
  },

  _prewarmNextTrack(): void {
    const st = useMusicPlayerStore.getState();
    const q = st.queue || [];
    if (q.length < 2) return;
    let n = -1;
    if (st.playMode === 'single') return;
    if (st.playMode === 'random') {
      if (q.length > 1) {
        n = Math.floor(Math.random() * q.length);
        if (n === st.currentIndex) n = (n + 1) % q.length;
      }
    } else {
      n = (st.currentIndex + 1) % q.length;
    }
    if (n < 0 || n === st.currentIndex) return;
    const nextTrack = q[n];
    if (!nextTrack || this._warmUrls.has(trackKey(nextTrack))) return;
    this._initDefaultResolver();
    this._waitForResolver().then((resolver) => {
      if (!resolver) return;
      resolver(nextTrack)
        .then((url) => {
          if (!url || !/^https?:/i.test(url)) return;
          this._cacheWarmUrl(trackKey(nextTrack), url);
          this._warmUrl(url);
        })
        .catch(() => {});
    });
  },

  _cacheWarmUrl(key: string, url: string): void {
    this._warmUrls.set(key, url);
    while (this._warmUrls.size > this._warmUrlsMax) {
      const oldest = this._warmUrls.keys().next();
      if (!oldest.done) this._warmUrls.delete(oldest.value);
      else break;
    }
  },

  async resolvePlayUrl(track: Track): Promise<string | null> {
    if (!track) return null;
    const key = trackKey(track);
    const hit = this._warmUrls.get(key);
    if (hit) return hit;
    this._initDefaultResolver();
    const resolver = this._urlResolver;
    if (!resolver) return null;
    try {
      const url = await resolver(track);
      if (url && /^https?:/i.test(url) && isPlayableHost(url)) {
        this._cacheWarmUrl(key, url);
        return url;
      }
    } catch {}
    return null;
  },

  setUrlResolver(resolver: TrackUrlResolver) {
    this._urlResolver = resolver;
  },

  async _waitForResolver(timeoutMs = 3000): Promise<TrackUrlResolver | null> {
    if (this._urlResolver) return this._urlResolver;
    let waited = 0;
    while (!this._urlResolver && waited < timeoutMs) {
      await new Promise((r) => setTimeout(r, 50));
      waited += 50;
    }
    return this._urlResolver;
  },

  loadQueue(tracks: Track[]) {
    const store = useMusicPlayerStore.getState();
    store.setQueue(tracks);
    if (tracks.length > 0) store.play(tracks[0], tracks);
  },

  _initDefaultResolver() {
    if (this._urlResolver) return;
    this._urlResolver = async (track: Track) => {
      if (track?.mp3 && /^https?:/i.test(String(track.mp3))) {
        const u = String(track.mp3);
        if (isPlayableHost(u)) return u;
      }

      const fb = String(
        (track as any).filePath ||
          (track as any).musicPath ||
          (track as any).playStreamPath ||
          (track as any).audioPath ||
          (track as any).url ||
          '',
      );
      if (fb && /^https?:/i.test(fb)) {
        if (isPlayableHost(fb)) return fb;
      }

      const normalized = mediaUrl(fb);
      if (normalized) {
        if (isPlayableHost(normalized)) return normalized;
      }
      return null;
    };
  },

  loadQueueAt(track: Track, queue?: Track[]) {
    const store = useMusicPlayerStore.getState();
    const q = queue || store.queue;
    const idx = q.findIndex((t) => (t.musicId || t.id) === (track.musicId || track.id));
    store.setQueue(q);
    useMusicPlayerStore.setState({
      currentIndex: idx >= 0 ? idx : 0,
      playbackState: 'paused',
      url: useMusicPlayerStore.getState().url,
      duration: 0,
      position: 0,
      buffered: 0,
      buffering: false,
      lyrics: [],
      error: null,
    });
    this._initDefaultResolver();
    const seq = this._playSeq;
    this._waitForResolver().then((resolver) => {
      if (resolver) {
        resolver(track)
          .then((resolved) => {
            if (resolved && seq === this._playSeq) useMusicPlayerStore.setState({ url: resolved });
          })
          .catch(() => {});
      }
    });
    this._fetchLyrics(track);
  },

  async playTrack(track: Track, queue?: Track[]) {
    claimAudioFocus('music');
    const seq = ++this._playSeq;

    try {
      exoControl('pause');
    } catch {}
    const store = useMusicPlayerStore.getState();
    store.play(track, queue);
    this._fetchLyrics(track);
    this._initDefaultResolver();
    const resolver = await this._waitForResolver();
    if (seq !== this._playSeq || useMusicPlayerStore.getState().playbackState === 'idle') return;
    if (!resolver) {
      try {
        exoControl('stop');
      } catch {}
      store.setError('解析器未就绪');
      return;
    }
    try {
      const warmed = this._warmUrls.get(trackKey(track));
      const url = warmed || (await resolver(track));
      if (seq !== this._playSeq || useMusicPlayerStore.getState().playbackState === 'idle') return;
      if (!url) throw new Error('no url');
      if (!isPlayableHost(url)) throw new Error('不支持的播放源');
      if (!/^https?:\/\//i.test(url)) throw new Error('非法播放地址');
      this._cacheWarmUrl(trackKey(track), url);
      store.setUrl(url);
      store.setPlaybackState('playing');
      this._autoSkipDepth = 0;

      this._prewarmNextTrack();
    } catch (e: any) {
      if (seq !== this._playSeq || useMusicPlayerStore.getState().playbackState === 'idle') return;

      try {
        exoControl('stop');
      } catch {}
      store.setError(e?.message || 'play failed');

      const st = useMusicPlayerStore.getState();
      if (st.queue.length > 1 && st.playMode !== 'single') {
        if (this._autoSkipDepth < st.queue.length - 1) {
          this._autoSkipDepth += 1;
          const waitMs = 250 - (Date.now() - this._skipTs);
          if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
          if (seq !== this._playSeq || useMusicPlayerStore.getState().playbackState === 'idle')
            return;
          try {
            await this.next();
          } catch {}
        } else {
          this._autoSkipDepth = 0;
        }
      }
    }
  },

  async resume() {
    claimAudioFocus('music');
    const seq = ++this._playSeq;
    const store = useMusicPlayerStore.getState();
    const track = store.queue[store.currentIndex];
    if (!track) return null;

    try {
      exoControl('pause');
    } catch {}
    store.play(track, store.queue, true);
    this._fetchLyrics(track);
    this._initDefaultResolver();
    const resolver = await this._waitForResolver();
    if (seq !== this._playSeq || useMusicPlayerStore.getState().playbackState === 'idle')
      return null;
    if (!resolver) {
      try {
        exoControl('stop');
      } catch {}
      store.setError('解析器未就绪');
      return null;
    }
    try {
      const warmed = this._warmUrls.get(trackKey(track));
      const url = warmed || (await resolver(track));
      if (seq !== this._playSeq || useMusicPlayerStore.getState().playbackState === 'idle')
        return null;
      if (!url) throw new Error('no url');
      if (!isPlayableHost(url)) throw new Error('不支持的播放源');
      if (!/^https?:\/\//i.test(url)) throw new Error('非法播放地址');
      this._cacheWarmUrl(trackKey(track), url);
      store.setUrl(url);
      store.setPlaybackState('playing');
      this._prewarmNextTrack();
      return track;
    } catch (e: any) {
      if (seq !== this._playSeq || useMusicPlayerStore.getState().playbackState === 'idle')
        return null;
      try {
        exoControl('stop');
      } catch {}
      store.setError(e?.message || '恢复播放失败');
      return null;
    }
  },

  async next() {
    const now = Date.now();
    if (now - this._skipTs < 250) return null;
    this._skipTs = now;
    const nextTrack = useMusicPlayerStore.getState().next();
    if (!nextTrack) return null;
    await this.playTrack(nextTrack);
    return nextTrack;
  },

  async prev() {
    const now = Date.now();
    if (now - this._skipTs < 250) return null;
    this._skipTs = now;
    const prevTrack = useMusicPlayerStore.getState().prev();
    if (!prevTrack) return null;
    await this.playTrack(prevTrack);
    return prevTrack;
  },

  async playAt(index: number) {
    const s = useMusicPlayerStore.getState();
    if (index < 0 || index >= s.queue.length) return null;
    const t = s.queue[index];
    if (!t) return null;
    useMusicPlayerStore.setState({ currentIndex: index });
    await this.playTrack(t, s.queue);
    return t;
  },

  async removeFromQueue(id: string) {
    const s = useMusicPlayerStore.getState();
    const idx = s.queue.findIndex((t) => String(t.musicId || t.id) === String(id));
    if (idx < 0) return;
    const wasCurrent = idx === s.currentIndex;
    useMusicPlayerStore.getState().removeFromQueue(id);
    const after = useMusicPlayerStore.getState();
    if (!wasCurrent) return;

    const nextTrack = after.queue[after.currentIndex];
    if (nextTrack && after.queue.length > 0) {
      await this.playTrack(nextTrack, after.queue);
    } else {
      resetExoArm();
      exoControl('stop');
      useMusicPlayerStore.setState({
        url: '',
        playbackState: 'idle',
        position: 0,
        duration: 0,
        buffered: 0,
        buffering: false,
        seekTarget: 0,
        seekPending: false,
        seekTargetGuard: 0,
        lyrics: [],
      });
      flushMusicPlayerStorage();
    }
  },

  togglePause() {
    const s = useMusicPlayerStore.getState();
    if (s.playbackState === 'loading') return;

    if (!s.url && s.queue[s.currentIndex]) {
      claimAudioFocus('music');
      const t = s.queue[s.currentIndex];
      const seq = ++this._playSeq;
      s.setPlaybackState('loading');
      const isCurrentRequest = () => {
        const current = useMusicPlayerStore.getState();
        const track = current.queue[current.currentIndex];
        return (
          seq === this._playSeq &&
          current.playbackState === 'loading' &&
          !!track &&
          trackKey(track) === trackKey(t)
        );
      };
      this._initDefaultResolver();
      this._waitForResolver().then(async (resolver) => {
        if (!isCurrentRequest()) return;
        if (!resolver) {
          useMusicPlayerStore.getState().setError('解析器未就绪');
          return;
        }
        try {
          const url = await resolver(t);
          if (!isCurrentRequest()) return;
          if (!url || !isPlayableHost(url) || !/^https?:\/\//i.test(url)) {
            useMusicPlayerStore.getState().setError('播放地址不可用');
            return;
          }

          const cur = useMusicPlayerStore.getState();
          if (cur.url && /^https?:\/\//i.test(cur.url) && isPlayableHost(cur.url)) {
            if (cur.playbackState !== 'playing') cur.setPlaybackState('playing');
            return;
          }
          const curTrack = cur.queue[cur.currentIndex];
          const sameTrack =
            curTrack && String(curTrack.musicId || curTrack.id) === String(t.musicId || t.id);
          if (!sameTrack) return;
          this._cacheWarmUrl(trackKey(t), url);
          cur.setUrl(url);
          cur.setPlaybackState('playing');
          if (!cur.lyrics || cur.lyrics.length === 0) this._fetchLyrics(t);
        } catch (e: any) {
          if (isCurrentRequest())
            useMusicPlayerStore.getState().setError(e?.message || '播放恢复失败');
        }
      });
      return;
    }

    if (!s.url || !/^https?:\/\//i.test(s.url) || !isPlayableHost(s.url)) {
      logWarn('[MusicEngine] togglePause blocked: invalid url', 'music');
      return;
    }

    const willPlay = s.playbackState !== 'playing';
    if (willPlay) {
      claimAudioFocus('music');
      if (s.queue[s.currentIndex]) s.recordRecent(s.queue[s.currentIndex]);
    } else {
      releaseAudioFocus('music');
    }
    s.setPlaybackState(willPlay ? 'playing' : 'paused');
    if (willPlay && s.queue[s.currentIndex] && (!s.lyrics || s.lyrics.length === 0)) {
      this._fetchLyrics(s.queue[s.currentIndex]);
    }
  },

  stop() {
    this._playSeq++;
    releaseAudioFocus('music');
    resetExoArm();
    exoControl('pause');
    exoControl('stop');
    useMusicPlayerStore.getState().clearSleepTimer();
    useMusicPlayerStore.getState().closeFullScreen();
    useMusicPlayerStore.getState().setPlaybackState('idle');
    useMusicPlayerStore.setState({
      url: '',
      miniBarDismissed: true,
      sessionActivated: false,
      position: 0,
      duration: 0,
      buffered: 0,
      buffering: false,
      seekTarget: 0,
      seekPending: false,
      seekTargetGuard: 0,
      lyrics: [],
    });
    flushMusicPlayerStorage();
  },

  cycleMode() {
    const s = useMusicPlayerStore.getState();
    const next =
      s.playMode === 'sequential' ? 'random' : s.playMode === 'random' ? 'single' : 'sequential';
    s.setMode(next);
  },

  async _fetchLyrics(track: Track) {
    const seq = this._playSeq;
    const commit = (lines: LyricLine[]) => {
      if (seq !== this._playSeq) return;
      useMusicPlayerStore.getState().setLyrics(lines);
    };
    const loadAndCommitByFile = async (filePath: string) => {
      const cacheKey = `lyric:${filePath}`;
      const memHit = lyricMemoryCache.get(cacheKey);
      if (memHit) {
        commit(memHit);
        return;
      }
      const diskHit = await readLyricDisk(cacheKey);
      if (diskHit !== null) {
        const parsed = parseLrc(diskHit);
        setLyricMemory(cacheKey, parsed);
        commit(parsed);
        return;
      }
      const url = `${LYRICS_BASE_URL}/${encodeURI(filePath)}`;
      const lrcResp = await fetchWithTimeout(url, {}, 10000);
      if (!lrcResp?.ok) throw new Error(`lyrics HTTP ${lrcResp?.status}`);
      const raw = await lrcResp.text();
      const parsed = parseLrc(raw);
      setLyricMemory(cacheKey, parsed);
      commit(parsed);
      saveLyricDisk(cacheKey, raw);
    };

    const title = String(track.title || '').trim();
    if (!title) return;

    const rawGroup = String(
      (track as any).groupLabel ||
        (track as any).artist ||
        (track as any).subTitle ||
        (track as any).joinMemberNames ||
        '',
    ).trim();
    const candidates: string[] = [];
    const parts = rawGroup
      .split(/[、,，/·+&;；\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 1) candidates.push(...parts);
    if (rawGroup) candidates.push(rawGroup);
    candidates.push('');

    const coreTitle = title.replace(/[（(].*?[)）]/g, '').trim();
    const albumName = String((track as any).album || (track as any).albumName || '').trim();

    if (coreTitle && coreTitle !== title) {
      const coreGroupCandidates = candidates.filter(Boolean);
      try {
        const { matcher } = await getLyricsMatcher();
        for (const g of coreGroupCandidates) {
          const r = matcher.match({ song: coreTitle, group: g, album: albumName });
          if (r) {
            await loadAndCommitByFile(r.entry.filePath);
            return;
          }
        }
      } catch {}
    }

    try {
      const { matcher } = await getLyricsMatcher();
      let best: ReturnType<typeof matcher.match> = null;
      for (const g of candidates) {
        const r = matcher.match(
          g ? { song: title, group: g, album: albumName } : { song: title, album: albumName },
        );
        if (r && (!best || r.tier < best.tier || (r.tier === best.tier && r.score > best.score)))
          best = r;
      }
      if (best) {
        await loadAndCommitByFile(best.entry.filePath);
      } else {
        logWarn(`[lyrics] no match for ${title} group=${rawGroup}`, 'music');
      }
    } catch (e) {
      logWarn(`[lyrics] fetch failed ${title} ${String(e)}`, 'music');
    }
  },
};

export function syncFavoriteToNative() {
  try {
    const st = useMusicPlayerStore.getState();
    const cur = st.queue[st.currentIndex];
    const key = cur ? String(cur.musicId || cur.id || '') : '';
    const active = !!(cur && key && st.isFavorite(key, cur));
    (NativeModules as any)?.RadioServiceModule?.setFavoriteState?.(active);
  } catch {}
}

let musicBridgeInstalled = false;
function installMusicBridge() {
  if (musicBridgeInstalled) return;
  musicBridgeInstalled = true;

  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void syncNativePlaybackSnapshot();
    } else {
      flushMusicPlayerStorage();
    }
  });
  const syncAfterHydration = () => {
    void syncNativePlaybackSnapshot();
  };
  if (useMusicPlayerStore.persist.hasHydrated()) syncAfterHydration();
  else useMusicPlayerStore.persist.onFinishHydration(syncAfterHydration);

  let lastFavKey = '';
  useMusicPlayerStore.subscribe((st) => {
    const cur = st.queue[st.currentIndex];
    const sig = `${cur ? String(cur.musicId || cur.id || '') : ''}|${st.favorites.length}|${st.currentIndex}`;
    if (sig === lastFavKey) return;
    lastFavKey = sig;
    syncFavoriteToNative();
  });

  registerAudioHandler('music', (reason) => {
    try {
      const st = useMusicPlayerStore.getState();
      if (st.playbackState === 'playing' || st.playbackState === 'loading') {
        MusicEngine._playSeq += 1;
        exoControl('pause');
        st.setPlaybackState(st.playbackState === 'loading' ? 'idle' : 'paused');
      } else if (reason === 'reset' && st.playbackState !== 'idle') {
        exoControl('pause');
        st.setPlaybackState('paused');
      }
    } catch {}
  });

  onRadioControlRequested((action, value) => {
    try {
      if (action !== 'playlist' && isRadioForegroundActive()) return;
      const st = useMusicPlayerStore.getState();

      if (action === 'playlist') {
        if (st.queue.length > 0 && st.currentIndex >= 0) {
          st.openFullScreen('queue');
        } else {
          DeviceEventEmitter.emit('OpenMusicLibrary');
        }
        return;
      }
      if (!st.queue.length || st.playbackState === 'idle') {
        if (action === 'favorite') ToastAndroid.show('当前没有正在播放的歌曲', ToastAndroid.SHORT);
        return;
      }
      const cur = st.queue[st.currentIndex];
      switch (action) {
        case 'play':
          if (st.playbackState !== 'playing') MusicEngine.togglePause();
          break;
        case 'pause':
          if (st.playbackState === 'playing') MusicEngine.togglePause();
          break;
        case 'play_pause':
          MusicEngine.togglePause();
          break;
        case 'next':
          void MusicEngine.next();
          break;
        case 'prev':
          void MusicEngine.prev();
          break;
        case 'seek':
          if (typeof value === 'number' && Number.isFinite(value))
            st.setSeekTarget(Math.max(0, value / 1000));
          break;
        case 'favorite': {
          if (!cur) break;
          const key = String(cur.musicId || cur.id || '');
          if (!key) break;
          const was = st.isFavorite(key, cur);
          st.toggleFavorite(key, cur);
          syncFavoriteToNative();
          ToastAndroid.show(was ? '已取消收藏' : '已收藏', ToastAndroid.SHORT);
          break;
        }
        case 'stop':
          releaseAudioFocus('music');
          resetExoArm();
          st.clearSleepTimer();
          st.closeFullScreen();
          useMusicPlayerStore.setState({
            url: '',
            playbackState: 'idle',
            miniBarDismissed: true,
            sessionActivated: false,
            position: 0,
            duration: 0,
            buffered: 0,
            buffering: false,
            seekTarget: 0,
            seekPending: false,
            seekTargetGuard: 0,
            lyrics: [],
          });
          flushMusicPlayerStorage();
          break;
        default:
          break;
      }
    } catch {}
  });
}

installMusicBridge();
