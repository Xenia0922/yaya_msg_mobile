import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_PREFIX = 'yaya_followed_ids_v1';
const ROOM_SNAPSHOT_PREFIX = 'yaya_followed_rooms_snap_v1';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SNAPSHOT_ENTRIES = 150;

type CacheEntry = { savedAt: number; ids: string[] };

export type FollowedRoomSnapshotEntry = {
  memberId: string;
  lastMessage?: unknown;
  lastSmallMessage?: unknown;
};

type SnapshotPayload = {
  savedAt: number;
  entries: FollowedRoomSnapshotEntry[];
};

function tokenHash(token: string): string {
  let hash = 5381;
  for (let i = 0; i < token.length; i += 1) hash = ((hash << 5) + hash + token.charCodeAt(i)) | 0;
  return String(Math.abs(hash));
}

function cacheKey(token: string): string {
  return `${CACHE_PREFIX}_${tokenHash(token)}`;
}

function snapshotKey(token: string): string {
  return `${ROOM_SNAPSHOT_PREFIX}_${tokenHash(token)}`;
}

export async function readFollowedIdsCache(
  token: string,
): Promise<{ ids: string[]; cached: boolean }> {
  if (!token) return { ids: [], cached: false };
  try {
    const raw = await AsyncStorage.getItem(cacheKey(token));
    if (!raw) return { ids: [], cached: false };
    const entry = JSON.parse(raw) as CacheEntry;
    if (!entry || !Array.isArray(entry.ids)) return { ids: [], cached: false };
    if (Date.now() - Number(entry.savedAt || 0) > MAX_AGE_MS) return { ids: [], cached: false };
    return { ids: entry.ids.map(String), cached: true };
  } catch {
    return { ids: [], cached: false };
  }
}

export async function writeFollowedIdsCache(token: string, ids: string[]): Promise<void> {
  if (!token) return;
  try {
    await AsyncStorage.setItem(
      cacheKey(token),
      JSON.stringify({ savedAt: Date.now(), ids: ids.map(String) }),
    );
  } catch {}
}

export async function readFollowedRoomsSnapshot(
  token: string,
): Promise<{ entries: FollowedRoomSnapshotEntry[]; cached: boolean }> {
  if (!token) return { entries: [], cached: false };
  try {
    const raw = await AsyncStorage.getItem(snapshotKey(token));
    if (!raw) return { entries: [], cached: false };
    const payload = JSON.parse(raw) as SnapshotPayload;
    if (!payload || !Array.isArray(payload.entries)) return { entries: [], cached: false };
    if (Date.now() - Number(payload.savedAt || 0) > MAX_AGE_MS) {
      return { entries: [], cached: false };
    }
    const clean: FollowedRoomSnapshotEntry[] = [];
    for (const item of payload.entries) {
      if (!item || typeof item !== 'object') continue;
      const memberId = String(item.memberId || '').trim();
      if (!memberId) continue;
      clean.push({
        memberId,
        ...(item.lastMessage ? { lastMessage: item.lastMessage } : null),
        ...(item.lastSmallMessage ? { lastSmallMessage: item.lastSmallMessage } : null),
      });
    }
    return { entries: clean, cached: true };
  } catch {
    return { entries: [], cached: false };
  }
}

export async function writeFollowedRoomsSnapshot(
  token: string,
  entries: FollowedRoomSnapshotEntry[],
): Promise<void> {
  if (!token) return;
  try {
    const compact: FollowedRoomSnapshotEntry[] = [];
    for (let i = 0; i < entries.length && compact.length < MAX_SNAPSHOT_ENTRIES; i += 1) {
      const item = entries[i];
      const memberId = String(item?.memberId || '').trim();
      if (!memberId) continue;
      compact.push({
        memberId,
        ...(item.lastMessage ? { lastMessage: item.lastMessage } : null),
        ...(item.lastSmallMessage ? { lastSmallMessage: item.lastSmallMessage } : null),
      });
    }
    await AsyncStorage.setItem(
      snapshotKey(token),
      JSON.stringify({ savedAt: Date.now(), entries: compact }),
    );
  } catch {}
}
