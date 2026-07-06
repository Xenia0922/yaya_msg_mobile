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
      store.setError(e?.message || 'play failed');
    }
  },

  onProgress(currentTime: number) {
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

  togglePause() {
    const s = useMusicPlayerStore.getState();
    s.setPlaybackState(s.playbackState === 'playing' ? 'paused' : 'playing');
  },

  cycleMode() {
    const s = useMusicPlayerStore.getState();
    const next = s.playMode === 'sequential' ? 'random' : s.playMode === 'random' ? 'single' : 'sequential';
    s.setPlayMode(next);
  },

  seek(seconds: number) {
    useMusicPlayerStore.getState().setPosition(seconds);
    if (this._videoRef) {
      this._videoRef.seek(seconds);
    }
    return seconds;
  },

  // --- Lyrics ---
  async _fetchLyrics(track: Track) {
    const title = String(track.title || '').trim();
    if (!title) return;
    try {
      const { matcher } = await getLyricsMatcher();
      const result = matcher.match({
        song: title,
        group: track.joinMemberNames || track.subTitle || '',
      });
      if (result) {
        const lrcResp = await fetch(`${LYRICS_BASE_URL}/${result.entry.filePath}`);
        const raw = await lrcResp.text();
        useMusicPlayerStore.getState().setLyrics(parseLrc(raw));
      }
    } catch {}
  },
};
