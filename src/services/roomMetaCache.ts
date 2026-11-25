import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeBgUrl } from './roomBgCache';

export type RoomMeta = { name: string; bg: string };

const KEY = 'yaya_room_meta_cache_v4';
const LEGACY_KEYS = [
  'yaya_room_meta_cache_v1',
  'yaya_room_meta_cache_v2',
  'yaya_room_meta_cache_v3',
];
const MAX_ENTRIES = 300;

let cache: Record<string, RoomMeta> | null = null;
let loading: Promise<Record<string, RoomMeta>> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function trim(map: Record<string, RoomMeta>): Record<string, RoomMeta> {
  const keys = Object.keys(map);
  if (keys.length <= MAX_ENTRIES) return map;
  const next: Record<string, RoomMeta> = {};

  for (const k of keys.slice(-MAX_ENTRIES)) next[k] = map[k];
  return next;
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const snapshot = trim(cache || {});
    AsyncStorage.setItem(KEY, JSON.stringify(snapshot)).catch(() => {});
  }, 400);
}

export function pickRoomBg(o: Record<string, unknown> | null | undefined): string {
  if (!o || typeof o !== 'object') return '';
  const raw =
    o.bgImg ||
    o.bgImgUrl ||
    o.backgroundImg ||
    o.backgroundImgUrl ||
    o.backImg ||
    o.backImgUrl ||
    o.homeBgImg ||
    o.homeBgImgUrl ||
    o.bannerUrl ||
    o.serverBgWallImg ||
    o.bgWallImg ||
    o.roomBgImg ||
    o.bgPath ||
    o.bgUrl ||
    '';
  return normalizeBgUrl(String(raw || ''));
}

export function extractRoomMetasFromSeineDetail(
  content: Record<string, unknown> | null | undefined,
): Record<string, RoomMeta> {
  const out: Record<string, RoomMeta> = {};
  if (!content || typeof content !== 'object') return out;
  const list = Array.isArray(content.channelInfoList)
    ? (content.channelInfoList as Record<string, unknown>[])
    : [];
  for (let idx = 0; idx < list.length; idx += 1) {
    const c = list[idx];
    if (!c || typeof c !== 'object') continue;
    const cid = String(c.channelId ?? '').trim();
    if (!cid || cid === '0' || cid === 'undefined') continue;
    const name = String(c.channelName || '').trim();
    const ownBg = pickRoomBg(c);
    if (name || ownBg) {
      out[cid] = { name, bg: ownBg };
    }
  }
  return out;
}

export async function loadRoomMetaCache(): Promise<Record<string, RoomMeta>> {
  if (cache) return cache;
  if (loading) return loading;
  loading = (async () => {
    try {
      for (const k of LEGACY_KEYS) AsyncStorage.removeItem(k).catch(() => {});
      const raw = await AsyncStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const normalized: Record<string, RoomMeta> = {};
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed as Record<string, RoomMeta>)) {
          if (!v || typeof v !== 'object') continue;
          const name = String(v.name || '').trim();
          const bg = normalizeBgUrl(v.bg || '');
          if (name || bg) normalized[k] = { name, bg };
        }
      }
      cache = trim(normalized);
    } catch {
      cache = {};
    }
    return cache!;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

export function getRoomMetaCached(channelId: string): RoomMeta | undefined {
  return cache?.[channelId];
}

export function mergeRoomMetaCached(
  channelId: string,
  meta: RoomMeta,
  options?: { allowClearBg?: boolean },
): RoomMeta {
  const cid = String(channelId || '').trim();
  const normName = String(meta?.name || '').trim();
  const normBg = normalizeBgUrl(meta?.bg || '');
  if (!cid) return { name: normName, bg: normBg };
  if (!cache) {
    void loadRoomMetaCache().then(() =>
      mergeRoomMetaCached(cid, { name: normName, bg: normBg }, options),
    );
    return { name: normName, bg: normBg };
  }
  const prev = cache[cid];
  const next: RoomMeta = {
    name: normName || prev?.name || '',
    bg: options?.allowClearBg ? normBg : normBg || prev?.bg || '',
  };
  delete cache[cid];
  cache[cid] = next;
  if (Object.keys(cache).length > MAX_ENTRIES) cache = trim(cache);
  scheduleSave();
  return next;
}

export function setRoomMetaCached(channelId: string, meta: RoomMeta): void {
  mergeRoomMetaCached(channelId, meta, { allowClearBg: true });
}

export function cacheRoomMetasFromSeineDetail(
  content: Record<string, unknown> | null | undefined,
): Record<string, RoomMeta> {
  const extracted = extractRoomMetasFromSeineDetail(content);
  for (const [cid, meta] of Object.entries(extracted)) {
    mergeRoomMetaCached(cid, meta, { allowClearBg: false });
  }
  return extracted;
}
