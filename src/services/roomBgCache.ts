import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

const BG_DIR = `${FileSystem.cacheDirectory || ''}roombg/`;
const MAP_KEY = 'yaya_room_bg_cache_v3';
const LEGACY_MAP_KEYS = ['yaya_room_bg_cache_v1', 'yaya_room_bg_cache_v2'];
const MAX_ENTRIES = 200;

function hashUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = (h * 31 + url.charCodeAt(i)) >>> 0;
  }
  const safe = url.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-48);
  return `${h.toString(36)}_${safe}`;
}

type BgMap = Record<string, { localUri: string; url: string }>;

let mapCache: BgMap | null = null;
let mapPromise: Promise<BgMap> | null = null;

let mapWriteChain: Promise<void> = Promise.resolve();

const inflightDownloads = new Map<string, Promise<void>>();

async function loadMap(): Promise<BgMap> {
  if (mapCache) return mapCache;
  if (mapPromise) return mapPromise;
  mapPromise = (async () => {
    try {
      for (const k of LEGACY_MAP_KEYS) AsyncStorage.removeItem(k).catch(() => {});
      const raw = await AsyncStorage.getItem(MAP_KEY);
      mapCache = raw ? (JSON.parse(raw) as BgMap) : {};
    } catch {
      mapCache = {};
    }
    return mapCache!;
  })();
  return mapPromise;
}

async function saveMap(map: BgMap): Promise<void> {
  mapCache = map;
  try {
    await AsyncStorage.setItem(MAP_KEY, JSON.stringify(map));
  } catch {}
}

function commitEntry(abs: string, entry: { localUri: string; url: string }): Promise<void> {
  const run = async () => {
    const map = await loadMap();
    const next: BgMap = { ...map, [abs]: entry };

    const keys = Object.keys(next);
    if (keys.length > MAX_ENTRIES) {
      const drop = keys.slice(0, keys.length - MAX_ENTRIES);
      for (const k of drop) {
        const uri = next[k]?.localUri;
        if (uri) FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
        delete next[k];
      }
    }
    await saveMap(next);
  };
  const task = mapWriteChain.then(run, run);
  mapWriteChain = task.catch(() => undefined);
  return task;
}

function normalizeBg(url: string): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `https://source.48.cn${url}`;
  return `https://source.48.cn/${url}`;
}

export function getBgDisplayUri(url: string): string {
  if (!url) return '';
  const abs = normalizeBg(url);
  const map = mapCache;
  if (map && map[abs]) {
    return map[abs].localUri;
  }
  return abs;
}

export async function ensureBgCached(url: string): Promise<void> {
  if (!url) return;
  const abs = normalizeBg(url);
  const map = await loadMap();
  const entry = map[abs];
  if (entry) {
    const info = await FileSystem.getInfoAsync(entry.localUri).catch(() => null);
    if (info && info.exists) return;
  }

  const existing = inflightDownloads.get(abs);
  if (existing) return existing;
  const task = (async () => {
    try {
      await FileSystem.makeDirectoryAsync(BG_DIR, { intermediates: true }).catch(() => undefined);
      const localUri = `${BG_DIR}${hashUrl(abs)}.img`;
      const dl = await FileSystem.downloadAsync(abs, localUri);
      if (dl.status < 200 || dl.status >= 300) {
        await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => undefined);
        return;
      }

      await commitEntry(abs, { localUri, url: abs });
    } catch {}
  })();
  inflightDownloads.set(abs, task);
  try {
    await task;
  } finally {
    inflightDownloads.delete(abs);
  }
}

export async function warmRoomBgs(urls: string[]): Promise<void> {
  const valid = Array.from(new Set(urls.filter(Boolean)));
  const CONCURRENCY = 3;
  for (let i = 0; i < valid.length; i += CONCURRENCY) {
    const batch = valid.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((u) => ensureBgCached(u).catch(() => undefined)));
  }
}

export async function initRoomBgCache(): Promise<void> {
  await loadMap();
}
