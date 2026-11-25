import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { USER_AGENT } from '../constants';
import { normalizeUrl } from '../utils/data';
import { buildImageFallbackCandidates } from '../utils/imageThumb';
import { getTaskBudget, waitForIdleSlot } from './perfScheduler';

const BG_DIR = `${FileSystem.cacheDirectory || ''}roombg/`;
const MAP_KEY = 'yaya_room_bg_cache_v3';
const LEGACY_MAP_KEYS = ['yaya_room_bg_cache_v1', 'yaya_room_bg_cache_v2'];
const MAX_ENTRIES = 200;
const MIN_BG_BYTES = 256;

function hashUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = (h * 31 + url.charCodeAt(i)) >>> 0;
  }
  const safe = url.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-48);
  return `${h.toString(36)}_${safe}`;
}

export type BgMapEntry = { localUri: string; url: string };
type BgMap = Record<string, BgMapEntry>;

let mapCache: BgMap | null = null;
let mapPromise: Promise<BgMap> | null = null;
let mapWriteChain: Promise<void> = Promise.resolve();

const inflightDownloads = new Map<string, Promise<string>>();

export function normalizeBgUrl(url: string): string {
  const clean = String(url ?? '')
    .trim()
    .replace(/\\\//g, '/');
  if (!clean) return '';
  if (/^(?:file|content|data):/i.test(clean)) return clean;
  if (clean.startsWith('//') || /^https?:\/\//i.test(clean) || clean.startsWith('/')) {
    return normalizeUrl(clean);
  }
  return normalizeUrl(`/${clean}`);
}

async function saveMap(map: BgMap): Promise<void> {
  mapCache = map;
  try {
    await AsyncStorage.setItem(MAP_KEY, JSON.stringify(map));
  } catch {}
}

function schedulePersistCurrent(): void {
  const task = mapWriteChain.then(async () => {
    if (mapCache) await saveMap(mapCache);
  });
  mapWriteChain = task.catch(() => undefined);
}

function touchEntry(abs: string): void {
  if (!mapCache) return;
  const hit = mapCache[abs];
  if (!hit) return;
  delete mapCache[abs];
  mapCache[abs] = hit;
}

async function loadMap(): Promise<BgMap> {
  if (mapCache) return mapCache;
  if (mapPromise) return mapPromise;
  mapPromise = (async () => {
    let dirty = false;
    let next: BgMap = {};
    try {
      for (const k of LEGACY_MAP_KEYS) AsyncStorage.removeItem(k).catch(() => {});
      const raw = await AsyncStorage.getItem(MAP_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, BgMapEntry>) : {};
      if (parsed && typeof parsed === 'object') {
        for (const [k, entry] of Object.entries(parsed)) {
          if (!entry || typeof entry.localUri !== 'string' || !entry.localUri) {
            dirty = true;
            continue;
          }
          const abs = normalizeBgUrl(entry.url || k);
          if (!abs || !/^https?:\/\//i.test(abs)) {
            dirty = true;
            continue;
          }
          if (abs !== k || entry.url !== abs) dirty = true;
          next[abs] = { localUri: entry.localUri, url: abs };
        }
      }
    } catch {
      next = {};
    }

    const files = await FileSystem.readDirectoryAsync(BG_DIR).catch(() => null);
    if (files === null) {
      if (Object.keys(next).length > 0) dirty = true;
      next = {};
    } else {
      const fileSet = new Set<string>();
      for (const f of files) {
        if (f.endsWith('.tmp')) {
          FileSystem.deleteAsync(`${BG_DIR}${f}`, { idempotent: true }).catch(() => undefined);
        } else {
          fileSet.add(f);
        }
      }
      for (const [k, entry] of Object.entries(next)) {
        const name = entry.localUri.split('/').pop() || '';
        if (!name || !fileSet.has(name)) {
          delete next[k];
          dirty = true;
        }
      }
    }

    mapCache = next;
    if (dirty) schedulePersistCurrent();
    return mapCache;
  })();
  try {
    return await mapPromise;
  } finally {
    mapPromise = null;
  }
}

function commitEntry(abs: string, entry: BgMapEntry): Promise<void> {
  const run = async () => {
    const map = await loadMap();
    const next: BgMap = { ...map };
    delete next[abs];
    next[abs] = entry;

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

export function getBgDisplayUri(url: string): string {
  if (!url) return '';
  const abs = normalizeBgUrl(url);
  if (!abs) return '';
  if (/^(?:file|content|data):/i.test(abs)) return abs;
  const hit = mapCache?.[abs];
  if (hit?.localUri) {
    touchEntry(abs);
    return hit.localUri;
  }
  return abs;
}

export async function invalidateBgCache(urlOrLocalUri: string): Promise<string> {
  const raw = String(urlOrLocalUri ?? '').trim();
  if (!raw) return '';
  const absGuess = normalizeBgUrl(raw);
  let remote = /^https?:\/\//i.test(absGuess) ? absGuess : '';
  const toDelete = new Set<string>();
  if (/^(?:file|content):/i.test(raw)) toDelete.add(raw);

  const removeFrom = (map: BgMap | null): boolean => {
    if (!map) return false;
    let removed = false;
    for (const k of Object.keys(map)) {
      const entry = map[k];
      if (!entry) continue;
      if (k === absGuess || entry.localUri === raw || entry.url === absGuess) {
        if (!remote && entry.url) remote = normalizeBgUrl(entry.url);
        if (entry.localUri) toDelete.add(entry.localUri);
        delete map[k];
        removed = true;
      }
    }
    return removed;
  };

  removeFrom(mapCache);
  for (const u of toDelete) {
    FileSystem.deleteAsync(u, { idempotent: true }).catch(() => undefined);
  }

  const task = mapWriteChain.then(async () => {
    const map = await loadMap();
    const cloned: BgMap = { ...map };
    if (removeFrom(cloned)) {
      for (const u of toDelete) {
        FileSystem.deleteAsync(u, { idempotent: true }).catch(() => undefined);
      }
      await saveMap(cloned);
    }
  });
  mapWriteChain = task.catch(() => undefined);
  await task;
  return remote;
}

export async function ensureBgCached(url: string): Promise<string> {
  const abs = normalizeBgUrl(url);
  if (!abs || !/^https?:\/\//i.test(abs)) return '';
  const map = await loadMap();
  const entry = map[abs];
  if (entry?.localUri) {
    const info = await FileSystem.getInfoAsync(entry.localUri).catch(() => null);
    const size = info && info.exists && 'size' in info ? Number(info.size || 0) : 0;
    if (info?.exists && size >= MIN_BG_BYTES) {
      touchEntry(abs);
      return entry.localUri;
    }
    if (mapCache?.[abs]?.localUri === entry.localUri) {
      delete mapCache[abs];
      schedulePersistCurrent();
    }
    FileSystem.deleteAsync(entry.localUri, { idempotent: true }).catch(() => undefined);
  }

  const existing = inflightDownloads.get(abs);
  if (existing) return existing;
  const task = (async (): Promise<string> => {
    const ext = /\.png([?#]|$)/i.test(abs) ? 'png' : /\.webp([?#]|$)/i.test(abs) ? 'webp' : 'jpg';
    const localUri = `${BG_DIR}${hashUrl(abs)}.${ext}`;
    const tmpUri = `${localUri}.tmp`;
    await FileSystem.makeDirectoryAsync(BG_DIR, { intermediates: true }).catch(() => undefined);
    const candidates = buildImageFallbackCandidates(abs, { highResWidth: 1600 }).slice(0, 5);
    for (const candidate of candidates) {
      try {
        await FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => undefined);
        const headers: Record<string, string> | undefined =
          candidate.headerMode === 'pocket'
            ? { 'User-Agent': USER_AGENT, Referer: 'https://h5.48.cn/' }
            : candidate.headerMode === 'ua'
              ? { 'User-Agent': USER_AGENT }
              : undefined;
        const dl = await FileSystem.downloadAsync(
          candidate.uri,
          tmpUri,
          headers ? { headers } : undefined,
        );
        if (dl.status < 200 || dl.status >= 300) {
          await FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => undefined);
          continue;
        }
        const ctHeader = Object.entries(dl.headers || {}).find(
          ([k]) => k.toLowerCase() === 'content-type',
        )?.[1];
        const ct = String(ctHeader || '').toLowerCase();
        if (ct && /^(?:text\/|application\/(?:json|xml|xhtml))/i.test(ct)) {
          await FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => undefined);
          continue;
        }
        const info = await FileSystem.getInfoAsync(tmpUri).catch(() => null);
        const size = info && info.exists && 'size' in info ? Number(info.size || 0) : 0;
        if (!info?.exists || size < MIN_BG_BYTES) {
          await FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => undefined);
          continue;
        }
        await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => undefined);
        await FileSystem.moveAsync({ from: tmpUri, to: localUri });
        await commitEntry(abs, { localUri, url: abs });
        return localUri;
      } catch {
        await FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => undefined);
      }
    }
    return '';
  })();
  inflightDownloads.set(abs, task);
  try {
    return await task;
  } finally {
    inflightDownloads.delete(abs);
  }
}

const warmQueue: string[] = [];
const warmQueueSet = new Set<string>();
let warmRunnerPromise: Promise<void> | null = null;

export async function warmRoomBgs(urls: string[]): Promise<void> {
  const map = await loadMap();
  for (const raw of urls) {
    const abs = normalizeBgUrl(raw);
    if (!abs || !/^https?:\/\//i.test(abs)) continue;
    if (map[abs] || warmQueueSet.has(abs)) continue;
    warmQueueSet.add(abs);
    warmQueue.push(abs);
  }
  if (!warmQueue.length && !warmRunnerPromise) return;
  if (warmRunnerPromise) return warmRunnerPromise;

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const MAX_WARM_WORKERS = 2;
  const worker = async (workerIdx: number) => {
    while (warmQueue.length > 0) {
      const ok = await waitForIdleSlot('background');
      if (!ok || warmQueue.length === 0) break;
      const budget = getTaskBudget('Rooms', 'roomBg');
      if (workerIdx >= budget.concurrency) {
        await sleep(240);
        continue;
      }
      const nextUrl = warmQueue.shift();
      if (!nextUrl) break;
      warmQueueSet.delete(nextUrl);
      await ensureBgCached(nextUrl).catch(() => '');
      if (warmQueue.length > 0) {
        const gap = getTaskBudget('Rooms', 'roomBg').gapMs;
        if (gap > 0) await sleep(gap);
      }
    }
  };

  warmRunnerPromise = Promise.all(
    Array.from({ length: MAX_WARM_WORKERS }, (_unused, idx) => worker(idx)),
  )
    .then(() => undefined)
    .finally(() => {
      warmRunnerPromise = null;
    });

  return warmRunnerPromise;
}

export async function initRoomBgCache(): Promise<void> {
  await loadMap();
}
