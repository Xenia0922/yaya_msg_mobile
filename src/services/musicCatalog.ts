import AsyncStorage from '@react-native-async-storage/async-storage';
import { hydrateR2MusicFromCache, loadR2Music, subscribeR2MusicUpdate } from '../api/r2Music';
import { resolveTrackDurationSec } from '../store/musicPlayerStore';

const LEGACY_OFFICIAL_CACHE_KEY = 'yaya_official_site_music_cache_v2';

const SNH_FAMILY = new Set([
  'SNH48',
  '7SENSES',
  'BLUEV',
  'DEMOON',
  'HO2',
  'COLOR GIRLS',
  'Color Girls',
  '塞纳河组合',
]);

export function groupFamily(g: string): string {
  const trimmed = String(g || '').trim();
  return SNH_FAMILY.has(trimmed) ? 'SNH48' : trimmed;
}

export function albumGroupOrder(g: string): number {
  const up = groupFamily(g).toUpperCase();
  if (up === 'SNH48') return 0;
  const map: Record<string, number> = {
    GNZ48: 10,
    BEJ48: 20,
    AKB48: 30,
    CKG48: 40,
    CGT48: 50,
    SHY48: 60,
    TSH48: 70,
    TPE48: 80,
  };
  return map[up] ?? 90;
}

export interface TrackCatalogMeta {
  id: string;
  groupFam: string;
  groupOrder: number;
  groupLower: string;
  titleLower: string;
  search: string;
  favKey2: string;
  favKey3: string;
  durSec: number;
}

const trackMetaCache = new WeakMap<object, TrackCatalogMeta>();

export function getTrackCatalogMeta(tr: any): TrackCatalogMeta {
  if (tr && typeof tr === 'object') {
    const cached = trackMetaCache.get(tr);
    if (cached) return cached;
  }
  const title = String(tr?.title || '').trim();
  const artist = String(tr?.artist || '').trim();
  const album = String(tr?.album || '').trim();
  const groupLabel = String(tr?.groupLabel || '').trim();
  const favKey2 = `${title}|${artist}`.trim();
  const favKey3 = `${favKey2}|${album}`.trim();
  const durSec = resolveTrackDurationSec(tr);
  const built: TrackCatalogMeta = {
    id: String(tr?.musicId || tr?.id || ''),
    groupFam: groupFamily(groupLabel),
    groupOrder: albumGroupOrder(groupLabel),
    groupLower: groupLabel.toLowerCase(),
    titleLower: title.toLowerCase(),
    search: [title, artist, album, groupLabel].filter(Boolean).join(' ').toLowerCase(),
    favKey2,
    favKey3,
    durSec,
  };
  if (tr && typeof tr === 'object') {
    trackMetaCache.set(tr, built);
  }
  return built;
}

export interface MusicCatalogResult {
  songs: any[];
}

let cachedSourceRef: any[] | null = null;
let cachedSongs: any[] | null = null;
let inflightLoad: Promise<MusicCatalogResult> | null = null;
let legacyCacheCleaned = false;

function cleanupLegacyOfficialCacheOnce(): void {
  if (legacyCacheCleaned) return;
  legacyCacheCleaned = true;
  AsyncStorage.removeItem(LEGACY_OFFICIAL_CACHE_KEY).catch(() => {});
}

export function getCachedMusicCatalog(): any[] | null {
  return cachedSongs;
}

export function resetMusicCatalogForTest(): void {
  cachedSourceRef = null;
  cachedSongs = null;
  inflightLoad = null;
  legacyCacheCleaned = false;
}

function prepareCatalogTracks(r2: any[]): any[] {
  const seen = new Set<string>();
  const prepared: any[] = [];
  for (const tr of r2) {
    const meta = getTrackCatalogMeta(tr);
    const key = `${meta.titleLower}|${String(tr?.artist || '')
      .trim()
      .toLowerCase()}|${String(tr?.album || '')
      .trim()
      .toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    prepared.push(tr);
  }

  prepared.sort((a: any, b: any) => {
    const ma = getTrackCatalogMeta(a);
    const mb = getTrackCatalogMeta(b);
    if (ma.groupOrder !== mb.groupOrder) return ma.groupOrder - mb.groupOrder;
    const sa = Number(a.sourceIndex) || 0;
    const sb = Number(b.sourceIndex) || 0;
    if (sa !== sb) return sa - sb;
    if (ma.groupLower !== mb.groupLower) return ma.groupLower < mb.groupLower ? -1 : 1;
    if (ma.titleLower === mb.titleLower) return 0;
    return ma.titleLower < mb.titleLower ? -1 : 1;
  });
  return prepared;
}

subscribeR2MusicUpdate((tracks) => {
  cachedSourceRef = tracks;
  cachedSongs = prepareCatalogTracks(tracks);
});

export async function hydrateMusicCatalogFromCache(): Promise<any[] | null> {
  cleanupLegacyOfficialCacheOnce();
  if (cachedSongs && cachedSongs.length > 0) return cachedSongs;
  try {
    const r2 = await hydrateR2MusicFromCache();
    if (!r2 || !r2.length) return null;
    if (cachedSourceRef === r2 && cachedSongs && cachedSongs.length > 0) return cachedSongs;
    const prepared = prepareCatalogTracks(r2);
    cachedSourceRef = r2;
    cachedSongs = prepared;
    return prepared;
  } catch {
    return null;
  }
}

export async function loadMusicCatalog(force = false): Promise<MusicCatalogResult> {
  cleanupLegacyOfficialCacheOnce();
  if (!force && inflightLoad) return inflightLoad;

  const task = (async () => {
    const r2 = await loadR2Music(force);
    if (!force && cachedSongs && cachedSongs.length > 0 && cachedSourceRef === r2) {
      return { songs: cachedSongs };
    }
    const prepared = prepareCatalogTracks(r2);
    cachedSourceRef = r2;
    cachedSongs = prepared;
    return { songs: prepared };
  })();

  if (!force) inflightLoad = task;
  try {
    return await task;
  } finally {
    if (inflightLoad === task) inflightLoad = null;
  }
}

export async function prefetchMusicCatalog(): Promise<void> {
  await hydrateMusicCatalogFromCache();
}
