import AsyncStorage from '@react-native-async-storage/async-storage';

export type RoomMeta = { name: string; bg: string };

const KEY = 'yaya_room_meta_cache_v1';
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

export async function loadRoomMetaCache(): Promise<Record<string, RoomMeta>> {
  if (cache) return cache;
  if (loading) return loading;
  loading = (async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      cache = parsed && typeof parsed === 'object' ? trim(parsed as Record<string, RoomMeta>) : {};
    } catch {
      cache = {};
    }
    return cache!;
  })();
  return loading;
}

export function getRoomMetaCached(channelId: string): RoomMeta | undefined {
  return cache?.[channelId];
}

export function setRoomMetaCached(channelId: string, meta: RoomMeta) {
  if (!channelId) return;
  if (!cache) {
    void loadRoomMetaCache().then(() => setRoomMetaCached(channelId, meta));
    return;
  }

  delete cache[channelId];
  cache[channelId] = { name: meta.name || '', bg: meta.bg || '' };

  if (Object.keys(cache).length > MAX_ENTRIES) cache = trim(cache);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const snapshot = trim(cache || {});
    AsyncStorage.setItem(KEY, JSON.stringify(snapshot)).catch(() => {});
  }, 400);
}
