import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_PREFIX = 'yaya_followed_ids_v1';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type CacheEntry = { savedAt: number; ids: string[] };

function cacheKey(token: string): string {
  // 不把 token 明文写进 key/值；只使用稳定哈希做账号区分。
  let hash = 5381;
  for (let i = 0; i < token.length; i += 1) hash = ((hash << 5) + hash + token.charCodeAt(i)) | 0;
  return `${CACHE_PREFIX}_${Math.abs(hash)}`;
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
  } catch {
    /* cache is best-effort */
  }
}
