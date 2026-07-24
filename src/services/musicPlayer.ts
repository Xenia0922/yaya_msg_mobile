import { useMusicPlayerStore, Track, LyricLine } from '../store/musicPlayerStore';
import { normalizeUrl } from '../utils/data';
import { parseLrc } from '../utils/lyrics';
import { getLyricsMatcher } from '../utils/lyricsIndex';

const LYRICS_BASE_URL = 'https://yaya-data.pages.dev/lyrics';

/** 48 官方域名白名单 —— 纯函数、无副作用、可安全静态导入 */
export function isPlayableHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith('.48.cn') || host === 'snh48.com' || host === 'www.snh48.com';
  } catch {
    return false;
  }
}

export function mediaUrl(path: string): string {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return path.startsWith('/') ? `https://mp4.48.cn${path}` : normalizeUrl(path);
}

type TrackUrlResolver = (track: Track) => Promise<string | null>;

/**
 * MusicEngine —— 纯状态编排器。
 *
 * 不再持有 Video ref、不再做 seek、不再拦截 onProgress。
 * Video 的 seek / progress / duration 由 MusicLibraryScreen 上的 <Video> 独立管理。
 */
export const MusicEngine = {
  get state() { return useMusicPlayerStore.getState(); },
  _urlResolver: null as TrackUrlResolver | null,

  setUrlResolver(resolver: TrackUrlResolver) {
    this._urlResolver = resolver;
  },

  /** 等待解析器就绪（最多等待 3 秒） */
  async _waitForResolver(timeoutMs = 3000): Promise<TrackUrlResolver | null> {
    if (this._urlResolver) return this._urlResolver;
    let waited = 0;
    while (!this._urlResolver && waited < timeoutMs) {
      await new Promise(r => setTimeout(r, 50));
      waited += 50;
    }
    return this._urlResolver;
  },

  /** Set queue and play from index 0 */
  loadQueue(tracks: Track[]) {
    const store = useMusicPlayerStore.getState();
    store.setQueue(tracks);
    if (tracks.length > 0) store.play(tracks[0], tracks);
  },

  /**
   * 默认 URL 解析器：直接用 track.mp3 / path 字段。
   * 页面挂载后可通过 setUrlResolver() 覆盖为更优实现（如含 officialMediaApi 回退）。
   * 不使用 dynamic import（消除与 MusicLibraryScreen 的循环引用）。
   */
  _initDefaultResolver() {
    if (this._urlResolver) return;
    this._urlResolver = async (track: Track) => {
      // 1. 优先用 track.mp3（官方源直接可播放）
      if (track?.mp3 && /^https?:/i.test(String(track.mp3))) {
        const u = String(track.mp3);
        if (isPlayableHost(u)) return u;
      }
      // 2. 兜底：track 自带的各种 path 字段
      const fb = String(
        (track as any).filePath ||
        (track as any).musicPath ||
        (track as any).playStreamPath ||
        (track as any).audioPath ||
        (track as any).url ||
        ''
      );
      if (fb && /^https?:/i.test(fb)) {
        if (isPlayableHost(fb)) return fb;
      }
      // 3. 通过 mediaUrl 规范化
      const normalized = mediaUrl(fb);
      if (normalized) {
        if (isPlayableHost(normalized)) return normalized;
      }
      return null;
    };
  },

  /**
   * 载入队列并定位到指定曲目，但不自动播放。
   * 预解析 URL + 歌词，等用户按播放键时已就绪。
   */
  loadQueueAt(track: Track, queue?: Track[]) {
    const store = useMusicPlayerStore.getState();
    const q = queue || store.queue;
    const idx = q.findIndex((t) => (t.musicId || t.id) === (track.musicId || track.id));
    store.setQueue(q);
    useMusicPlayerStore.setState({
      currentIndex: idx >= 0 ? idx : 0,
      playbackState: 'paused',
      url: '',
      duration: 0,
      position: 0,
      lyrics: [],
      error: null,
    });
    this._initDefaultResolver();
    this._waitForResolver().then(resolver => {
      if (resolver) {
        resolver(track).then(resolved => {
          if (resolved) useMusicPlayerStore.setState({ url: resolved });
        }).catch(() => {});
      }
    });
    this._fetchLyrics(track);
  },

  /**
   * 核心播放：解析 URL → setUrl + setPlaybackState('playing')。
   * 不再持有/操作 Video ref，不放 seek 锁。
   */
  async playTrack(track: Track, queue?: Track[]) {
    const store = useMusicPlayerStore.getState();
    store.play(track, queue);
    this._fetchLyrics(track);
    this._initDefaultResolver();
    const resolver = await this._waitForResolver();
    if (!resolver) { store.setError('解析器未就绪'); return; }
    try {
      const url = await resolver(track);
      if (!url) throw new Error('no url');
      if (!isPlayableHost(url)) throw new Error('不支持的播放源');
      if (!/^https?:\/\//i.test(url)) throw new Error('非法播放地址');
      store.setUrl(url);
      store.setPlaybackState('playing');
    } catch (e: any) {
      store.setError(e?.message || 'play failed');
      // 无效的歌曲自动跳到下一首
      const st = useMusicPlayerStore.getState();
      if (st.queue.length > 1) this.next();
    }
  },

  /** Next track, fetch URL and play */
  async next() {
    const nextTrack = useMusicPlayerStore.getState().next();
    if (!nextTrack) return null;
    await this.playTrack(nextTrack);
    return nextTrack;
  },

  /** Previous track */
  async prev() {
    const prevTrack = useMusicPlayerStore.getState().prev();
    if (!prevTrack) return null;
    await this.playTrack(prevTrack);
    return prevTrack;
  },

  /** 跳到播放列表指定下标 */
  async playAt(index: number) {
    const s = useMusicPlayerStore.getState();
    if (index < 0 || index >= s.queue.length) return null;
    const t = s.queue[index];
    if (!t) return null;
    useMusicPlayerStore.setState({ currentIndex: index });
    await this.playTrack(t, s.queue);
    return t;
  },

  /**
   * 暂停/播放切换。
   * - URL 为空（记忆恢复后首次）→ 重新解析地址再播放
   * - URL 非法 → 静默拒绝（防止 Video source 异常）
   * - 正常 → 翻转 playbackState
   * 不再调用 resume() → playTrack 重建 Video；resume 改为内联轻量解析路径。
   */
  togglePause() {
    const s = useMusicPlayerStore.getState();
    // 记忆恢复后首次播放：url 为空，需要先重新解析地址
    if (!s.url && s.queue[s.currentIndex]) {
      const t = s.queue[s.currentIndex];
      this._initDefaultResolver();
      this._waitForResolver().then(async (resolver) => {
        if (!resolver) { s.setError('解析器未就绪'); return; }
        try {
          const url = await resolver(t);
          if (!url || !isPlayableHost(url) || !/^https?:\/\//i.test(url)) {
            console.warn('[MusicEngine] resume url invalid');
            return;
          }
          s.setUrl(url);
          s.setPlaybackState('playing');
          if (!s.lyrics || s.lyrics.length === 0) this._fetchLyrics(t);
        } catch (e: any) {
          s.setError(e?.message || '播放恢复失败');
        }
      });
      return;
    }
    // URL 非法/空 → 禁止状态翻转
    if (!s.url || !/^https?:\/\//i.test(s.url) || !isPlayableHost(s.url)) {
      console.warn('[MusicEngine] togglePause blocked: invalid url', s.url);
      return;
    }
    const willPlay = s.playbackState !== 'playing';
    s.setPlaybackState(willPlay ? 'playing' : 'paused');
    if (willPlay && s.queue[s.currentIndex] && (!s.lyrics || s.lyrics.length === 0)) {
      this._fetchLyrics(s.queue[s.currentIndex]);
    }
  },

  cycleMode() {
    const s = useMusicPlayerStore.getState();
    const next = s.playMode === 'sequential' ? 'random' : s.playMode === 'random' ? 'single' : 'sequential';
    s.setMode(next);
  },

  // --- Lyrics ---
  async _fetchLyrics(track: Track) {
    const title = String(track.title || '').trim();
    if (!title) return;
    const group = (track as any).joinMemberNames || (track as any).subTitle ||
      (track as any).groupLabel || (track as any).artist || '';
    try {
      const { matcher } = await getLyricsMatcher();
      const result = matcher.match({ song: title, group });
      if (result) {
        const url = `${LYRICS_BASE_URL}/${encodeURI(result.entry.filePath)}`;
        const lrcResp = await fetch(url);
        const raw = await lrcResp.text();
        useMusicPlayerStore.getState().setLyrics(parseLrc(raw));
      } else {
        console.warn('[lyrics] no match for', title, 'group=', group);
      }
    } catch (e) {
      console.warn('[lyrics] fetch failed', title, e);
    }
  },
};