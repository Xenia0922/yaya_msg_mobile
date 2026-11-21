import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseMaybeJson } from '../utils/data';
import { fetchWithTimeout } from '../utils/network';

const R2_MUSIC_URL = 'https://gnz.hk/api/r2-music?metadata_v=3';

const CACHE_KEY = 'yaya_r2_music_cache_v2';
const CACHE_TTL = 24 * 60 * 60 * 1000;

export interface R2MusicTrack {
  id: string;
  key: string;
  title: string;
  album: string;
  artist: string;
  albumArtist: string;

  grouping: string;
  albumDate: string;
  genre: string;
  trackNumber: number;
  discNumber: number;

  duration: string;
  groupKey: string;
  groupLabel: string;

  mp3: string;
  coverUrl: string;
  size: number;
  uploaded: string;
  sourceIndex: number;
  source: string;
}

export function parseR2Duration(durationText: string): number {
  const parts = String(durationText || '')
    .trim()
    .split(':')
    .map((seg) => parseInt(seg, 10))
    .filter((n) => !Number.isNaN(n));
  if (!parts.length) return 0;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

async function fetchR2MusicRaw(): Promise<R2MusicTrack[]> {
  const resp = await fetchWithTimeout(R2_MUSIC_URL, {}, 20000);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json: any = parseMaybeJson(await resp.text());
  if (!json || !Array.isArray(json.tracks)) throw new Error('r2-music 响应缺少 tracks');
  return json.tracks as R2MusicTrack[];
}

export function normalizeR2Tracks(tracks: R2MusicTrack[]): any[] {
  return (tracks || [])
    .filter((t) => t && t.title && t.mp3)
    .map((t) => ({
      musicId: String(t.id || t.key || ''),
      id: String(t.id || t.key || ''),
      title: String(t.title || '').trim(),
      artist: String(t.artist || t.albumArtist || '').trim(),
      album: String(t.album || '').trim(),
      albumArtist: String(t.albumArtist || '').trim(),
      grouping: String(t.grouping || '').trim(),
      albumDate: String(t.albumDate || '').trim(),
      genre: String(t.genre || '').trim(),
      trackNumber: t.trackNumber,
      discNumber: t.discNumber,
      duration: String(t.duration || '').trim(),
      durationSec: parseR2Duration(t.duration),
      groupKey: String(t.groupKey || '').trim(),
      groupLabel: String(t.groupLabel || '').trim(),
      mp3: String(t.mp3 || '').trim(),
      coverUrl: String(t.coverUrl || '').trim(),
      size: t.size,
      uploaded: String(t.uploaded || ''),
      sourceIndex: Number.isFinite(t.sourceIndex) ? t.sourceIndex : 100000,
      source: 'r2-performance',
    }));
}

let inflight: Promise<any[]> | null = null;

let refreshing = false;

let lastRefreshAttempt = 0;

const REFRESH_RETRY_MIN_MS = 10 * 60 * 1000;

async function readR2Cache(): Promise<any[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.list) && parsed.list.length) return parsed.list;
    }
  } catch {}
  return null;
}

async function fetchR2MusicAndCache(): Promise<any[]> {
  if (inflight) return inflight;

  inflight = (async () => {
    const tracks = await fetchR2MusicRaw();
    const normalized = normalizeR2Tracks(tracks);
    if (!normalized.length) throw new Error('R2 音乐列表为空');
    try {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), list: normalized }));
    } catch {}
    return normalized;
  })();

  try {
    return await inflight;
  } catch (error) {
    const cached = await readR2Cache();
    if (cached && cached.length) return cached;
    throw error;
  } finally {
    inflight = null;
  }
}

function refreshR2MusicInBackground(): void {
  if (refreshing || inflight) return;
  if (Date.now() - lastRefreshAttempt < REFRESH_RETRY_MIN_MS) return;
  lastRefreshAttempt = Date.now();
  refreshing = true;
  fetchR2MusicAndCache()
    .catch(() => {})
    .finally(() => {
      refreshing = false;
    });
}

export async function loadR2Music(force = false): Promise<any[]> {
  if (!force) {
    const raw = await AsyncStorage.getItem(CACHE_KEY).catch(() => null);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.list) && parsed.list.length) {
          if (parsed.t && Date.now() - parsed.t >= CACHE_TTL) refreshR2MusicInBackground();
          return parsed.list;
        }
      } catch {}
    }
  }
  return fetchR2MusicAndCache();
}

export async function prefetchR2Music(): Promise<void> {
  try {
    await loadR2Music(false);
  } catch {}
}

export default { loadR2Music };
