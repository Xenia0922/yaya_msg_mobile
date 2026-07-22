import { useMusicPlayerStore, Track, LyricLine } from '../store/musicPlayerStore';
import { normalizeUrl } from '../utils/data';
import { parseLrc } from '../utils/lyrics';
import { getLyricsMatcher } from '../utils/lyricsIndex';

const LYRICS_BASE_URL = 'https://yaya-data.pages.dev/lyrics';

export function mediaUrl(path: string): string {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return path.startsWith('/') ? `https://mp4.48.cn${path}` : normalizeUrl(path);
}

type TrackUrlResolver = (track: Track) => Promise<string>;

export const MusicEngine = {
  get state() { return useMusicPlayerStore.getState(); },
  _urlResolver: null as TrackUrlResolver | null,
  _videoRef: null as any,
  _seekLockUntil: 0,

  setUrlResolver(resolver: TrackUrlResolver) {
    this._urlResolver = resolver;
  },

  setVideoRef(ref: any) {
    this._videoRef = ref;
  },

  /** Set queue and play from index 0 */
  loadQueue(tracks: Track[]) {
    const store = useMusicPlayerStore.getState();
    store.setQueue(tracks);
    if (tracks.length > 0) store.play(tracks[0], tracks);
  },

  /**
   * 载入队列并定位到指定曲目，但不自动播放（不自动续播）。
   * 用于「点歌进播放页」场景：保留进度记忆，等用户主动按播放键。
   * 若记忆里有同一首且带进度，会显示迷你栏「已暂停」态，用户点播放后才续播。
   */
  loadQueueAt(track: Track, queue?: Track[]) {
    const store = useMusicPlayerStore.getState();
    const q = queue || store.queue;
    const idx = q.findIndex((t) => (t.musicId || t.id) === (track.musicId || track.id));
    const cover = (track.coverUrl || track.cover || track.thumbPath || '') as string;
    store.setQueue(q);
    useMusicPlayerStore.setState({
      currentIndex: idx >= 0 ? idx : 0,
      playbackState: 'paused',
      url: '',
      coverUrl: cover ? (cover.startsWith('http') ? cover : `https://source.48.cn${cover.startsWith('/') ? cover : '/' + cover}`) : store.coverUrl,
      duration: 0,
      position: 0,
      lyrics: [],
      error: null,
    });
  },

  /** Play a specific track. Optionally sets queue at the same time. */
  async playTrack(track: Track, queue?: Track[]) {
    const store = useMusicPlayerStore.getState();
    store.play(track, queue);
    this._fetchLyrics(track);
    if (!this._urlResolver) { store.setError('no url resolver'); return; }
    try {
      const url = await this._urlResolver(track);
      if (!url) throw new Error('no url');
      store.setUrl(url);
      store.setPlaybackState('playing');
    } catch (e: any) {
      const id = String(track.musicId || track.id || '');
      if (id) store.addFailedId(id);
      const st = useMusicPlayerStore.getState();
      st.setError(e?.message || 'play failed');
      // 已下架/无效的歌曲自动跳到下一首；但若全部失效则停止，避免死循环
      if (st.failedIds.length < st.queue.length) this.next();
    }
  },

  onProgress(currentTime: number) {
    // seek 后短暂抑制进度回调，避免 video 还没 seek 完就把 position 覆盖回旧值（进度条弹回开头）
    if (Date.now() < this._seekLockUntil) return;
    useMusicPlayerStore.getState().setPosition(currentTime);
  },

  onLoad(duration: number) {
    useMusicPlayerStore.getState().setDuration(duration);
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

  togglePause() {
    const s = useMusicPlayerStore.getState();
    // 记忆恢复后首次播放：url 是瞬时的、重启后为空，需要先重新解析地址并跳到记忆进度
    if (!s.url && s.queue[s.currentIndex]) {
      this.resume();
      return;
    }
    s.setPlaybackState(s.playbackState === 'playing' ? 'paused' : 'playing');
  },

  /** 记忆恢复后续播：重新解析当前曲目地址，并 seek 到记忆位置 */
  async resume() {
    const s = useMusicPlayerStore.getState();
    const t = s.queue[s.currentIndex];
    if (!t) return null;
    const saved = s.position;
    s.setPendingSeek(saved);
    await this.playTrack(t, s.queue);
    return t;
  },

  cycleMode() {
    const s = useMusicPlayerStore.getState();
    const next = s.playMode === 'sequential' ? 'random' : s.playMode === 'random' ? 'single' : 'sequential';
    s.setMode(next);
  },

  seek(seconds: number) {
    useMusicPlayerStore.getState().setPosition(seconds);
    // 加锁 600ms：期间忽略 onProgress，等 video 真正 seek 到位
    this._seekLockUntil = Date.now() + 600;
    // 防御：native seek 在个别状态下可能抛错（如已 ended 的播放器），不能让一次 seek 把整个 app 带崩
    try {
      if (this._videoRef && typeof this._videoRef.seek === 'function') {
        this._videoRef.seek(seconds);
      }
    } catch (e) {
      console.warn('[music] seek failed', e);
    }
    return seconds;
  },

  // --- Lyrics ---
  async _fetchLyrics(track: Track) {
    const title = String(track.title || '').trim();
    if (!title) return;
    // 团体字段来源：旧移动端源用 joinMemberNames/subTitle；官网源用 groupLabel（如 "SNH48"）。
    // 带团体能命中匹配器的 Tier3/4 精确档，命中率远高于仅歌名模糊匹配。
    const group = (track as any).joinMemberNames || (track as any).subTitle ||
      (track as any).groupLabel || (track as any).artist || '';
    try {
      const { matcher } = await getLyricsMatcher();
      const result = matcher.match({ song: title, group });
      if (result) {
        // filePath 含空格与中文，必须规范编码，否则 Cloudflare 返回 404（整批歌词失效）
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
