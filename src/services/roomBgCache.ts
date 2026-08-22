import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

// 房间背景图本地缓存：进房间时优先显示本地已缓存的图（瞬时、不联网、不重复解码），
// 服务端背景 URL 变化时才重新下载。从根消除「背景从无到有硬跳变」并削掉轮询重渲染时的网络/解码开销。
// 与 downloads.ts（用户主动下载的媒体，带 4GB LRU）不同，本模块是透明、轻量、按 URL 哈希的自动缓存。

const BG_DIR = `${FileSystem.cacheDirectory || ''}roombg/`;
const MAP_KEY = 'yaya_room_bg_cache_v1';
const MAX_ENTRIES = 200; // 最多缓存 200 个房间背景，超出按写入顺序淘汰最旧

function hashUrl(url: string): string {
  // 简单稳定哈希：取 URL 的 base64，过滤文件系统非法字符
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

async function loadMap(): Promise<BgMap> {
  if (mapCache) return mapCache;
  if (mapPromise) return mapPromise;
  mapPromise = (async () => {
    try {
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
  } catch {
    /* 持久化失败不影响本次显示，下次重试 */
  }
}

// 同步读取：命中且文件存在则返回本地 uri，否则返回原网络 url（让 Image 正常联网加载）
export function getBgDisplayUri(url: string): string {
  if (!url) return '';
  const map = mapCache;
  if (map && map[url]) {
    return map[url].localUri;
  }
  return url;
}

// 后台确保缓存：命中且文件存在则什么都不做；否则下载落盘并更新映射。
// 永远不阻塞 UI —— 调用方拿 getBgDisplayUri 先显示，本函数负责"补齐"本地副本。
export async function ensureBgCached(url: string): Promise<void> {
  if (!url) return;
  const map = await loadMap();
  const entry = map[url];
  if (entry) {
    const info = await FileSystem.getInfoAsync(entry.localUri).catch(() => null);
    if (info && info.exists) return; // 已缓存且文件在，无需重下
  }
  // 缓存缺失或文件丢失 → 下载
  try {
    await FileSystem.makeDirectoryAsync(BG_DIR, { intermediates: true }).catch(() => undefined);
    const localUri = `${BG_DIR}${hashUrl(url)}.img`;
    await FileSystem.downloadAsync(url, localUri);
    const next: BgMap = { ...map, [url]: { localUri, url } };
    // 淘汰：超过上限时删除最旧条目（对象插入顺序 ≈ 写入顺序）
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
  } catch {
    /* 下载失败不影响：下次进房间或下次轮询会重试 */
  }
}

// 预热：进房间前（或 App 启动后）批量确保关注房间的背景已落盘。
// metaList: [{ url }] 仅含有效背景 url。并发受限，避免瞬间打爆网络。
export async function warmRoomBgs(urls: string[]): Promise<void> {
  const valid = Array.from(new Set(urls.filter(Boolean)));
  const CONCURRENCY = 3;
  for (let i = 0; i < valid.length; i += CONCURRENCY) {
    const batch = valid.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((u) => ensureBgCached(u).catch(() => undefined)));
  }
}

// 启动时预载内存映射，使首次进房间即可命中同步读取
export async function initRoomBgCache(): Promise<void> {
  await loadMap();
}
