/**
 * 房间元数据（房间名 + 背景图 URL）持久化缓存。
 *
 * 背景：进房间后房间名和背景图来自 `room/info -> channelInfo.channelName / bgImg`。
 * 原来这份映射只存在 FollowedRoomsScreen 的 `roomMetaCache` ref 里 —— 纯内存，
 * App 一重启就没了：再进房间时标题是空的、背景先白一下，等接口回来才补上，
 * 用户看到「名字和背景要等一下才出来」。
 *
 * 背景图本体另有 `roomBgCache`（按 URL 哈希落文件），这里只负责让它「一进房间就知道该显示哪张」。
 *
 * 存储：AsyncStorage 单键 JSON（channelId → { name, bg }），带条目上限，超了按写入顺序淘汰。
 */
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
  // 只保留最近（靠后的）MAX_ENTRIES 条：写入时把当前 key 放到末尾
  for (const k of keys.slice(-MAX_ENTRIES)) next[k] = map[k];
  return next;
}

/** 启动时读一次；失败按空处理（不阻塞进房间） */
export async function loadRoomMetaCache(): Promise<Record<string, RoomMeta>> {
  if (cache) return cache;
  if (loading) return loading;
  loading = (async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      cache = parsed && typeof parsed === 'object' ? (parsed as Record<string, RoomMeta>) : {};
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

/** 写入内存并延迟落盘（合并短时间内的多次写入） */
export function setRoomMetaCached(channelId: string, meta: RoomMeta) {
  if (!channelId) return;
  if (!cache) cache = {};
  // 重新插入以更新「最近使用」顺序
  delete cache[channelId];
  cache[channelId] = { name: meta.name || '', bg: meta.bg || '' };
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const snapshot = trim(cache || {});
    AsyncStorage.setItem(KEY, JSON.stringify(snapshot)).catch(() => {});
  }, 400);
}
